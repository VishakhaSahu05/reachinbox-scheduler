import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number };
}

// Same endpoint nodemailer.createTestAccount() uses. We call it directly because nodemailer
// caches the first account per process, and we want several distinct senders.
async function createEtherealAccount(): Promise<EtherealAccount> {
  const response = await fetch('https://api.nodemailer.com/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestor: 'reachinbox-scheduler', version: '1.0.0' }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json()) as EtherealAccount & { status?: string; error?: string };
  if (data.status !== 'success') throw new Error(`Could not create an Ethereal account: ${data.error ?? response.status}`);
  return data;
}

const ConfiguredSenders = z.array(
  z.object({
    name: z.string().optional(),
    user: z.string().email(),
    pass: z.string().min(1),
    host: z.string().default('smtp.ethereal.email'),
    port: z.coerce.number().int().default(587),
  }),
);

/**
 * Makes sure there are SMTP senders to choose from. Senders listed in ETHEREAL_SENDERS are
 * upserted on every boot; otherwise, on first boot, fresh Ethereal accounts are created and saved.
 */
export async function ensureSenders(): Promise<void> {
  if (env.ETHEREAL_SENDERS) {
    const senders = ConfiguredSenders.parse(JSON.parse(env.ETHEREAL_SENDERS));
    for (const [i, sender] of senders.entries()) {
      const data = {
        name: sender.name ?? `Sender ${i + 1}`,
        smtpHost: sender.host,
        smtpPort: sender.port,
        smtpUser: sender.user,
        smtpPass: sender.pass,
      };
      await prisma.sender.upsert({ where: { email: sender.user }, create: { email: sender.user, ...data }, update: data });
    }
    return;
  }

  if ((await prisma.sender.count()) > 0) return;

  for (let i = 1; i <= env.ETHEREAL_SENDER_COUNT; i++) {
    if (env.MAIL_TRANSPORT === 'stub') {
      await prisma.sender.create({
        data: { name: `Sender ${i}`, email: `sender${i}@example.test`, smtpHost: 'stub', smtpPort: 0, smtpUser: 'stub', smtpPass: 'stub' },
      });
      continue;
    }
    const account = await createEtherealAccount();
    await prisma.sender.create({
      data: {
        name: `Sender ${i}`,
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPass: account.pass,
      },
    });
    logger.info({ email: account.user }, 'Created Ethereal sender account (run `npm run senders` for its login)');
  }
}

export async function listSenders() {
  const senders = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
  return senders.map((sender) => ({ id: sender.id, name: sender.name, email: sender.email }));
}
