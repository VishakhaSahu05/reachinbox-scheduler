/*
 * Schedules a big campaign straight through the service layer and prints how the emails were
 * spread over rate-limit windows. Pair it with a worker running MAIL_TRANSPORT=stub to watch
 * the queue drain without spamming Ethereal.
 *
 *   npm run load-test -- --count 1000 --hourly 200 --delay 0 --start-in 10 [--user you@gmail.com]
 */
import { parseArgs } from 'node:util';
import { env } from '../config/env.js';
import { elastic } from '../lib/elasticsearch.js';
import { prisma } from '../lib/prisma.js';
import { closeRedis } from '../lib/redis.js';
import { scheduleCampaign } from '../modules/campaigns/campaigns.service.js';
import { ensureSenders } from '../modules/senders/senders.service.js';
import { closeEmailQueue } from '../queue/email-queue.js';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1000' },
    hourly: { type: 'string', default: '200' },
    delay: { type: 'string', default: '0' },
    'start-in': { type: 'string', default: '10' },
    user: { type: 'string' },
  },
});

async function main() {
  const count = Number(values.count);
  const startAt = new Date(Date.now() + Number(values['start-in']) * 1000);

  const user = values.user
    ? await prisma.user.findUniqueOrThrow({ where: { email: values.user } })
    : await prisma.user.upsert({
        where: { googleId: 'load-test' },
        create: { googleId: 'load-test', email: 'load-test@reachinbox.local', name: 'Load Test' },
        update: {},
      });

  await ensureSenders();
  const sender = await prisma.sender.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });

  const started = Date.now();
  const { campaign } = await scheduleCampaign(user.id, {
    senderId: sender.id,
    subject: `Load test (${count} emails)`,
    body: 'Hi there,\n\nThis is a load test email from the ReachInbox scheduler.\n\nThanks!',
    recipients: Array.from({ length: count }, (_, i) => `lead${i + 1}@example.com`),
    startAt,
    delayBetweenEmailsSec: Number(values.delay),
    hourlyLimit: Number(values.hourly),
  });
  console.log(`Scheduled ${campaign.totalEmails} emails in ${Date.now() - started} ms (campaign ${campaign.id})`);

  const emails = await prisma.email.findMany({ where: { campaignId: campaign.id }, select: { scheduledAt: true } });
  const perWindow = new Map<number, number>();
  for (const { scheduledAt } of emails) {
    const windowStart = Math.floor(scheduledAt.getTime() / env.RATE_LIMIT_WINDOW_MS) * env.RATE_LIMIT_WINDOW_MS;
    perWindow.set(windowStart, (perWindow.get(windowStart) ?? 0) + 1);
  }
  console.table(
    [...perWindow.entries()]
      .sort(([a], [b]) => a - b)
      .map(([windowStart, emailsInWindow]) => ({ windowStart: new Date(windowStart).toISOString(), emails: emailsInWindow })),
  );

  await closeEmailQueue();
  await closeRedis();
  await elastic.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
