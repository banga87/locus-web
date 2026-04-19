// runSubagent — the dispatcher called by the `Agent` parent-side tool when
// the Platform Agent invokes a built-in subagent. Orchestrates:
//
//   1. Registry lookup for the requested agent type.
//   2. Fresh AgentContext construction (new sessionId, inherited actor + abort).
//   3. ToolContext shim for buildToolSet + filter by the def's allow/deny lists.
//   4. SubagentStart hook gate.
//   5. Model resolution (gateway) with a placeholder for the 'inherit' branch.
//   6. runAgentTurn execution, draining its typed event generator for text
//      + usage + finishReason.
//   7. Usage attribution (source=subagent, parentUsageRecordId FK).
//   8. Optional outputContract post-hoc validation.
//   9. Audit emission (category 'agent', event 'subagent.invoked').
//
// Notes on deviations from the original sketch:
//   - The parent actor type `AgentActor['type']` includes `'autonomous_agent'`
//     which is NOT in the audit `ActorType` union. When that happens we
//     widen to `'platform_agent'` for the audit row — the pilot callers are
//     all platform_agent anyway, so this is a defence-in-depth mapping.
//   - `recordUsage` requires an ApprovedModelId (dotted form). The 'inherit'
//     placeholder resolves to `'anthropic/claude-sonnet-4.6'` per the spec
//     §11 follow-up note.

import { randomUUID } from 'node:crypto';
import { stepCountIs } from 'ai';

import { runAgentTurn } from '@/lib/agent/run';
import { buildToolSet } from '@/lib/agent/tool-bridge';
import { runHook } from '@/lib/agent/hooks';
import type { AgentContext } from '@/lib/agent/types';
import { resolveModel } from '@/lib/models/resolve';
import type { ApprovedModelId } from '@/lib/models/approved-models';
import { logEvent } from '@/lib/audit/logger';
import type { ActorType } from '@/lib/audit/types';
import { recordUsage } from '@/lib/usage/record';

import { filterSubagentTools } from './filter';
import { validateOutputContract } from './validators';
import { getBuiltInAgent, getBuiltInAgents } from './registry';
import type {
  BuiltInAgentDefinition,
  SubagentDispatchContext,
  SubagentInvocation,
  SubagentResult,
} from './types';

type Status = 'ok' | 'validator_failed' | 'aborted' | 'provider_error';

/**
 * The pilot placeholder for the 'inherit' model branch. Spec §11 flags
 * full parent-model threading as a follow-up; until then we pin the
 * default to Sonnet 4.6 so behaviour is predictable for callers.
 */
const INHERIT_DEFAULT_MODEL: ApprovedModelId = 'anthropic/claude-sonnet-4.6';

/**
 * Map the parent's `AgentActor.type` onto an audit `ActorType`. The two
 * enums share `'platform_agent'` and `'maintenance_agent'` but the agent
 * harness adds `'autonomous_agent'` which the audit schema hasn't adopted
 * yet. Fall back to `'platform_agent'` in that gap so audit rows still
 * write cleanly. See module header for rationale.
 */
function toAuditActorType(type: AgentContext['actor']['type']): ActorType {
  if (type === 'platform_agent' || type === 'maintenance_agent') {
    return type;
  }
  return 'platform_agent';
}

interface EmitAuditParams {
  ctx: AgentContext;
  subagentType: string;
  status: Status | 'unknown_type';
  parentUsageRecordId: string | null;
  usageRecordId: string | null;
  modelId: string;
  reason?: string;
  requestedType?: string;
}

function emitAudit({
  ctx,
  subagentType,
  status,
  parentUsageRecordId,
  usageRecordId,
  modelId,
  reason,
  requestedType,
}: EmitAuditParams): void {
  logEvent({
    companyId: ctx.companyId,
    category: 'agent',
    eventType: 'subagent.invoked',
    actorType: toAuditActorType(ctx.actor.type),
    actorId: ctx.actor.userId ?? 'subagent',
    brainId: ctx.brainId,
    sessionId: ctx.sessionId ?? undefined,
    details: {
      status,
      subagentType,
      modelId,
      usageRecordId,
      parentUsageRecordId,
      ...(reason ? { reason } : {}),
      ...(requestedType ? { requestedType } : {}),
    },
  });
}

