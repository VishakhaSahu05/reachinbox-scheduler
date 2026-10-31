import type { EmailStatus, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { searchEmailIds } from './email-index.js';

export type EmailView = 'scheduled' | 'sent';

export const VIEW_STATUSES: Record<EmailView, EmailStatus[]> = {
  scheduled: ['SCHEDULED', 'RATE_LIMITED', 'SENDING'],
  sent: ['SENT', 'FAILED'],
};

const VIEW_SORT = {
  scheduled: { field: 'scheduledAt', order: 'asc' },
  sent: { field: 'sentAt', order: 'desc' },
} as const;

const emailInclude = {
  campaign: { select: { subject: true, body: true, delayMs: true, hourlyLimit: true } },
  sender: { select: { name: true, email: true } },
} satisfies Prisma.EmailInclude;

type EmailRow = Prisma.EmailGetPayload<{ include: typeof emailInclude }>;

function toEmailDto(email: EmailRow) {
  return {
    id: email.id,
    campaignId: email.campaignId,
    to: email.toAddress,
    subject: email.campaign.subject,
    preview: email.campaign.body.slice(0, 160),
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    sender: email.sender,
    previewUrl: email.previewUrl,
    error: email.error,
    attempts: email.attempts,
    rescheduleCount: email.rescheduleCount,
  };
}

export interface ListQuery {
  view: EmailView;
  page: number;
  pageSize: number;
  q?: string;
}

export async function listEmails(userId: string, query: ListQuery) {
  const statuses = VIEW_STATUSES[query.view];
  const sort = VIEW_SORT[query.view];
  const skip = (query.page - 1) * query.pageSize;

  if (query.q) {
    try {
      const { ids, total } = await searchEmailIds(userId, {
        q: query.q,
        statuses,
        from: skip,
        size: query.pageSize,
        sortField: sort.field,
        sortOrder: sort.order,
      });
      // Hits only give us ids; the rows come from Postgres so status is never stale.
      const rows = await prisma.email.findMany({ where: { userId, id: { in: ids } }, include: emailInclude });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids
        .map((id) => byId.get(id))
        .filter((row): row is EmailRow => Boolean(row) && statuses.includes(row!.status))
        .map(toEmailDto);
      return { items, total, page: query.page, pageSize: query.pageSize, searchEngine: 'elasticsearch' as const };
    } catch (err) {
      logger.warn({ err: String(err) }, 'Elasticsearch search failed, falling back to Postgres');
    }
  }

  const where: Prisma.EmailWhereInput = {
    userId,
    status: { in: statuses },
    ...(query.q && {
      OR: [
        { toAddress: { contains: query.q, mode: 'insensitive' } },
        { campaign: { subject: { contains: query.q, mode: 'insensitive' } } },
      ],
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.email.findMany({
      where,
      include: emailInclude,
      orderBy: [{ [sort.field]: sort.order }, { sequence: 'asc' }],
      skip,
      take: query.pageSize,
    }),
    prisma.email.count({ where }),
  ]);

  return {
    items: rows.map(toEmailDto),
    total,
    page: query.page,
    pageSize: query.pageSize,
    searchEngine: query.q ? ('postgres' as const) : null,
  };
}

export async function emailCounts(userId: string) {
  const groups = await prisma.email.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } });
  const byStatus = new Map(groups.map((group) => [group.status, group._count._all]));
  const sum = (statuses: EmailStatus[]) => statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

  return {
    scheduled: sum(VIEW_STATUSES.scheduled),
    sent: sum(VIEW_STATUSES.sent),
    failed: byStatus.get('FAILED') ?? 0,
  };
}

export async function getEmail(userId: string, id: string) {
  const email = await prisma.email.findFirst({ where: { id, userId }, include: emailInclude });
  if (!email) throw new HttpError(404, 'Email not found');

  return {
    ...toEmailDto(email),
    body: email.campaign.body,
    messageId: email.messageId,
    campaign: { delayMs: email.campaign.delayMs, hourlyLimit: email.campaign.hourlyLimit },
    createdAt: email.createdAt.toISOString(),
  };
}
