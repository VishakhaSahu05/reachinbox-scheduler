import { Router } from 'express';
import { currentUser } from '../../middleware/require-auth.js';
import { ScheduleCampaignSchema } from './campaigns.schema.js';
import { scheduleCampaign } from './campaigns.service.js';

export const campaignsRouter = Router();

campaignsRouter.post('/', async (req, res) => {
  const input = ScheduleCampaignSchema.parse(req.body);
  const idempotencyKey = req.get('Idempotency-Key')?.trim().slice(0, 200) || undefined;
  const result = await scheduleCampaign(currentUser(req).id, input, idempotencyKey);
  res.status(result.created ? 201 : 200).json(result);
});
