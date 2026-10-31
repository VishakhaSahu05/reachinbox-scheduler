import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeRedis, createRedisConnection, getRedis } from './lib/redis.js';
import { closeTransports } from './mail/transport.js';
import { ensureEmailIndex } from './modules/emails/email-index.js';
import { closeEmailQueue, EMAIL_QUEUE_NAME, type SendEmailJobData } from './queue/email-queue.js';
import { SendRateLimiter } from './queue/rate-limiter.js';
import { reconcilePendingEmails } from './queue/reconcile.js';
import { createSendEmailProcessor } from './queue/send-email.processor.js';

async function main() {
  await prisma.$connect();
  await ensureEmailIndex().catch((err) => logger.warn({ err: String(err) }, 'Elasticsearch unavailable, search index not checked'));

  const { checked, requeued } = await reconcilePendingEmails();
  logger.info({ pending: checked, requeued }, 'Pending emails checked against the queue');

  const limiter = new SendRateLimiter(getRedis(), {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxInlineWaitMs: 5_000,
    slotToleranceMs: 2_000,
    lookaheadWindows: Math.min(1000, Math.ceil((14 * 24 * 3_600_000) / env.RATE_LIMIT_WINDOW_MS)),
  });

  const workerConnection = createRedisConnection('email-worker');
  const worker = new Worker<SendEmailJobData>(EMAIL_QUEUE_NAME, createSendEmailProcessor(limiter), {
    connection: workerConnection,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, ...result }, 'Job completed');
  });
  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'Job failed');
  });
  worker.on('error', (err) => logger.error({ err }, 'Worker error'));

  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      perSenderPerWindow: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      globalPerWindow: env.MAX_EMAILS_PER_HOUR || 'off',
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    'Email worker started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn('Forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker, waiting for in-flight sends to finish');
    // close() stops taking new jobs and waits for active ones, so nothing is cut off mid-send.
    await worker.close();
    await workerConnection.quit();
    await closeEmailQueue();
    closeTransports();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
