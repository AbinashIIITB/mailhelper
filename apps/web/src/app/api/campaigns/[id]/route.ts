import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { campaignInputSchema } from "@mailhelper/core";
import { badRequest, conflict, notFound, withUser } from "@/lib/api";

type Params = { id: string };

export const PATCH = withUser<Params>(async (userId, req, { params }) => {
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!campaign) return notFound();
  if (campaign.status === "queued" || campaign.status === "sending") {
    return conflict("Cannot edit a campaign while it is sending");
  }

  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await prisma.campaign.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
});

export const DELETE = withUser<Params>(async (userId, _req, { params }) => {
  const { id } = await params;
  // Scoping the delete to the owner means an id guessed by someone else
  // matches nothing, so no separate ownership lookup is needed.
  const { count } = await prisma.campaign.deleteMany({ where: { id, userId } });
  if (count === 0) return notFound();

  return NextResponse.json({ ok: true });
});
