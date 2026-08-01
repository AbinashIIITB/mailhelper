import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { notFound, withUser } from "@/lib/api";

type Params = { id: string };

/**
 * Progress for the editor to poll while a campaign sends. Deliberately omits
 * the recipient `variables`, which are the bulk of the payload and never
 * change mid-send.
 */
export const GET = withUser<Params>(async (userId, _req, { params }) => {
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: {
      status: true,
      total: true,
      sent: true,
      failed: true,
      recipients: {
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, status: true, error: true },
      },
    },
  });
  if (!campaign) return notFound();

  return NextResponse.json(campaign);
});
