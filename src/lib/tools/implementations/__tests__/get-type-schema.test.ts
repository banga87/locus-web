import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupCompany,
  createSeededCompany,
  type TestCompany,
} from '@/__tests__/integration/helpers';
import { executeTool } from '@/lib/tools/executor';
import { registerLocusTools } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools/types';
import { getTypeSchemaTool } from '../get-type-schema';

describe('get_type_schema tool', () => {
  let ctx: TestCompany;

  beforeAll(async () => {
    ctx = await createSeededCompany('get-type');
    registerLocusTools();
  }, 60_000);

  afterAll(async () => {
    if (ctx) await cleanupCompany(ctx);
  }, 60_000);

  function buildContext(): ToolContext {
    return {
      actor: {
        type: 'agent_token',
        id: 'test-token-id',
        scopes: ['read'],
      },
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      tokenId: 'test-token-id',
      grantedCapabilities: [],
      webCallsThisTurn: 0,
    };
  }

  it('is read-only', () => {
    expect(getTypeSchemaTool.isReadOnly()).toBe(true);
  });

  it('returns required + optional fields and an example for canonical', async () => {
    const result = await executeTool(
      'get_type_schema',
      { type: 'canonical' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      required_fields: Record<string, unknown>;
      examples: unknown[];
    };
    expect(Object.keys(data.required_fields)).toEqual(
      expect.arrayContaining(['owner', 'last_reviewed_at']),
    );
    expect(data.examples.length).toBeGreaterThan(0);
  });

  it('rejects an unknown type with invalid_input', async () => {
    const result = await executeTool(
      'get_type_schema',
      { type: 'novel-type' },
      buildContext(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // Note: the executor's ajv validation rejects with `invalid_input`
      // (lowercase) before the tool's call() runs, since the JSON schema
      // declares `type` as enum. The tool's own INVALID_INPUT branch is
      // unreachable from this path, but kept in the implementation as
      // belt-and-braces for callers that bypass the executor.
      expect(result.error!.code).toBe('invalid_input');
    }
  });
});
