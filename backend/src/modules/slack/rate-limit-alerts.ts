import { env } from '../../config/env.js';
import { KEY_PREFIX } from '../../lib/keys.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getRedis } from '../../lib/redis.js';
import type { LimitSpec } from '../../queue/rate-limiter.js';
import { sendSlackMessage } from './slack.service.js';

export interface RateLimitAlert {
  userId: string;
  limit: LimitSpec;
  window: number;
  senderEmail: string;
  campaignSubject: string;
  // When the deferred email (or the next ones) will go out.
  resumesAt: number;
}

function slackTime(ms: number): string {
  const fallback = new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  return `<!date^${Math.floor(ms / 1000)}^{date_short_pretty} {time_secs}|${fallback}>`;
}

function describeLimit(alert: RateLimitAlert): string {
  switch (alert.limit.kind) {
    case 'sender':
      return `${alert.limit.limit} emails per window for sender *${alert.senderEmail}* (server-wide sender cap)`;
    case 'campaign':
      return `${alert.limit.limit} emails per window set on campaign *“${alert.campaignSubject}”* (sender ${alert.senderEmail})`;
    case 'global':
      return `${alert.limit.limit} emails per window across all senders (global cap)`;
  }
}

function windowLabel(): string {
  const minutes = env.RATE_LIMIT_WINDOW_MS / 60_000;
  return minutes === 60 ? 'hour' : `${minutes}-minute window`;
}

/**
 * Posts one Slack message per user, limit and window. Users without a Slack connection are
 * skipped silently, and nothing is remembered for them, so connecting Slack later starts
 * alerts right away.
 */
export async function notifyRateLimitHit(alert: RateLimitAlert): Promise<void> {
  try {
    const connected = await prisma.slackConnection.count({ where: { userId: alert.userId } });
    if (!connected) return;

    const redis = getRedis();
    const dedupeKey = `${KEY_PREFIX}:slack-alert:${alert.userId}:${alert.limit.key}${alert.window}`;
    const first = await redis.set(dedupeKey, '1', 'PX', env.RATE_LIMIT_WINDOW_MS * 2, 'NX');
    if (!first) return;

    const windowStart = alert.window * env.RATE_LIMIT_WINDOW_MS;
    const windowEnd = windowStart + env.RATE_LIMIT_WINDOW_MS;
    const lines = [
      `:warning: *Sending limit reached for this ${windowLabel()}*`,
      `• Limit: ${describeLimit(alert)}`,
      `• Window: ${slackTime(windowStart)} → ${slackTime(windowEnd)}`,
      `• Remaining emails are not dropped. They are rescheduled and resume at ${slackTime(alert.resumesAt)}.`,
    ];

    try {
      await sendSlackMessage(alert.userId, { text: lines.join('\n') });
      logger.info({ userId: alert.userId, limit: alert.limit.kind, window: alert.window }, 'Slack rate-limit alert sent');
    } catch (err) {
      // Let the next limit hit in this window try again.
      await redis.del(dedupeKey);
      throw err;
    }
  } catch (err) {
    logger.warn({ err: String(err), userId: alert.userId }, 'Slack rate-limit alert failed');
  }
}
