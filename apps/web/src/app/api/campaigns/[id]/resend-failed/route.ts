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
  const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.status === "queued" || campaign.status === "sending") {
    return NextResponse.json(
      { error: "Campaign is already sending" },
      { status: 409 },
    );
  }

  const failed = await prisma.recipient.findMany({
    where: { campaignId: id, status: "failed" },
    select: { id: true },
  });
  if (failed.length === 0) {
    return NextResponse.json({ error: "Nothing to resend" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.recipient.updateMany({
      where: { campaignId: id, status: "failed" },
      data: { status: "pending", error: null },
    }),
    prisma.campaign.update({
      where: { id },
      data: { status: "queued", failed: 0 },
    }),
  ]);

  const queue = getCampaignQueue();
  await queue.addBulk(
    failed.map((r) => ({
      name: "send",
      data: { campaignId: id, recipientId: r.id },
    })),
  );

  await wakeWorker();

  return NextResponse.json({ ok: true, queued: failed.length });
}
