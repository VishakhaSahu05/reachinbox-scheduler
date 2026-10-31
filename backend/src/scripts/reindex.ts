// Rebuilds the Elasticsearch index from Postgres. Run: npm run reindex
import { elastic } from '../lib/elasticsearch.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { ensureEmailIndex, indexEmailDocs, toSearchDoc } from '../modules/emails/email-index.js';

async function main() {
  await ensureEmailIndex();
  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const batch = await prisma.email.findMany({
      include: { campaign: { select: { subject: true, body: true } }, sender: { select: { email: true } } },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;

    await indexEmailDocs(batch.map((email) => toSearchDoc(email, email.campaign, email.sender.email)));
    total += batch.length;
    cursor = batch[batch.length - 1].id;
  }

  logger.info({ total }, 'Reindex finished');
  await elastic.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'Reindex failed');
  process.exit(1);
});
