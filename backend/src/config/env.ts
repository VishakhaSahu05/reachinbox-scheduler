import 'dotenv/config';
import { z } from 'zod';

const count = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: count(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('emails'),

  SESSION_SECRET: z.string().min(16, 'must be at least 16 characters'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: count(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: count(200),
  MAX_EMAILS_PER_HOUR: count(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  SEND_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),

  MAIL_TRANSPORT: z.enum(['smtp', 'stub']).default('smtp'),
  ETHEREAL_SENDER_COUNT: count(3),
  ETHEREAL_SENDERS: z.string().optional(),
});

// Treat `KEY=` in .env as "not set" so defaults and optional checks behave.
const input = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
const parsed = EnvSchema.safeParse(input);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  GOOGLE_REDIRECT_URI: raw.GOOGLE_REDIRECT_URI ?? `${raw.APP_URL}/api/auth/google/callback`,
  SLACK_REDIRECT_URI: raw.SLACK_REDIRECT_URI ?? `${raw.APP_URL}/api/slack/callback`,
  isProduction: raw.NODE_ENV === 'production',
};
