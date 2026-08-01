import http from "node:http";
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
  renderHtmlBody,
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

/**
 * Rolling 24h send count per user.
 *
 * The underlying COUNT joins every recipient the user has ever had, so running
 * it per job would dominate the cost of sending. It is re-read once a minute
 * and incremented locally in between; this process is the only sender, so the
 * cached value tracks reality exactly.
 */
const RECOUNT_AFTER_MS = 60_000;
const dailyCounts = new Map<string, { count: number; readAt: number }>();

async function sentInLast24h(userId: string): Promise<number> {
  const cached = dailyCounts.get(userId);
  if (cached && Date.now() - cached.readAt < RECOUNT_AFTER_MS) {
    return cached.count;
  }

  const count = await prisma.recipient.count({
    where: {
      status: "sent",
      sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      campaign: { userId },
    },
  });
  dailyCounts.set(userId, { count, readAt: Date.now() });
  return count;
}

function countSend(userId: string) {
  const cached = dailyCounts.get(userId);
  if (cached) cached.count += 1;
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
  const body = mergeTemplate(campaign.bodyTemplate, vars);

  try {
    await transport.sendMail({
      from,
      to: recipient.email,
      subject: mergeTemplate(campaign.subject, vars),
      // Escaped, so a spreadsheet cell containing markup arrives as the text
      // the sender saw in the preview rather than as HTML.
      html: renderHtmlBody(body),
      text: body,
    });
    countSend(campaign.userId);

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
  // Seconds to block on an idle queue before re-issuing the poll. The default
  // (5s) burns ~500k Redis commands/month doing nothing, which is the entire
  // Upstash free-tier allowance. A new job still wakes the block instantly.
  drainDelay: Number(process.env.WORKER_DRAIN_DELAY ?? 30),
});

let ready = false;
let lastJobAt = 0;
worker.on("ready", () => {
  ready = true;
  console.log("[worker] ready, waiting for jobs");
});
worker.on("active", () => {
  lastJobAt = Date.now();
});
worker.on("failed", (job, err) =>
  console.error(`[worker] job ${job?.id} failed:`, err.message),
);
worker.on("error", (err) => {
  ready = false;
  console.error("[worker] error:", err);
});

/**
 * Health endpoint. Free tiers on Render/Railway/Fly only host *web* services,
 * so the worker has to answer HTTP on $PORT to be deployable there — and the
 * uptime ping that keeps a free instance from sleeping needs a URL to hit.
 */
const port = Number(process.env.PORT ?? 8080);
const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ready ? "ok" : "connecting" }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, () => console.log(`[worker] health server on :${port}`));

/**
 * A free instance is suspended after ~15 minutes without an inbound request.
 * The producer wakes it when it enqueues, but a large campaign (throttled to
 * ~1 email/1.2s) can outlive that window, so self-request while jobs are still
 * flowing. Once the queue goes quiet the pings stop and the instance is allowed
 * to sleep as the free tier intends.
 */
const publicUrl = process.env.WORKER_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
const IDLE_AFTER_MS = 10 * 60 * 1000;
// Comfortably inside the shortest scale-down window we run against (Azure
// Container Apps idles a replica out after 300s). Pinging at exactly the
// cooldown is a race the campaign loses.
const KEEP_ALIVE_MS = 2 * 60 * 1000;
if (publicUrl) {
  setInterval(() => {
    if (Date.now() - lastJobAt > IDLE_AFTER_MS) return;
    fetch(`${publicUrl.replace(/\/$/, "")}/healthz`).catch(() => {});
  }, KEEP_ALIVE_MS).unref();
}

async function shutdown() {
  console.log("[worker] shutting down…");
  server.close();
  await worker.close();
  for (const { transport } of transports.values()) transport.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
