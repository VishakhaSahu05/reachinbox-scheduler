import { prisma } from '../lib/prisma.js';
import { enqueueEmails, getEmailQueue } from './email-queue.js';

/**
 * Postgres is the source of truth for what still has to be sent. On worker start we make sure
 * every unfinished email has a job in Redis. Normally they all do (Redis persists delayed jobs),
 * but if Redis lost data or an enqueue failed, this puts the missing jobs back. Re-adding is
 * safe because job ids are the email ids.
 */
export async function reconcilePendingEmails(): Promise<{ checked: number; requeued: number }> {
  const queue = getEmailQueue();
  let checked = 0;
  let requeued = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.email.findMany({
      where: { status: { in: ['SCHEDULED', 'RATE_LIMITED', 'SENDING'] } },
      select: { id: true, scheduledAt: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;

    const missing: typeof batch = [];
    await Promise.all(
      batch.map(async (email) => {
        const job = await queue.getJob(email.id);
        if (!job) {
          missing.push(email);
          return;
        }
        // A finished job for an unfinished email means the job died on an infrastructure error.
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') {
          await job.remove();
          missing.push(email);
        }
      }),
    );

    if (missing.length > 0) await enqueueEmails(missing);
    checked += batch.length;
    requeued += missing.length;
    cursor = batch[batch.length - 1].id;
  }

  return { checked, requeued };
}
