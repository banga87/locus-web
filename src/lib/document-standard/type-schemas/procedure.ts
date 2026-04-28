import { z } from 'zod';

export const procedureSchema = z.object({
  applies_to: z
    .array(z.string().min(1))
    .min(1, 'applies_to must list at least one trigger context'),
  prerequisites: z.array(z.string().min(1)).optional(),
});

export const procedureExample = {
  applies_to: ['refund-request'],
};
