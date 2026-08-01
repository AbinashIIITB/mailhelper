import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { enqueueSends, wakeWorker } from "@mailhelper/queue";
import { badRequest, conflict, notFound, withUser } from "@/lib/api";

type Params = { id: string };

export const POST = withUser<Params>(async (userId, _req, { params }) => {
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!campaign) return notFound();
  if (campaign.status === "queued" || campaign.status === "sending") {
    return conflict("Campaign is already sending");
  }

  const failed = await prisma.recipient.findMany({
    where: { campaignId: id, status: "failed" },
    select: { id: true },
  });
  if (failed.length === 0) return badRequest("Nothing to resend");

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

  await enqueueSends(
    id,
    failed.map((r) => r.id),
  );
  await wakeWorker();

  return NextResponse.json({ ok: true, queued: failed.length });
});
