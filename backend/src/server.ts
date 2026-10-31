import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';
import { ensureEmailIndex } from './modules/emails/email-index.js';
import { ensureSenders } from './modules/senders/senders.service.js';
import { closeEmailQueue } from './queue/email-queue.js';

async function main() {
  await prisma.$connect();
  await ensureSenders();
  await ensureEmailIndex().catch((err) => logger.warn({ err: String(err) }, 'Elasticsearch unavailable, search will fall back to Postgres'));

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on ${env.APP_URL} (queue dashboard at ${env.APP_URL}/admin/queues)`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down API');
    server.close();
    await closeEmailQueue();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
