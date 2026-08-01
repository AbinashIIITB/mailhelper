import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import {
  smtpConfigSchema,
  encrypt,
  verifyGmailTransport,
} from "@mailhelper/core";
import { badRequest, withUser } from "@/lib/api";

export const POST = withUser(async (userId, req) => {
  const body = await req.json().catch(() => null);
  const parsed = smtpConfigSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { gmailAddress, appPassword, fromName } = parsed.data;

  // Verify against Gmail before persisting so bad credentials fail fast.
  try {
    await verifyGmailTransport({ gmailAddress, appPassword });
  } catch {
    return badRequest(
      "Could not sign in to Gmail. Check the address and app password (2-Step Verification must be on).",
    );
  }

  const appPasswordEnc = encrypt(appPassword);

  await prisma.smtpConfig.upsert({
    where: { userId },
    create: { userId, gmailAddress, appPasswordEnc, fromName: fromName || null },
    update: { gmailAddress, appPasswordEnc, fromName: fromName || null },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withUser(async (userId) => {
  await prisma.smtpConfig.deleteMany({ where: { userId } });
  return NextResponse.json({ ok: true });
});
