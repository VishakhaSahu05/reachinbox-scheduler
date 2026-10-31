import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { readSessionUserId } from '../modules/auth/session.js';

async function loadUser(req: Request): Promise<User | null> {
  const userId = readSessionUserId(req);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = await loadUser(req);
  if (!user) throw new HttpError(401, 'Please sign in');
  req.user = user;
  next();
}

// For pages opened directly in the browser (Bull Board, OAuth starts): send people to the login screen.
export async function requireAuthPage(req: Request, res: Response, next: NextFunction) {
  const user = await loadUser(req);
  if (!user) return res.redirect(`${env.FRONTEND_URL}/login`);
  req.user = user;
  next();
}

export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
}
