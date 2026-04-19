// AgentTool tests.
//
// Strategy: mock `runSubagent` so the tool's execute path never actually
// dispatches — all we care about here is the schema shape, the per-turn
// cap, and the getter-based parent usage id threading. The dispatcher's
// own behaviour is covered in runSubagent.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (hoisted) ------------------------------------------------------

vi.mock('../runSubagent', () => ({
  runSubagent: vi.fn(),
}));

// --- Imports after mocks --------------------------------------------------

import type { z } from 'zod';

import { runSubagent } from '../runSubagent';
import { buildAgentTool } from '../AgentTool';
import type { AgentContext } from '@/lib/agent/types';
import type { SubagentResult } from '../types';

// The AI SDK v6 `tool()` helper widens `inputSchema` to a `FlexibleSchema`
// union at the type level, which hides Zod's `.parse` from TypeScript
// even though at runtime the schema IS a Zod schema (verified against
// AI SDK 6.0.158 internals). Cast through a narrow helper so the tests
// read naturally.
type ZodObj = z.ZodObject<{
  description: z.ZodString;
  subagent_type: z.ZodString;
  prompt: z.ZodString;
}>;
function schemaOf(t: ReturnType<typeof buildAgentTool>): ZodObj {
  return t.inputSchema as unknown as ZodObj;
}

// --- Fixtures -------------------------------------------------------------

function buildParentCtx(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  return {
    actor: {
      type: 'platform_agent',
      userId: 'u-parent',
      companyId: 'co-parent',
      scopes: ['read'],
    },
    brainId: 'b-parent',
    companyId: 'co-parent',
    sessionId: 'sess-parent',
    abortSignal: new AbortController().signal,
    grantedCapabilities: ['web'],
    ...overrides,
  };
}

function buildValidInput() {
  return {
    description: 'find docs',
    subagent_type: 'BrainExplore',
    prompt: 'look for invoicing docs',
  };
}

function buildOkResult(): SubagentResult {
  return {
    ok: true,
    text: 'ok',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    subagentType: 'BrainExplore',
  };
}

// --- Lifecycle ------------------------------------------------------------

