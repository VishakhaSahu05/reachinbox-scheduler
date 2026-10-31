import { z } from 'zod';

export const MAX_RECIPIENTS = 10_000;

export const ScheduleCampaignSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().trim().min(1, 'Body is required').max(50_000),
  recipients: z
    .array(z.string().trim().toLowerCase().email())
    .min(1, 'Add at least one recipient')
    .max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} recipients per campaign`),
  startAt: z.coerce.date(),
  delayBetweenEmailsSec: z.coerce.number().min(0).max(86_400),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
});

export type ScheduleCampaignInput = z.infer<typeof ScheduleCampaignSchema>;
