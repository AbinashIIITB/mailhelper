import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { enqueueSends, wakeWorker } from "@mailhelper/queue";
import { badRequest, conflict, notFound, withUser } from "@/lib/api";

type Params = { id: string };

export const POST = withUser<Params>(async (userId, _req, { params }) => {
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { status: true, subject: true },
  });
  if (!campaign) return notFound();
  if (campaign.status === "queued" || campaign.status === "sending") {
    return conflict("This campaign is already sending");
  }
  if (!campaign.subject.trim()) return badRequest("Add a subject first");

  const smtp = await prisma.smtpConfig.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!smtp) return badRequest("Connect your Gmail in Settings first");

  const recipients = await prisma.recipient.findMany({
    where: { campaignId: id },
    select: { id: true },
  });
  if (recipients.length === 0) return badRequest("Add recipients first");

  // Reset state and mark all recipients pending.
  await prisma.$transaction([
    prisma.recipient.updateMany({
      where: { campaignId: id },
      data: { status: "pending", error: null, sentAt: null },
    }),
    prisma.campaign.update({
      where: { id },
      data: {
        status: "queued",
        sent: 0,
        failed: 0,
        total: recipients.length,
      },
    }),
  ]);

  await enqueueSends(
    id,
    recipients.map((r) => r.id),
  );
  await wakeWorker();

  return NextResponse.json({ ok: true, queued: recipients.length });
});
