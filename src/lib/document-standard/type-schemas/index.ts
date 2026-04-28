// Registry mapping a standard document type to its Zod schema and a
// minimal valid example. The MCP `get_type_schema` tool reads this
// registry directly — there is no separate config to keep in sync.

import type { z } from 'zod';

import type { DocumentType } from '../constants';

import { canonicalSchema, canonicalExample } from './canonical';
import { decisionSchema, decisionExample } from './decision';
import { noteSchema, noteExample } from './note';
import { factSchema, factExample } from './fact';
import { procedureSchema, procedureExample } from './procedure';
import { entitySchema, entityExample } from './entity';
import { artifactSchema, artifactExample } from './artifact';

export interface TypeSchemaEntry {
  schema: z.ZodTypeAny;
  example: Record<string, unknown>;
}

export const typeSchemaRegistry: Record<DocumentType, TypeSchemaEntry> = {
  canonical: { schema: canonicalSchema, example: canonicalExample },
  decision: { schema: decisionSchema, example: decisionExample },
  note: { schema: noteSchema, example: noteExample },
  fact: { schema: factSchema, example: factExample },
  procedure: { schema: procedureSchema, example: procedureExample },
  entity: { schema: entitySchema, example: entityExample },
  artifact: { schema: artifactSchema, example: artifactExample },
};
