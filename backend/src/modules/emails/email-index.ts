import type { EmailStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { elastic } from '../../lib/elasticsearch.js';
import { logger } from '../../lib/logger.js';

const INDEX = env.ELASTICSEARCH_INDEX;

export interface EmailSearchDoc {
  id: string;
  userId: string;
  campaignId: string;
  senderEmail: string;
  to: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

interface IndexableEmail {
  id: string;
  userId: string;
  campaignId: string;
  toAddress: string;
  status: EmailStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}

export function toSearchDoc(
  email: IndexableEmail,
  campaign: { subject: string; body: string },
  senderEmail: string,
): EmailSearchDoc {
  return {
    id: email.id,
    userId: email.userId,
    campaignId: email.campaignId,
    senderEmail,
    to: email.toAddress,
    subject: campaign.subject,
    body: campaign.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
  };
}

export async function ensureEmailIndex(): Promise<void> {
  if (await elastic.indices.exists({ index: INDEX })) return;

  try {
    await elastic.indices.create({
      index: INDEX,
      settings: {
        analysis: {
          // Splits "john.doe@acme.io" into john / doe / acme / io so partial addresses match.
          tokenizer: { email_parts: { type: 'pattern', pattern: '[^\\p{L}\\p{N}]+' } },
          analyzer: { email_parts: { type: 'custom', tokenizer: 'email_parts', filter: ['lowercase'] } },
        },
      },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          campaignId: { type: 'keyword' },
          senderEmail: { type: 'keyword' },
          to: { type: 'search_as_you_type', analyzer: 'email_parts', fields: { raw: { type: 'keyword' } } },
          subject: { type: 'search_as_you_type' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          createdAt: { type: 'date' },
        },
      },
    });
    logger.info({ index: INDEX }, 'Created Elasticsearch index');
  } catch (err) {
    // Another process may have created it at the same moment.
    if (!String(err).includes('resource_already_exists_exception')) throw err;
  }
}

// Postgres is the source of truth; the search index is best effort and can be rebuilt with `npm run reindex`.
export async function indexEmailDocs(docs: EmailSearchDoc[]): Promise<void> {
  const chunkSize = 1000;
  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    try {
      const result = await elastic.bulk({
        operations: chunk.flatMap((doc) => [{ index: { _index: INDEX, _id: doc.id } }, doc]),
      });
      if (result.errors) {
        const failed = result.items.filter((item) => item.index?.error).length;
        logger.warn({ failed }, 'Some emails could not be indexed');
      }
    } catch (err) {
      logger.warn({ err: String(err), count: chunk.length }, 'Elasticsearch bulk index failed');
    }
  }
}

export async function indexEmailDoc(doc: EmailSearchDoc): Promise<void> {
  try {
    await elastic.index({ index: INDEX, id: doc.id, document: doc });
  } catch (err) {
    logger.warn({ err: String(err), emailId: doc.id }, 'Elasticsearch index failed');
  }
}

export interface SearchParams {
  q: string;
  statuses: EmailStatus[];
  from: number;
  size: number;
  sortField: 'scheduledAt' | 'sentAt';
  sortOrder: 'asc' | 'desc';
}

const SEARCH_FIELDS = ['to^3', 'to._2gram', 'to._3gram', 'subject^2', 'subject._2gram', 'subject._3gram', 'body'];

export async function searchEmailIds(userId: string, params: SearchParams): Promise<{ ids: string[]; total: number }> {
  // Every word has to match somewhere (to, subject or body), and each word works as a prefix,
  // so "john acme" finds john@acme.io and "rl-b" doesn't drag in everything starting with "b".
  const words = params.q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
  if (words.length === 0) return { ids: [], total: 0 };

  const result = await elastic.search({
    index: INDEX,
    from: params.from,
    size: params.size,
    track_total_hits: true,
    _source: false,
    query: {
      bool: {
        filter: [{ term: { userId } }, { terms: { status: params.statuses } }],
        must: words.map((word) => ({ multi_match: { query: word, type: 'bool_prefix' as const, fields: SEARCH_FIELDS } })),
      },
    },
    sort: ['_score', { [params.sortField]: { order: params.sortOrder } }],
  });

  const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
  return { ids: result.hits.hits.map((hit) => hit._id!).filter(Boolean), total };
}
