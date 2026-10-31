import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import type { Campaign, Email, Sender } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { isPermanentSmtpError, sendEmail } from '../mail/transport.js';
import { indexEmailDoc, toSearchDoc } from '../modules/emails/email-index.js';
import { notifyRateLimitHit } from '../modules/slack/rate-limit-alerts.js';
import type { SendEmailJobData } from './email-queue.js';
import { limiterKeys, type LimitSpec, type SendRateLimiter, type ThrottleSpec } from './rate-limiter.js';

type EmailWithContext = Email & { campaign: Campaign; sender: Sender };

// A SENDING row older than this belongs to a worker that died mid-send.
const SENDING_STALE_MS = 5 * 60_000;
const EARLY_TOLERANCE_MS = 1_000;

export function limitsFor(email: EmailWithContext): LimitSpec[] {
  const limits: LimitSpec[] = [
    { kind: 'sender', key: limiterKeys.senderWindow(email.senderId), limit: env.MAX_EMAILS_PER_HOUR_PER_SENDER },
    { kind: 'campaign', key: limiterKeys.campaignWindow(email.campaignId), limit: email.campaign.hourlyLimit },
    { kind: 'global', key: limiterKeys.globalWindow(), limit: env.MAX_EMAILS_PER_HOUR },
  ];
  return limits.filter((limit) => limit.limit > 0);
}

function throttlesFor(email: EmailWithContext): ThrottleSpec[] {
  const throttles: ThrottleSpec[] = [];
  if (env.MIN_DELAY_BETWEEN_EMAILS_MS > 0) {
    throttles.push({ key: limiterKeys.senderThrottle(email.senderId), intervalMs: env.MIN_DELAY_BETWEEN_EMAILS_MS });
  }
  if (email.campaign.delayMs > 0) {
    throttles.push({ key: limiterKeys.campaignThrottle(email.campaignId), intervalMs: email.campaign.delayMs });
  }
  return throttles;
}

async function defer(job: Job<SendEmailJobData>, token: string | undefined, timestamp: number): Promise<never> {
  await job.moveToDelayed(timestamp, token);
  throw new DelayedError();
}

async function saveAndIndex(email: EmailWithContext, data: Parameters<typeof prisma.email.update>[0]['data']) {
  const updated = await prisma.email.update({ where: { id: email.id }, data });
  await indexEmailDoc(toSearchDoc(updated, email.campaign, email.sender.email));
  return updated;
}

export function createSendEmailProcessor(limiter: SendRateLimiter) {
  return async function processSendEmail(job: Job<SendEmailJobData>, token?: string) {
    const email = await prisma.email.findUnique({
      where: { id: job.data.emailId },
      include: { campaign: true, sender: true },
    });

    if (!email) return { outcome: 'missing' };
    if (email.status === 'SENT' || email.status === 'FAILED') {
      return { outcome: `already-${email.status.toLowerCase()}` };
    }

    if (email.status === 'SENDING') {
      const lockedFor = Date.now() - (email.lockedAt?.getTime() ?? 0);
      if (lockedFor < SENDING_STALE_MS) {
        // Probably still in flight on another worker; look again once it has had time to finish.
        return defer(job, token, Date.now() + 60_000);
      }
      // We can't know whether the SMTP server accepted it before the crash. Sending again could
      // deliver it twice, so we stop here and surface it as failed instead.
      await saveAndIndex(email, {
        status: 'FAILED',
        sentAt: new Date(),
        lockedAt: null,
        error: 'Worker stopped in the middle of sending. Not retried to avoid a duplicate email.',
      });
      return { outcome: 'interrupted' };
    }

    if (email.scheduledAt.getTime() - Date.now() > EARLY_TOLERANCE_MS) {
      return defer(job, token, email.scheduledAt.getTime());
    }

    const limits = limitsFor(email);
    const permit = await limiter.acquire({
      limits,
      throttles: throttlesFor(email),
      heldWindow: job.data.reservedWindow,
      heldSlot: job.data.slotAt,
    });

    if (permit.type === 'wait') {
      await job.updateData({ emailId: email.id, reservedWindow: job.data.reservedWindow, slotAt: permit.slotAt });
      return defer(job, token, permit.slotAt);
    }

    if (permit.type === 'reserved' || permit.type === 'exhausted') {
      const windowStart = limiter.windowStart(permit.window);
      // Spread reserved emails through the new window in the order they were pushed.
      const runAt =
        permit.type === 'reserved'
          ? Math.min(windowStart + (permit.position - 1) * env.MIN_DELAY_BETWEEN_EMAILS_MS, windowStart + limiter.windowMs - 1)
          : windowStart;

      await job.updateData({
        emailId: email.id,
        reservedWindow: permit.type === 'reserved' ? permit.window : undefined,
      });
      await saveAndIndex(email, {
        status: 'RATE_LIMITED',
        scheduledAt: new Date(runAt),
        rescheduleCount: { increment: 1 },
      });
      logger.info(
        { emailId: email.id, limit: permit.limit.kind, runAt: new Date(runAt).toISOString() },
        'Hourly limit reached, email moved to a later window',
      );
      await notifyRateLimitHit({
        userId: email.userId,
        limit: permit.limit,
        window: limiter.windowOf(Date.now()),
        senderEmail: email.sender.email,
        campaignSubject: email.campaign.subject,
        resumesAt: runAt,
      });
      return defer(job, token, runAt);
    }

    // Claim the row. Only one worker can move it out of SCHEDULED/RATE_LIMITED, so even if the
    // same job were ever handed out twice, the email is sent once.
    const claimed = await prisma.email.updateMany({
      where: { id: email.id, status: { in: ['SCHEDULED', 'RATE_LIMITED'] } },
      data: { status: 'SENDING', lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await limiter.release(permit.window, limits);
      return { outcome: 'claimed-elsewhere' };
    }

    const wait = permit.sendAt - Date.now();
    if (wait > 0) await sleep(wait);

    try {
      const result = await sendEmail(email.sender, {
        emailId: email.id,
        to: email.toAddress,
        subject: email.campaign.subject,
        text: email.campaign.body,
      });
      await saveAndIndex(email, {
        status: 'SENT',
        sentAt: new Date(),
        lockedAt: null,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = isPermanentSmtpError(err);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      if (permanent || lastAttempt) {
        await saveAndIndex(email, { status: 'FAILED', sentAt: new Date(), lockedAt: null, error: message });
        throw permanent ? new UnrecoverableError(message) : err;
      }

      // Definitely not delivered, so it is safe to hand it back to BullMQ for a retry with backoff.
      await prisma.email.update({ where: { id: email.id }, data: { status: 'SCHEDULED', lockedAt: null, error: message } });
      throw err;
    }

    // This send used the last slot in the window: tell the user now rather than when the next email bounces off.
    const exhausted = permit.window !== job.data.reservedWindow ? limits.find((limit, i) => permit.counts[i] >= limit.limit) : undefined;
    if (exhausted) {
      await notifyRateLimitHit({
        userId: email.userId,
        limit: exhausted,
        window: permit.window,
        senderEmail: email.sender.email,
        campaignSubject: email.campaign.subject,
        resumesAt: limiter.windowStart(permit.window + 1),
      });
    }

    return { outcome: 'sent' };
  };
}
