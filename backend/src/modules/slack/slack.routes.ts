import { Router } from 'express';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { currentUser, requireAuth, requireAuthPage } from '../../middleware/require-auth.js';
import { buildInstallUrl, completeInstall, disconnectSlack, getSlackStatus, isSlackConfigured, sendSlackMessage } from './slack.service.js';

export const slackRouter = Router();

const backToApp = (result: string) => `${env.FRONTEND_URL}/?slack=${result}`;

slackRouter.get('/status', requireAuth, async (req, res) => {
  res.json(await getSlackStatus(currentUser(req).id));
});

// Opened as a normal browser navigation from the "Connect Slack" button.
slackRouter.get('/connect', requireAuthPage, (req, res) => {
  if (!isSlackConfigured()) return res.redirect(backToApp('not_configured'));
  res.redirect(buildInstallUrl(currentUser(req).id));
});

// Slack redirects here after the user approves (or cancels). The user is identified by `state`.
slackRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(backToApp('cancelled'));
  if (typeof code !== 'string' || typeof state !== 'string') return res.redirect(backToApp('error'));

  try {
    await completeInstall(code, state);
    res.redirect(backToApp('connected'));
  } catch (err) {
    logger.error({ err: String(err) }, 'Slack install failed');
    res.redirect(backToApp('error'));
  }
});

slackRouter.post('/test', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const sent = await sendSlackMessage(user.id, {
    text: `:wave: Test message from ReachInbox for ${user.name}. Rate-limit alerts will show up in this channel.`,
  });
  if (!sent) throw new HttpError(409, 'Slack is not connected');
  res.status(204).end();
});

slackRouter.delete('/', requireAuth, async (req, res) => {
  await disconnectSlack(currentUser(req).id);
  res.status(204).end();
});
