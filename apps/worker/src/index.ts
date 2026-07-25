import { Worker, type Job } from "bullmq";
import type { Transporter } from "nodemailer";
import { prisma } from "@mailhelper/db";
import {
  CAMPAIGN_SEND_QUEUE,
  getRedisConnection,
  type CampaignSendJob,
} from "@mailhelper/queue";
import {
  decrypt,
  createGmailTransport,
  mergeTemplate,
} from "@mailhelper/core";

const DAILY_LIMIT = Number(process.env.DAILY_SEND_LIMIT ?? 450);

/** Reuse one SMTP transport per user across jobs in this process. */
const transports = new Map<string, { transport: Transporter; from: string }>();

async function getTransport(userId: string) {
  const cached = transports.get(userId);
  if (cached) return cached;

  const smtp = await prisma.smtpConfig.findUnique({ where: { userId } });
  if (!smtp) throw new Error("No Gmail connection configured");

  const appPassword = decrypt(smtp.appPasswordEnc);
  const transport = createGmailTransport({
    gmailAddress: smtp.gmailAddress,
    appPassword,
  });
  const from = smtp.fromName
    ? `"${smtp.fromName}" <${smtp.gmailAddress}>`
    : smtp.gmailAddress;

  const entry = { transport, from };
  transports.set(userId, entry);
  return entry;
}

async function sentInLast24h(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.recipient.count({
    where: {
      status: "sent",
      sentAt: { gte: since },
      campaign: { userId },
    },
  });
}

/** After each job, flip the campaign to completed/failed once nothing is pending. */
async function maybeFinalize(campaignId: string) {
  const pending = await prisma.recipient.count({
    where: { campaignId, status: "pending" },
  });
  if (pending > 0) return;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sent: true },
  });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: (campaign?.sent ?? 0) > 0 ? "completed" : "failed" },
  });
}

async function processJob(job: Job<CampaignSendJob>) {
  const { campaignId, recipientId } = job.data;

  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true },
  });
  if (!recipient || recipient.campaignId !== campaignId) return;
  if (recipient.status === "sent") return; // idempotent on retry

  const campaign = recipient.campaign;

  // Mark the campaign as actively sending on the first processed job.
  if (campaign.status === "queued") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" },
    });
  }

  // Respect the daily Gmail cap.
  if ((await sentInLast24h(campaign.userId)) >= DAILY_LIMIT) {
    await prisma.$transaction([
      prisma.recipient.update({
        where: { id: recipientId },
        data: {
          status: "failed",
          error: `Daily send limit (${DAILY_LIMIT}) reached — resend tomorrow`,
        },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { failed: { increment: 1 } },
      }),
    ]);
    await maybeFinalize(campaignId);
    return;
  }

  const { transport, from } = await getTransport(campaign.userId);
  const vars = { email: recipient.email, ...(recipient.variables as object) };

  try {
    await transport.sendMail({
      from,
      to: recipient.email,
      subject: mergeTemplate(campaign.subject, vars),
      html: mergeTemplate(campaign.bodyTemplate, vars).replace(/\n/g, "<br>"),
      text: mergeTemplate(campaign.bodyTemplate, vars),
    });

    await prisma.$transaction([
      prisma.recipient.update({
        where: { id: recipientId },
        data: { status: "sent", sentAt: new Date(), error: null },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { sent: { increment: 1 } },
      }),
    ]);
    await maybeFinalize(campaignId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    // Only record a terminal failure once retries are exhausted.
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await prisma.$transaction([
        prisma.recipient.update({
          where: { id: recipientId },
          data: { status: "failed", error: message },
        }),
        prisma.campaign.update({
          where: { id: campaignId },
          data: { failed: { increment: 1 } },
        }),
      ]);
      await maybeFinalize(campaignId);
    }
    // Invalidate a possibly-broken transport so the next job rebuilds it.
    transports.delete(campaign.userId);
    throw err; // let BullMQ retry with backoff
  }
}

const worker = new Worker<CampaignSendJob>(CAMPAIGN_SEND_QUEUE, processJob, {
  connection: getRedisConnection(),
  concurrency: 3,
  // Throttle to protect the sender's Gmail account from anti-spam blocks.
  limiter: { max: 1, duration: 1200 },
});

worker.on("ready", () => console.log("[worker] ready, waiting for jobs"));
worker.on("failed", (job, err) =>
  console.error(`[worker] job ${job?.id} failed:`, err.message),
);
worker.on("error", (err) => console.error("[worker] error:", err));

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  for (const { transport } of transports.values()) transport.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
