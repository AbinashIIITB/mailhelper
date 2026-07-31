import { Queue, type ConnectionOptions } from 'bullmq';

/**
 * Shared BullMQ setup. The web app is the PRODUCER (enqueues send jobs) and
 * `apps/worker` is the CONSUMER (a long-running process that sends mail).
 */

export const CAMPAIGN_SEND_QUEUE = 'campaign-send';

/** One job = send one email to one recipient of a campaign. */
export interface CampaignSendJob {
  campaignId: string;
  recipientId: string;
}

export function getRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const parsed = new URL(url);
  // Managed providers (Upstash, Redis Cloud, …) hand out `rediss://` URLs and
  // refuse plaintext connections.
  const useTls = parsed.protocol === 'rediss:';
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    // BullMQ requires this to be null so blocking commands don't disconnect.
    maxRetriesPerRequest: null,
    // Hosted Redis is often IPv6-only; 0 lets Node pick whichever resolves.
    family: 0,
    ...(useTls ? { tls: { servername: parsed.hostname } } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
  };
}

/**
 * Nudge the worker's health endpoint after enqueuing.
 *
 * Free hosting tiers suspend an idle instance and only resume it on an inbound
 * HTTP request, so without this a queued campaign would sit in Redis until
 * something else happened to hit the worker. No-op when `WORKER_WAKE_URL` is
 * unset — local dev and always-on hosts don't need it.
 */
export async function wakeWorker(): Promise<void> {
  const url = process.env.WORKER_WAKE_URL;
  if (!url) return;
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    // A cold start takes longer than the timeout, but the request has already
    // triggered the resume — the worker will boot and drain the queue. Nothing
    // here is worth failing the user's send over.
  }
}

let queue: Queue<CampaignSendJob> | null = null;

export function getCampaignQueue(): Queue<CampaignSendJob> {
  if (!queue) {
    queue = new Queue<CampaignSendJob>(CAMPAIGN_SEND_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}
