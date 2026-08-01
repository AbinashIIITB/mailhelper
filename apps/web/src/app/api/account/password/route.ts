import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@mailhelper/db";
import { changePasswordSchema } from "@mailhelper/core";
import { badRequest, notFound, withUser } from "@/lib/api";
import { allow } from "@/lib/rate-limit";

export const POST = withUser(async (userId, req) => {
  if (!(await allow(`password:${userId}`, 10, 900))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return notFound();

  // Re-check the current password so a stolen session can't change it outright.
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return badRequest("Current password is incorrect");
  }
  if (currentPassword === newPassword) {
    return badRequest("New password must be different from the current one");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });

  return NextResponse.json({ ok: true });
});
