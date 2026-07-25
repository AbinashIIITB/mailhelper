import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { recipientsPayloadSchema } from "@mailhelper/core";
import { auth } from "@/auth";

export async function PUT(
  req: Request,
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
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.status === "queued" || campaign.status === "sending") {
    return NextResponse.json(
      { error: "Cannot change recipients while sending" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = recipientsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recipients. Check that every row has a valid email." },
      { status: 400 },
    );
  }

  const { recipients } = parsed.data;

  // Replace the full recipient set and reset campaign counters/status.
  await prisma.$transaction([
    prisma.recipient.deleteMany({ where: { campaignId: id } }),
    prisma.recipient.createMany({
      data: recipients.map((r) => ({
        campaignId: id,
        email: r.email,
        variables: r.variables as object,
      })),
    }),
    prisma.campaign.update({
      where: { id },
      data: {
        total: recipients.length,
        sent: 0,
        failed: 0,
        status: "draft",
      },
    }),
  ]);

  return NextResponse.json({ ok: true, count: recipients.length });
}
