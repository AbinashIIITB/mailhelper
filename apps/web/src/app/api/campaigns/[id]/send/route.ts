import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { getCampaignQueue, wakeWorker } from "@mailhelper/queue";
import { auth } from "@/auth";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    include: { recipients: { select: { id: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.status === "queued" || campaign.status === "sending") {
    return NextResponse.json(
      { error: "This campaign is already sending" },
      { status: 409 },
    );
  }

  const smtp = await prisma.smtpConfig.findUnique({ where: { userId } });
  if (!smtp) {
    return NextResponse.json(
      { error: "Connect your Gmail in Settings first" },
      { status: 400 },
    );
  }
  if (!campaign.subject.trim()) {
    return NextResponse.json({ error: "Add a subject first" }, { status: 400 });
  }
  if (campaign.recipients.length === 0) {
    return NextResponse.json(
      { error: "Add recipients first" },
      { status: 400 },
    );
  }

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
        total: campaign.recipients.length,
      },
    }),
  ]);

  const queue = getCampaignQueue();
  await queue.addBulk(
    campaign.recipients.map((r) => ({
      name: "send",
      data: { campaignId: id, recipientId: r.id },
    })),
  );

  await wakeWorker();

  return NextResponse.json({ ok: true, queued: campaign.recipients.length });
}
