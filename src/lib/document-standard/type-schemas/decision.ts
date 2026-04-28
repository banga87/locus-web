import { z } from 'zod';

export const decisionSchema = z.object({
  decided_by: z
    .array(z.string().min(1))
    .min(1, 'decided_by must list at least one actor'),
  decided_on: z.string().min(1, 'decided_on is required (ISO date)'),
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
});

export const decisionExample = {
  decided_by: ['angus'],
  decided_on: '2026-04-01',
};
