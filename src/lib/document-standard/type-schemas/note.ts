import { z } from 'zod';

export const noteSchema = z.object({
  captured_from: z.enum(['meeting', 'slack', 'call', 'email', 'other']),
  participants: z.array(z.string().min(1)).optional(),
  promotes_to: z.string().optional(),
});

export const noteExample = {
  captured_from: 'meeting' as const,
};
