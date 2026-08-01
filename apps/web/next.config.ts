import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@mailhelper/db", "@mailhelper/core", "@mailhelper/queue"],
  serverExternalPackages: ["bullmq", "ioredis", "nodemailer", "@prisma/client"],
  // Monorepo root (silences Next's multi-lockfile workspace inference warning).
  turbopack: { root: path.join(__dirname, "..", "..") },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        // Nothing here is meant to be embedded, and the campaign editor is a
        // one-click send - worth denying framing outright.
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ],
    },
  ],
};

export default nextConfig;
