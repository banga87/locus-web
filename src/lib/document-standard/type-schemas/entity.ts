import { z } from 'zod';

export const entitySchema = z.object({
  kind: z.enum(['person', 'company', 'vendor']),
  relationship: z.enum(['customer', 'prospect', 'partner', 'team', 'other']),
  contact_points: z.array(z.string().min(1)).optional(),
  current_state: z.string().min(1, 'current_state is required (one-line summary)'),
  last_interaction: z.string().optional(),
});

export const entityExample = {
  kind: 'company' as const,
  relationship: 'customer' as const,
  current_state: 'Active subscriber, monthly billing',
};
