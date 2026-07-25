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
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    // BullMQ requires this to be null so blocking commands don't disconnect.
    maxRetriesPerRequest: null,
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.username ? { username: parsed.username } : {}),
  };
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
