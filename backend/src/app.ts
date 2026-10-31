import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { elastic } from './lib/elasticsearch.js';
import { prisma } from './lib/prisma.js';
import { getRedis } from './lib/redis.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth, requireAuthPage } from './middleware/require-auth.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { campaignsRouter } from './modules/campaigns/campaigns.routes.js';
import { emailsRouter } from './modules/emails/emails.routes.js';
import { sendersRouter } from './modules/senders/senders.routes.js';
import { slackRouter } from './modules/slack/slack.routes.js';
import { createBullBoardRouter } from './queue/bull-board.js';

async function check(probe: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await probe();
    return 'up';
  } catch {
    return 'down';
  }
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // CSP off: this server only returns JSON, plus the Bull Board UI which relies on inline assets.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    const [postgres, redis, elasticsearch] = await Promise.all([
      check(() => prisma.$queryRaw`SELECT 1`),
      check(() => getRedis().ping()),
      check(() => elastic.ping()),
    ]);
    res.status(postgres === 'up' && redis === 'up' ? 200 : 503).json({ postgres, redis, elasticsearch });
  });

  // Server-side limits, so the compose form can explain what will actually be enforced.
  app.get('/api/config', requireAuth, (_req, res) => {
    res.json({
      minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
      rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/senders', requireAuth, sendersRouter);
  app.use('/api/campaigns', requireAuth, campaignsRouter);
  app.use('/api/emails', requireAuth, emailsRouter);
  app.use('/api/slack', slackRouter);
  app.use('/admin/queues', requireAuthPage, createBullBoardRouter('/admin/queues'));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // In production the built dashboard is served from here, so the app and API share one origin.
  if (env.FRONTEND_DIST) {
    const dist = path.resolve(env.FRONTEND_DIST);
    app.use(express.static(dist, { index: false }));
    app.get(/^\/(?!api\/|admin\/).*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
