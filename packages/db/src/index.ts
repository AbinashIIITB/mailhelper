import { PrismaClient } from '@prisma/client';

// Next's dev server re-evaluates modules on every edit, and each new client
// opens its own connection pool. Hanging one off globalThis keeps a long dev
// session from exhausting Postgres' connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
