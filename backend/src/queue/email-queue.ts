import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { createRedisConnection } from '../lib/redis.js';

export const EMAIL_QUEUE_NAME = 'email-send';

export interface SendEmailJobData {
  emailId: string;
  // Hour window this job already holds a counted place in (set when it was pushed by the rate limit).
  reservedWindow?: number;
  // Send slot reserved on the per-sender/per-campaign throttle.
  slotAt?: number;
}

let queue: Queue<SendEmailJobData> | null = null;
// BullMQ does not close connections it was handed, so we keep it to close ourselves.
let queueConnection: Redis | null = null;

export function getEmailQueue(): Queue<SendEmailJobData> {
  if (!queue) {
    queueConnection = createRedisConnection('email-queue');
    queue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: env.SEND_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 50_000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return queue;
}

export function sendJobOptions(emailId: string, scheduledAt: Date): JobsOptions {
  return {
    // The email id doubles as the job id, so the same email can never be queued twice.
    jobId: emailId,
    delay: Math.max(0, scheduledAt.getTime() - Date.now()),
  };
}

export async function enqueueEmails(emails: { id: string; scheduledAt: Date }[]): Promise<void> {
  const q = getEmailQueue();
  const chunkSize = 500;
  for (let i = 0; i < emails.length; i += chunkSize) {
    await q.addBulk(
      emails.slice(i, i + chunkSize).map((email) => ({
        name: 'send',
        data: { emailId: email.id },
        opts: sendJobOptions(email.id, email.scheduledAt),
      })),
    );
  }
}

export async function closeEmailQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
