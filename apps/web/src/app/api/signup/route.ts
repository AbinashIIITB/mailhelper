import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@mailhelper/db";
import { signupSchema } from "@mailhelper/core";
import { badRequest, clientIp } from "@/lib/api";
import { allow } from "@/lib/rate-limit";

export async function POST(req: Request) {
  if (!(await allow(`signup:${clientIp(req)}`, 5, 3600))) {
    return NextResponse.json(
      { error: "Too many accounts created from here. Try again later." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email, passwordHash } });

  return NextResponse.json({ ok: true }, { status: 201 });
}
