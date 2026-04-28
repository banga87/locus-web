import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupCompany,
  createSeededCompany,
  type TestCompany,
} from '@/__tests__/integration/helpers';
import { executeTool } from '@/lib/tools/executor';
import { registerLocusTools } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools/types';
import { getTaxonomyTool } from '../get-taxonomy';
import { FOLDERS, DOCUMENT_TYPES } from '@/lib/document-standard/constants';

describe('get_taxonomy tool', () => {
  let ctx: TestCompany;

  beforeAll(async () => {
    ctx = await createSeededCompany('get-tax');
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
    expect(getTaxonomyTool.isReadOnly()).toBe(true);
  });

  it('returns folders, types, topics, and source_format', async () => {
    const result = await executeTool('get_taxonomy', {}, buildContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      folders: { slug: string }[];
      types: { type: string }[];
      topics: unknown[];
      source_format: string;
    };
    expect(data.folders.map((f) => f.slug)).toEqual(FOLDERS);
    expect(data.types.map((t) => t.type)).toEqual(DOCUMENT_TYPES);
    expect(data.topics.length).toBe(33);
    expect(data.source_format).toMatch(/agent:/);
    expect(data.source_format).toMatch(/human:/);
  });
});
