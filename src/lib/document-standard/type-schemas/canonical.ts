import { z } from 'zod';

export const canonicalSchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  last_reviewed_at: z.string().min(1, 'last_reviewed_at is required (ISO date)'),
});

export const canonicalExample = {
  owner: 'angus',
  last_reviewed_at: '2026-04-01',
};
