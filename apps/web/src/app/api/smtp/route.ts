import { NextResponse } from "next/server";
import { prisma } from "@mailhelper/db";
import {
  smtpConfigSchema,
  encrypt,
  verifyGmailTransport,
} from "@mailhelper/core";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = smtpConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { gmailAddress, appPassword, fromName } = parsed.data;

  // Verify against Gmail before persisting so bad credentials fail fast.
  try {
    await verifyGmailTransport({ gmailAddress, appPassword });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not sign in to Gmail. Check the address and app password (2-Step Verification must be on).",
      },
      { status: 400 },
    );
  }

  const appPasswordEnc = encrypt(appPassword);

  await prisma.smtpConfig.upsert({
    where: { userId },
    create: { userId, gmailAddress, appPasswordEnc, fromName: fromName || null },
    update: { gmailAddress, appPasswordEnc, fromName: fromName || null },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.smtpConfig.deleteMany({ where: { userId } });
  return NextResponse.json({ ok: true });
}
