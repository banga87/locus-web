import { describe, it, expectTypeOf } from 'vitest';
import type { LocusTool, ToolContext } from '../types';
import type { AgentContext } from '@/lib/agent/types';

describe('type surface extensions', () => {
  it('LocusTool accepts an optional capabilities array', () => {
    const t: LocusTool = {
      name: 'x',
      description: 'x',
      inputSchema: {},
      capabilities: ['web'],
      action: 'read' as const,
      isReadOnly: () => true,
      call: async () => ({
        success: true,
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      }),
    };
    expectTypeOf(t.capabilities).toEqualTypeOf<string[] | undefined>();
  });

  it('ToolContext requires grantedCapabilities and webCallsThisTurn', () => {
    expectTypeOf<ToolContext>()
      .toHaveProperty('grantedCapabilities')
      .toEqualTypeOf<string[]>();
    expectTypeOf<ToolContext>()
      .toHaveProperty('webCallsThisTurn')
      .toEqualTypeOf<number>();
  });

  it('AgentContext requires grantedCapabilities', () => {
    expectTypeOf<AgentContext>()
      .toHaveProperty('grantedCapabilities')
      .toEqualTypeOf<string[]>();
  });
});
