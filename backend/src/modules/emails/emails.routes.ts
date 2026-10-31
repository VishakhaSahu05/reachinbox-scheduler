import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../middleware/require-auth.js';
import { emailCounts, getEmail, listEmails } from './emails.service.js';

const ListQuerySchema = z.object({
  view: z.enum(['scheduled', 'sent']).default('scheduled'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((q) => q || undefined),
});

export const emailsRouter = Router();

emailsRouter.get('/', async (req, res) => {
  const query = ListQuerySchema.parse(req.query);
  res.json(await listEmails(currentUser(req).id, query));
});

emailsRouter.get('/counts', async (req, res) => {
  res.json(await emailCounts(currentUser(req).id));
});

emailsRouter.get('/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.json({ email: await getEmail(currentUser(req).id, id) });
});
