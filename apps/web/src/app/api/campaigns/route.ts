import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { campaignInputSchema } from "@mailhelper/core";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema
    .pick({ name: true })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: { userId, name: parsed.data.name },
  });

  return NextResponse.json({ id: campaign.id }, { status: 201 });
}
