import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@mailhelper/db", "@mailhelper/core", "@mailhelper/queue"],
  serverExternalPackages: ["bullmq", "ioredis", "nodemailer", "@prisma/client"],
  // Monorepo root (silences Next's multi-lockfile workspace inference warning).
  turbopack: { root: path.join(__dirname, "..", "..") },
};

export default nextConfig;
