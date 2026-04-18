// src/lib/frontmatter/schemas/index.ts

import type { FrontmatterSchema } from './types';
import { workflowSchema } from './workflow';

/**
 * Registry of all known FrontmatterSchemas, keyed by the value of the
 * doc's `type` column. Add a new entry here when a new typed doc lands.
 */
export const schemaRegistry: Record<string, FrontmatterSchema> = {
  workflow: workflowSchema,
};

/** Resolve a schema by doc type. Returns null when unregistered or null. */
export function getSchema(type: string | null): FrontmatterSchema | null {
  if (!type) return null;
  return schemaRegistry[type] ?? null;
}

export type { FrontmatterSchema, FrontmatterField, ValidateResult, ValidationError } from './types';