beforeEach(() => {
  vi.mocked(runSubagent).mockReset();
  vi.mocked(runSubagent).mockResolvedValue(buildOkResult());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe('buildAgentTool', () => {
  describe('input schema', () => {
    it('accepts valid calls', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      const parsed = schemaOf(agentTool).parse(buildValidInput());
      expect(parsed).toEqual(buildValidInput());
    });

    it('rejects empty prompt', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      expect(() =>
        schemaOf(agentTool).parse({
          ...buildValidInput(),
          prompt: '',
        }),
      ).toThrow();
    });

    it('rejects description shorter than 3 chars', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      expect(() =>
        schemaOf(agentTool).parse({
          ...buildValidInput(),
          description: 'hi',
        }),
      ).toThrow();
    });

    it('rejects description longer than 60 chars', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      expect(() =>
        schemaOf(agentTool).parse({
          ...buildValidInput(),
          description: 'x'.repeat(61),
        }),
      ).toThrow();
    });

    it('rejects missing subagent_type', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      expect(() =>
        schemaOf(agentTool).parse({
          description: 'find docs',
          prompt: 'look for invoicing docs',
        }),
      ).toThrow();
    });
  });

  describe('execute', () => {
    it('forwards invocation and parent ctx to runSubagent', async () => {
      const parentCtx = buildParentCtx();
      const agentTool = buildAgentTool({
        parentCtx,
        getParentUsageRecordId: () => 'parent-usage-123',
        description: 'Dispatch a subagent.',
      });
      const input = buildValidInput();
      const result = await (agentTool.execute as (i: unknown) => Promise<unknown>)(
        input,
      );
      expect(runSubagent).toHaveBeenCalledTimes(1);
      expect(runSubagent).toHaveBeenCalledWith(
        { parentCtx, parentUsageRecordId: 'parent-usage-123' },
        input,
      );
      expect(result).toEqual(buildOkResult());
    });

    it('re-reads parentUsageRecordId via getter on each call', async () => {
      let current: string | null = null;
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => current,
        description: 'Dispatch a subagent.',
      });
      await (agentTool.execute as (i: unknown) => Promise<unknown>)(
        buildValidInput(),
      );
      current = 'landed-later';
      await (agentTool.execute as (i: unknown) => Promise<unknown>)(
        buildValidInput(),
      );
      const calls = vi.mocked(runSubagent).mock.calls;
      expect(calls[0][0].parentUsageRecordId).toBeNull();
      expect(calls[1][0].parentUsageRecordId).toBe('landed-later');
    });

    it('returns structured error for unknown subagent_type at execute time', async () => {
      vi.mocked(runSubagent).mockResolvedValueOnce({
        ok: false,
        error: 'Unknown subagent_type: Nope. Available: BrainExplore',
      });
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
      });
      const result = (await (
        agentTool.execute as (i: unknown) => Promise<unknown>
      )({
        description: 'try bogus',
        subagent_type: 'Nope',
        prompt: 'does not matter',
      })) as { ok: boolean; error?: string };
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown subagent_type');
    });

    it('enforces per-parent-turn cap (default 10)', async () => {
      const cap = { limit: 10, count: 0 };
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
        cap,
      });
      const exec = agentTool.execute as (i: unknown) => Promise<unknown>;
      // 10 allowed calls
      for (let i = 0; i < 10; i++) {
        const r = (await exec(buildValidInput())) as { ok: boolean };
        expect(r.ok).toBe(true);
      }
      // 11th is capped
      const capped = (await exec(buildValidInput())) as {
        ok: boolean;
        error?: string;
      };
      expect(capped.ok).toBe(false);
      expect(capped.error).toContain('cap');
      expect(capped.error).toContain('10');
      // runSubagent was only invoked 10 times, not 11
      expect(runSubagent).toHaveBeenCalledTimes(10);
    });

    it('respects a custom cap limit', async () => {
      const cap = { limit: 2, count: 0 };
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
        cap,
      });
      const exec = agentTool.execute as (i: unknown) => Promise<unknown>;
      expect(((await exec(buildValidInput())) as { ok: boolean }).ok).toBe(
        true,
      );
      expect(((await exec(buildValidInput())) as { ok: boolean }).ok).toBe(
        true,
      );
      const third = (await exec(buildValidInput())) as {
        ok: boolean;
        error?: string;
      };
      expect(third.ok).toBe(false);
      expect(third.error).toContain('2');
      expect(runSubagent).toHaveBeenCalledTimes(2);
    });

    it('allows concurrent calls below the cap', async () => {
      // Hold the mocked runSubagent so all three calls are in-flight at
      // the same moment. We want to prove the cap increments SYNCHRONOUSLY
      // on entry (before the await settles) — otherwise parallel calls
      // could all squeak past a limit=3 check and exceed it.
      let resolveAll: (v: SubagentResult) => void = () => {};
      const gated = new Promise<SubagentResult>((resolve) => {
        resolveAll = resolve;
      });
      vi.mocked(runSubagent).mockImplementation(() => gated);

      const cap = { limit: 3, count: 0 };
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
        cap,
      });
      const exec = agentTool.execute as (i: unknown) => Promise<unknown>;
      const p1 = exec(buildValidInput());
      const p2 = exec(buildValidInput());
      const p3 = exec(buildValidInput());
      // All three entered, cap should be at the limit now.
      expect(cap.count).toBe(3);
      expect(runSubagent).toHaveBeenCalledTimes(3);
      // Release and assert all three resolved OK.
      resolveAll(buildOkResult());
      const results = (await Promise.all([p1, p2, p3])) as Array<{
        ok: boolean;
      }>;
      for (const r of results) {
        expect(r.ok).toBe(true);
      }
    });

    it('does not increment the cap counter when capped', async () => {
      const cap = { limit: 1, count: 0 };
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent.',
        cap,
      });
      const exec = agentTool.execute as (i: unknown) => Promise<unknown>;
      await exec(buildValidInput());
      expect(cap.count).toBe(1);
      await exec(buildValidInput()); // capped
      // Count must stay at 1 (not incremented on rejection).
      expect(cap.count).toBe(1);
    });
  });

  describe('description', () => {
    it('uses the provided description string', () => {
      const agentTool = buildAgentTool({
        parentCtx: buildParentCtx(),
        getParentUsageRecordId: () => null,
        description: 'Dispatch a subagent to do a thing.',
      });
      expect(agentTool.description).toBe(
        'Dispatch a subagent to do a thing.',
      );
    });
  });
});
