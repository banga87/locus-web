// Master document-frontmatter validator. Combines:
//   - Universal schema (./universal-schema.ts) — id, title, type,
//     source, topics, confidence, status
//   - Per-type schema (./type-schemas/*) — type-specific fields
//   - Topic vocabulary check — every topic must be a canonical term
//
// Returns a single, flat ValidationError[] across all three layers so
// callers (write tools, Maintenance Agent step 1) can report
// everything wrong in one round trip.
//
// Reserved types (agent-scaffolding, agent-definition, skill) skip
// per-type validation — their schemas are owned by the agent / skill
// subsystems. Topic and universal validation still apply.

import { z } from 'zod';

import { isStandardType, isReservedType, type DocumentType } from './constants';
import { validateUniversal, type ValidationError } from './universal-schema';
import { typeSchemaRegistry } from './type-schemas';

import type { Vocabulary } from '@/lib/taxonomy/types';

export type DocumentValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a parsed YAML frontmatter object against the document
 * standard. The vocabulary is required and is normally fetched once
 * per request via `getTaxonomy(brainId)`.
 */
export function validateDocumentFrontmatter(
  input: unknown,
  vocabulary: Vocabulary,
): DocumentValidateResult {
  const errors: ValidationError[] = [];

  // ---- Universal layer --------------------------------------------------
  const universal = validateUniversal(input);
  if (!universal.ok) {
    errors.push(...universal.errors);
    // Without a valid universal result we still continue — we want to
    // aggregate errors from all layers.
  }

  // ---- Per-type layer --------------------------------------------------
  // Extract the raw type from the input regardless of whether universal
  // validation passed. This allows all three layers to run and surface
  // errors together, rather than bailing out after the first failure.
  const rawType =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>).type
      : undefined;
  if (
    typeof rawType === 'string' &&
    isStandardType(rawType) &&
    !isReservedType(rawType)
  ) {
    const entry = typeSchemaRegistry[rawType as DocumentType];
    const result = entry.schema.safeParse(input);
    if (!result.success) {
      errors.push(...flattenZod(result.error));
    }
  }
  // Reserved-type docs skip the per-type step (their schemas are
  // external to the document standard).

  // ---- Topic vocabulary layer ------------------------------------------
  const rawTopics =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>).topics
      : null;
  if (Array.isArray(rawTopics)) {
    const validTerms = new Set(vocabulary.terms);
    for (const t of rawTopics) {
      if (typeof t !== 'string') continue; // universal layer already complained
      if (validTerms.has(t)) continue;
      const synonym = vocabulary.synonyms[t];
      const hint = synonym
        ? `Use "${synonym}" instead.`
        : 'Out-of-vocabulary topic. Call get_taxonomy to see allowed terms.';
      errors.push({
        field: 'topics',
        message: `"${t}" is not in the workspace vocabulary. ${hint}`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as Record<string, unknown> };
}

function flattenZod(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? String(issue.path[0]) : '_',
    message: issue.message,
  }));
}
