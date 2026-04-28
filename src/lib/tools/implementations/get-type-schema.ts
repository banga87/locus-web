// get_type_schema — returns the frontmatter schema for one of the
// seven standard document types. The output shape is denormalised
// from the per-type Zod schemas so external agents can read field
// names + value constraints without parsing Zod internals.

import { z } from 'zod';

import {
  DOCUMENT_TYPES,
  isStandardType,
  type DocumentType,
} from '@/lib/document-standard/constants';
import { typeSchemaRegistry } from '@/lib/document-standard/type-schemas';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetTypeSchemaInput {
  type: string;
}

interface FieldSpec {
  description: string;
  value_constraint: string;
}

interface GetTypeSchemaOutput {
  type: DocumentType;
  required_fields: Record<string, FieldSpec>;
  optional_fields: Record<string, FieldSpec>;
  examples: Record<string, unknown>[];
}

export const getTypeSchemaTool: LocusTool<
  GetTypeSchemaInput,
  GetTypeSchemaOutput
> = {
  name: 'get_type_schema',
  description:
    'Returns the YAML frontmatter schema for a given document type — required ' +
    'fields, optional fields, and value constraints. Call before writing a ' +
    'document of a type you have not written before in this session. ' +
    `Type must be one of: ${DOCUMENT_TYPES.join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...DOCUMENT_TYPES] },
    },
    required: ['type'],
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    input: GetTypeSchemaInput,
    _context: ToolContext,
  ): Promise<ToolResult<GetTypeSchemaOutput>> {
    if (!isStandardType(input.type)) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: `Unknown type "${input.type}". Use get_taxonomy to list valid types.`,
          hint: `Valid types: ${DOCUMENT_TYPES.join(', ')}`,
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    const entry = typeSchemaRegistry[input.type];
    const { required, optional } = describeZodObject(
      entry.schema as z.ZodObject<z.ZodRawShape>,
    );

    return {
      success: true,
      data: {
        type: input.type,
        required_fields: required,
        optional_fields: optional,
        examples: [entry.example],
      },
      metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
    };
  },
};

/**
 * Walk a Zod object schema and produce human-readable field specs. The
 * output isn't a full JSON Schema — it's a flat description aimed at an
 * LLM agent constructing a frontmatter block.
 */
function describeZodObject(schema: z.ZodObject<z.ZodRawShape>): {
  required: Record<string, FieldSpec>;
  optional: Record<string, FieldSpec>;
} {
  const required: Record<string, FieldSpec> = {};
  const optional: Record<string, FieldSpec> = {};

  const shape = schema.shape;
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const isOptional = fieldSchema instanceof z.ZodOptional;
    // Use .unwrap() (Zod v4 API) rather than ._def.innerType to avoid the
    // $ZodType vs ZodType variance mismatch in strict TS mode.
    const inner: z.ZodTypeAny = isOptional
      ? (fieldSchema as z.ZodOptional<z.ZodTypeAny>).unwrap()
      : (fieldSchema as z.ZodTypeAny);
    const spec: FieldSpec = {
      description: '',
      value_constraint: describeZodType(inner),
    };
    if (isOptional) optional[name] = spec;
    else required[name] = spec;
  }
  return { required, optional };
}

function describeZodType(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodEnum) {
    // Zod v4: _def.values is undefined; use schema.options instead
    return `one of: ${(schema.options as readonly string[]).join(', ')}`;
  }
  if (schema instanceof z.ZodArray) {
    // Zod v4: _def.type holds the string 'array'; use schema.element instead
    return `array of ${describeZodType(schema.element as z.ZodTypeAny)}`;
  }
  return 'value';
}
