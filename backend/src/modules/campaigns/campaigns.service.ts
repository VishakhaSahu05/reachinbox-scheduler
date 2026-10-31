import { randomUUID } from 'node:crypto';
import { Prisma, type Campaign } from '@prisma/client';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { enqueueEmails } from '../../queue/email-queue.js';
import { indexEmailDocs, toSearchDoc } from '../emails/email-index.js';
import type { ScheduleCampaignInput } from './campaigns.schema.js';
import { planSchedule } from './schedule-planner.js';

export interface ScheduleResult {
  created: boolean;
  campaign: {
    id: string;
    totalEmails: number;
    startAt: string;
    delayMs: number;
    hourlyLimit: number;
    firstSendAt: string | null;
    lastSendAt: string | null;
  };
}

async function describe(campaign: Campaign, created: boolean): Promise<ScheduleResult> {
  const range = await prisma.email.aggregate({
    where: { campaignId: campaign.id },
    _min: { scheduledAt: true },
    _max: { scheduledAt: true },
  });
  return {
    created,
    campaign: {
      id: campaign.id,
      totalEmails: campaign.totalEmails,
      startAt: campaign.startAt.toISOString(),
      delayMs: campaign.delayMs,
      hourlyLimit: campaign.hourlyLimit,
      firstSendAt: range._min.scheduledAt?.toISOString() ?? null,
      lastSendAt: range._max.scheduledAt?.toISOString() ?? null,
    },
  };
}

function findByIdempotencyKey(userId: string, idempotencyKey: string) {
  return prisma.campaign.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
}

export async function scheduleCampaign(
  userId: string,
  input: ScheduleCampaignInput,
  idempotencyKey?: string,
): Promise<ScheduleResult> {
  // A retried request (double click, flaky network) returns the campaign it already created.
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return describe(existing, false);
  }

  const sender = await prisma.sender.findUnique({ where: { id: input.senderId } });
  if (!sender) throw new HttpError(400, 'Unknown sender');

  const recipients = [...new Set(input.recipients)];
  const delayMs = Math.max(Math.round(input.delayBetweenEmailsSec * 1000), env.MIN_DELAY_BETWEEN_EMAILS_MS);
  const senderCap = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const startAt = Math.max(input.startAt.getTime(), Date.now());

  const times = planSchedule({
    startAt,
    count: recipients.length,
    delayMs,
    hourlyLimit: senderCap > 0 ? Math.min(input.hourlyLimit, senderCap) : input.hourlyLimit,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
  });

  const campaignId = randomUUID();
  const createdAt = new Date();
  const emails = recipients.map((toAddress, i) => ({
    id: randomUUID(),
    campaignId,
    userId,
    senderId: sender.id,
    toAddress,
    sequence: i,
    scheduledAt: new Date(times[i]),
    createdAt,
  }));

  let campaign: Campaign;
  try {
    campaign = await prisma.$transaction(
      async (tx) => {
        const created = await tx.campaign.create({
          data: {
            id: campaignId,
            userId,
            senderId: sender.id,
            subject: input.subject,
            body: input.body,
            startAt: new Date(startAt),
            delayMs,
            hourlyLimit: input.hourlyLimit,
            totalEmails: emails.length,
            idempotencyKey,
          },
        });
        for (let i = 0; i < emails.length; i += 1000) {
          await tx.email.createMany({ data: emails.slice(i, i + 1000) });
        }
        return created;
      },
      { timeout: 30_000 },
    );
  } catch (err) {
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findByIdempotencyKey(userId, idempotencyKey);
      if (existing) return describe(existing, false);
    }
    throw err;
  }

  try {
    await enqueueEmails(emails);
  } catch (err) {
    // Without jobs nothing would ever send, so undo the campaign instead of leaving it half-scheduled.
    logger.error({ err, campaignId }, 'Could not enqueue campaign, rolling it back');
    await prisma.campaign.delete({ where: { id: campaignId } });
    throw new HttpError(503, 'The job queue is unavailable, nothing was scheduled. Please try again.');
  }

  await indexEmailDocs(
    emails.map((email) => toSearchDoc({ ...email, status: 'SCHEDULED', sentAt: null }, campaign, sender.email)),
  );

  logger.info({ campaignId, emails: emails.length, firstSendAt: new Date(times[0]).toISOString() }, 'Campaign scheduled');
  return describe(campaign, true);
}
