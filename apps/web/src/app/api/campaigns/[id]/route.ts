import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { campaignInputSchema } from "@mailhelper/core";
import { auth } from "@/auth";

async function requireOwnedCampaign(id: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
  return campaign;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await requireOwnedCampaign(id, userId);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.status === "queued" || campaign.status === "sending") {
    return NextResponse.json(
      { error: "Cannot edit a campaign while it is sending" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await prisma.campaign.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await requireOwnedCampaign(id, userId);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.campaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
