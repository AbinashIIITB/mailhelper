import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { campaignInputSchema } from "@mailhelper/core";
import { badRequest, withUser } from "@/lib/api";

export const POST = withUser(async (userId, req) => {
  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema.pick({ name: true }).safeParse(body);
  if (!parsed.success) return badRequest("Name is required");

  const campaign = await prisma.campaign.create({
    data: { userId, name: parsed.data.name },
  });

  return NextResponse.json({ id: campaign.id }, { status: 201 });
});
