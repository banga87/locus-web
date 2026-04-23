// src/lib/frontmatter/schemas/index.ts

import type { FrontmatterSchema } from './types';

/**
 * Registry of all known FrontmatterSchemas, keyed by the value of the
 * doc's `type` column. Empty today — a regular skill has no panel-driven
 * frontmatter (frontmatter is user-authored). The per-panel logic for
 * rendering `triggerSchema` in-place lives in the frontmatter panel
 * component; the schema is imported directly from `./skill-trigger`.
 */
export const schemaRegistry: Record<string, FrontmatterSchema> = {};

/** Resolve a schema by doc type. Returns null when unregistered or null. */
export function getSchema(type: string | null): FrontmatterSchema | null {
  if (!type) return null;
  return schemaRegistry[type] ?? null;
}

export type { FrontmatterSchema, FrontmatterField, ValidateResult, ValidationError } from './types';
