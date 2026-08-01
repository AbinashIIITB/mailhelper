import Redis from "ioredis";
import { getRedisConnection } from "@mailhelper/queue";

// Reused across warm invocations so a burst of requests doesn't open a
// connection each. Serverless instances are short-lived, so this is a handful
// of connections in practice, not one per request.
let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    client = new Redis(getRedisConnection());
    client.on("error", (err) => console.error("[rate-limit] redis:", err.message));
  }
  return client;
}

/**
 * Fixed-window counter. Returns false once `limit` hits inside `windowSeconds`.
 *
 * Fails open: if Redis is unreachable, people can still sign in. Locking
 * everyone out of their own account is a worse outcome than briefly losing
 * brute-force protection.
 */
export async function allow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const bucket = `rl:${key}`;
    const hits = await redis().incr(bucket);
    if (hits === 1) await redis().expire(bucket, windowSeconds);
    return hits <= limit;
  } catch (err) {
    console.error("[rate-limit] skipped:", (err as Error).message);
    return true;
  }
}
