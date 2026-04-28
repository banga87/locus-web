import { z } from 'zod';

export const factSchema = z.object({
  evidence: z.string().min(1, 'evidence is required (URL or doc id)'),
  valid_from: z.string().min(1, 'valid_from is required (ISO date)'),
  valid_to: z.string().optional(),
});

export const factExample = {
  evidence: 'doc-revenue-q4',
  valid_from: '2026-01-01',
};
