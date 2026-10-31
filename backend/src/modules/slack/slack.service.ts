import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const REVOKE_URL = 'https://slack.com/api/auth.revoke';

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { channel: string; channel_id: string; url: string };
}

export function isSlackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

// The callback can arrive on a different host (e.g. an https tunnel) where the session cookie
// is not available, so the user id travels inside a signed, short-lived state token instead.
export function buildInstallUrl(userId: string): string {
  if (!isSlackConfigured()) throw new HttpError(503, 'Slack is not configured on this server');

  const state = jwt.sign({ uid: userId, purpose: 'slack-install' }, env.SESSION_SECRET, { expiresIn: '10m' });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID!);
  url.searchParams.set('scope', 'incoming-webhook');
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

function readInstallState(state: string): string {
  try {
    const payload = jwt.verify(state, env.SESSION_SECRET) as { uid?: string; purpose?: string };
    if (payload.purpose !== 'slack-install' || !payload.uid) throw new Error('wrong purpose');
    return payload.uid;
  } catch {
    throw new HttpError(400, 'Slack install link expired or invalid. Please try connecting again.');
  }
}

export async function completeInstall(code: string, state: string): Promise<void> {
  const userId = readInstallState(state);

  const response = await fetch(ACCESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as OAuthAccessResponse;

  if (!data.ok || !data.incoming_webhook || !data.team || !data.access_token) {
    throw new HttpError(400, `Slack rejected the install: ${data.error ?? 'missing incoming webhook'}`);
  }

  const connection = {
    teamId: data.team.id,
    teamName: data.team.name,
    channelId: data.incoming_webhook.channel_id,
    channelName: data.incoming_webhook.channel,
    webhookUrl: data.incoming_webhook.url,
    accessToken: data.access_token,
  };
  await prisma.slackConnection.upsert({
    where: { userId },
    create: { userId, ...connection },
    update: connection,
  });

  await postToWebhook(connection.webhookUrl, {
    text: ':white_check_mark: ReachInbox is connected. You will get a message here whenever a sender hits its hourly sending limit.',
  }).catch((err) => logger.warn({ err: String(err) }, 'Slack welcome message failed'));
}

export async function getSlackStatus(userId: string) {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  return {
    configured: isSlackConfigured(),
    connected: Boolean(connection),
    teamName: connection?.teamName ?? null,
    channelName: connection?.channelName ?? null,
    connectedAt: connection?.updatedAt.toISOString() ?? null,
  };
}

export async function disconnectSlack(userId: string): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) return;

  // Revoking the token uninstalls the app from the workspace, which also kills the webhook.
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.accessToken}` },
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => logger.warn({ err: String(err) }, 'Slack token revoke failed'));

  await prisma.slackConnection.deleteMany({ where: { userId } });
}

/** Returns false when the user has not connected Slack. Throws if Slack refuses the message. */
export async function sendSlackMessage(userId: string, message: SlackMessage): Promise<boolean> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) return false;
  await postToWebhook(connection.webhookUrl, message);
  return true;
}

async function postToWebhook(url: string, message: SlackMessage): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook responded ${response.status}: ${await response.text()}`);
  }
}
