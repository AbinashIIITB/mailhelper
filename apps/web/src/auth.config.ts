import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config. Contains NO Node-only imports (Prisma, bcrypt) so it
 * can be used from middleware. The Credentials provider with its DB-backed
 * `authorize` lives in `auth.ts`, which runs only in the Node runtime.
 */
export const authConfig = {
  // Trust the hosting platform's proxy headers (required outside Vercel).
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.id = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
