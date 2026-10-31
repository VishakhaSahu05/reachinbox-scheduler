import { Router } from 'express';
import { listSenders } from './senders.service.js';

export const sendersRouter = Router();

sendersRouter.get('/', async (_req, res) => {
  res.json({ senders: await listSenders() });
});
