import { z } from 'zod';

export const artifactSchema = z.object({
  lifecycle: z.enum(['draft', 'live', 'archived']),
  version: z.number().int().nonnegative(),
  owner: z.string().min(1, 'owner is required'),
  launched_at: z.string().optional(),
  retired_at: z.string().optional(),
  channel: z.enum(['email', 'web', 'social', 'event', 'other']).optional(),
});

export const artifactExample = {
  lifecycle: 'draft' as const,
  version: 1,
  owner: 'angus',
};
