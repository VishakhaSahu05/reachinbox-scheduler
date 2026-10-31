import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

const SESSION_COOKIE = 'ri_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function cookieOptions(maxAge: number, path = '/'): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: env.isProduction, maxAge, path };
}

export function issueSession(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, env.SESSION_SECRET, { expiresIn: SESSION_TTL_MS / 1000 });
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS));
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionUserId(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, env.SESSION_SECRET);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