export async function runSubagent(
  dispatchCtx: SubagentDispatchContext,
  invocation: SubagentInvocation,
): Promise<SubagentResult> {
  const { parentCtx, parentUsageRecordId } = dispatchCtx;
  const def: BuiltInAgentDefinition | undefined = getBuiltInAgent(
    invocation.subagent_type,
  );

  // --- 1. Unknown type → early return with audit ---------------------------
  if (!def) {
    const available = getBuiltInAgents()
      .map((a) => a.agentType)
      .join(', ');
    emitAudit({
      ctx: parentCtx,
      subagentType: invocation.subagent_type,
      status: 'unknown_type',
      parentUsageRecordId,
      usageRecordId: null,
      // Use a sentinel model id for the unknown path — `recordUsage` is
      // never called here and the audit consumer only reads this field
      // descriptively.
      modelId: 'unknown',
      requestedType: invocation.subagent_type,
    });
    return {
      ok: false,
      error: `Unknown subagent_type: ${invocation.subagent_type}. Available: ${available || 'none'}`,
    };
  }

  // --- 2. Fresh AgentContext for the subagent ------------------------------
  // Preserve actor + brain + abort; null out session so subagent turns
  // don't leak into the parent's session_turns stream.
  const subCtx: AgentContext = {
    actor: parentCtx.actor,
    brainId: parentCtx.brainId,
    companyId: parentCtx.companyId,
    sessionId: null,
    agentDefinitionId: `builtin:${def.agentType}`,
    abortSignal: parentCtx.abortSignal,
    grantedCapabilities: parentCtx.grantedCapabilities,
  };

  // --- 3. Build + filter tools --------------------------------------------
  // buildToolSet takes a ToolContext (flatter shape than AgentContext).
  // Mirror the chat route's translation (see app/api/agent/chat/route.ts).
  const toolCtx = {
    actor: {
      type: toAuditActorType(parentCtx.actor.type),
      id: parentCtx.actor.userId ?? 'subagent',
      scopes: parentCtx.actor.scopes,
    },
    companyId: parentCtx.companyId,
    brainId: parentCtx.brainId,
    sessionId: parentCtx.sessionId ?? undefined,
    abortSignal: parentCtx.abortSignal,
    grantedCapabilities: parentCtx.grantedCapabilities,
    agentSkillIds: [] as string[],
    webCallsThisTurn: 0,
  };
  const fullToolset = buildToolSet(toolCtx, {}, {});
  const tools = filterSubagentTools(fullToolset, def);

  // --- 4. SubagentStart hook gate -----------------------------------------
  const parentTurnId = randomUUID();
  const hookDecision = await runHook({
    name: 'SubagentStart',
    ctx: subCtx,
    subagentType: def.agentType,
    parentTurnId,
  });
  if (hookDecision.decision === 'deny') {
    return { ok: false, error: `Hook denied: ${hookDecision.reason}` };
  }

  // --- 5. Model resolution -------------------------------------------------
  const modelId: ApprovedModelId =
    def.model === 'inherit' ? INHERIT_DEFAULT_MODEL : def.model;
  const modelHandle = resolveModel(def.agentType, modelId);

  // --- 6/7. Run the turn, drain events ------------------------------------
  let status: Status = 'ok';
  let text = '';
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: undefined as number | undefined,
  };

  try {
    const { events } = await runAgentTurn({
      ctx: subCtx,
      system: def.getSystemPrompt(),
      messages: [{ role: 'user', content: invocation.prompt }],
      tools,
      modelHandle,
      stopWhen: stepCountIs(def.maxTurns ?? 15),
    });
    for await (const evt of events) {
      if (evt.type === 'llm_delta') {
        text += evt.delta;
      } else if (evt.type === 'turn_complete') {
        usage = {
          inputTokens: evt.usage.inputTokens,
          outputTokens: evt.usage.outputTokens,
          totalTokens: evt.usage.totalTokens,
          cachedInputTokens: evt.usage.cachedInputTokens,
        };
        if (evt.finishReason === 'aborted') {
          status = 'aborted';
        }
      }
    }
  } catch {
    status = 'provider_error';
  }

  // --- 8. Usage attribution (subagent source + parent FK) -----------------
  let usageRecordId: string | null = null;
  if (usage.totalTokens > 0) {
    const row = await recordUsage({
      companyId: subCtx.companyId,
      sessionId: null,
      userId: subCtx.actor.userId,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedInputTokens: usage.cachedInputTokens,
      source: 'subagent',
      parentUsageRecordId,
    });
    usageRecordId = row?.id ?? null;
  }

  // --- 9. Output contract validation (ok-path only) -----------------------
  if (status === 'ok' && def.outputContract) {
    const v = validateOutputContract(text, def.outputContract);
    if (!v.ok) {
      status = 'validator_failed';
      emitAudit({
        ctx: subCtx,
        subagentType: def.agentType,
        status,
        parentUsageRecordId,
        usageRecordId,
        modelId,
        reason: v.reason,
      });
      return { ok: false, error: v.reason, partialText: text };
    }
  }

  // --- 10. Terminal audit event -------------------------------------------
  emitAudit({
    ctx: subCtx,
    subagentType: def.agentType,
    status,
    parentUsageRecordId,
    usageRecordId,
    modelId,
  });

  // --- 11. Return --------------------------------------------------------
  if (status !== 'ok') {
    return {
      ok: false,
      error: `Subagent finished with status=${status}`,
      partialText: text,
    };
  }
  return { ok: true, text, usage, subagentType: def.agentType };
}
