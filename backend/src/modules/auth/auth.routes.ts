import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { User } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { currentUser, requireAuth } from '../../middleware/require-auth.js';
import { exchangeGoogleCode, googleAuthUrl } from './google.js';
import { clearSession, cookieOptions, issueSession } from './session.js';

const STATE_COOKIE = 'ri_oauth_state';
const STATE_COOKIE_PATH = '/api/auth';

export function toUserDto(user: User) {
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

export const authRouter = Router();

authRouter.get('/google', (_req, res) => {
  const state = randomBytes(16).toString('hex');
  const url = googleAuthUrl(state);
  res.cookie(STATE_COOKIE, state, cookieOptions(10 * 60 * 1000, STATE_COOKIE_PATH));
  res.redirect(url);
});

authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

  if (error || typeof code !== 'string' || typeof state !== 'string' || state !== expectedState) {
    return res.redirect(`${env.FRONTEND_URL}/login?error=${error === 'access_denied' ? 'cancelled' : 'invalid_request'}`);
  }

  try {
    const profile = await exchangeGoogleCode(code);
    const user = await prisma.user.upsert({
      where: { googleId: profile.googleId },
      create: profile,
      update: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
    });
    issueSession(res, user.id);
    res.redirect(`${env.FRONTEND_URL}/`);
  } catch (err) {
    logger.error({ err }, 'Google sign-in failed');
    res.redirect(`${env.FRONTEND_URL}/login?error=google_failed`);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toUserDto(currentUser(req)) });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});
