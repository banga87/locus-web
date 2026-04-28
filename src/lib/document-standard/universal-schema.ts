// Zod schema for the universal frontmatter block — the seven keys
// every document type carries (id, title, type, source, topics,
// confidence, status). Per-type schemas (./type-schemas/*) layer on
// top via the master validator in ./validate.ts.
//
// `type` accepts both standard types (canonical, decision, note,
// fact, procedure, entity, artifact) and the three reserved system
// types (agent-scaffolding, agent-definition, skill) without nagging
// — reserved types skip per-type validation entirely. Anything else
// is rejected.
//
// NOTE: This codebase uses Zod v4. The `error` option on z.enum and
// z.string replaces v3's `errorMap`. The shape is otherwise identical.

import { z } from 'zod';

import {
  DOCUMENT_TYPES,
  RESERVED_TYPES,
  SOURCE_PREFIXES,
  type DocumentType,
  type ReservedType,
} from './constants';

const allowedTypes = [...DOCUMENT_TYPES, ...RESERVED_TYPES] as const;

export const universalSchema = z.object({
  id: z.string().min(1, 'id is required'),
  title: z.string().min(1, 'title is required'),
  type: z.enum(allowedTypes, {
    error: () => ({
      message: `type must be one of: ${allowedTypes.join(', ')}`,
    }),
  }),
  source: z
    .string()
    .min(1, 'source is required')
    .refine(
      (s) => SOURCE_PREFIXES.some((p) => s.startsWith(p)),
      `source must start with one of: ${SOURCE_PREFIXES.join(', ')} (e.g., "agent:claude-code", "human:angus")`,
    ),
  topics: z
    .array(z.string().min(1))
    .min(1, 'must include at least 1 topic')
    .max(5, 'must include between 1 and 5 topics'),
  confidence: z.enum(['low', 'medium', 'high']),
  status: z.enum(['active', 'archived', 'superseded', 'draft']),
});

export type UniversalParsed = z.infer<typeof universalSchema>;

export interface ValidationError {
  field: string;
  message: string;
}

export type UniversalResult =
  | { ok: true; value: UniversalParsed }
  | { ok: false; errors: ValidationError[] };

/**
 * Wrapper over `universalSchema.safeParse` that flattens Zod issues
 * into the {field, message} shape consumed by the master validator
 * and by the MCP write tools' error envelopes.
 */
export function validateUniversal(input: unknown): UniversalResult {
  const result = universalSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? String(issue.path[0]) : '_',
      message: issue.message,
    })),
  };
}

export function isReservedTypeValue(
  value: string,
): value is ReservedType {
  return (RESERVED_TYPES as readonly string[]).includes(value);
}

export function isStandardTypeValue(
  value: string,
): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}
