import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@mailhelper/db";
import { loginSchema } from "@mailhelper/core";
import { authConfig } from "@/auth.config";
import { allow } from "@/lib/rate-limit";

// Compared against when the email doesn't exist, so the miss costs the same
// bcrypt round as a hit and response time can't be used to enumerate accounts.
const ABSENT_USER_HASH =
  "$2a$10$526eMwoLgMQqAazszaY5DuOM1ceUwEkFgv1ukr21.mk9G55B.xz/W";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        if (!(await allow(`login:${email.toLowerCase()}`, 10, 900))) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(
          password,
          user?.passwordHash ?? ABSENT_USER_HASH,
        );
        if (!user || !ok) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
});
