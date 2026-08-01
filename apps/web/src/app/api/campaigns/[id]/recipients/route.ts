import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import { recipientsPayloadSchema } from "@mailhelper/core";
import { badRequest, conflict, notFound, withUser } from "@/lib/api";

type Params = { id: string };

export const PUT = withUser<Params>(async (userId, req, { params }) => {
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!campaign) return notFound();
  if (campaign.status === "queued" || campaign.status === "sending") {
    return conflict("Cannot change recipients while sending");
  }

  const body = await req.json().catch(() => null);
  const parsed = recipientsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      "Invalid recipients. Check that every row has a valid email.",
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
});
