// MCP dispatcher — ties auth + context + executor together.
//
// Called from the per-tool handlers registered in `tools.ts`. Every MCP
// tool invocation flows through here so auth, rate limiting (stubbed),
// and context assembly happen in exactly one place.
//
// Pre-MVP: `checkRateLimit()` is a stub that always returns { allowed: true }.
// Real rate limiting lands in Phase 2 alongside the rate_limits table and
// per-token counters. Per ADR-003, MCP is free for MVP so no enforcement
// is required today — but every caller of `handleToolCall` already goes
// through this function, which means the Phase 2 swap will be a one-liner.

import { executeTool } from '@/lib/tools/executor';
import { registerLocusTools } from '@/lib/tools';
import { getBrainForCompany } from '@/lib/brain/queries';

import { authenticateAgentToken } from './auth';
import { buildToolContext } from './context';
import {
  formatMcpError,
  formatMcpResponse,
  type McpToolResponse,
} from './response';

/**
 * Authoritative allowlist of tool names exposed over MCP IN.
 *
 * The shared tool registry (`registerLocusTools`) contains write tools
 * (create_document, update_document) for the Platform Agent's use, but
 * the MCP IN surface must stay read-only per the MVP contract. This
 * allowlist is the defence-in-depth check — the MCP SDK registrar in
 * `./tools.ts` already only calls `server.tool(...)` for these four
 * names (so `tools/list` correctly advertises only them), but any direct
 * call into `handleToolCall` (e.g. a crafted request bypassing the SDK's
 * list surface) would reach `executeTool` and succeed for a write tool
 * if scope + role gates passed. This allowlist prevents that.
 *
 * Exported so `./tools.ts` can assert that every `server.tool(...)`
 * registration is covered — compile-time link between the two lists,
 * so growth/drift requires updating both sides.
 */
export const MCP_ALLOWED_TOOLS = new Set<string>([
  'search_documents',
  'get_document',
  'get_document_diff',
  'get_diff_history',
  'get_taxonomy',
  'get_type_schema',
]);

// Log-once-per-cold-start flag so we can see in logs that the stub is
// active but don't spam it on every request.
let warnedRateStub = false;

async function checkRateLimit(): Promise<{ allowed: true }> {
  // TODO: Phase 2 — real per-token rate limiting.
  if (!warnedRateStub) {
    console.log('[mcp] rate limiting is stubbed (Pre-MVP)');
    warnedRateStub = true;
  }
  return { allowed: true };
}

export interface HandleToolCallParams {
  toolName: string;
  rawInput: unknown;
  request: Request;
}

/**
 * Drive a single MCP tool call end-to-end:
 *   auth → rate limit → context → executor → MCP response envelope.
 *
 * Never throws. All failure modes surface as MCP error envelopes so the
 * calling LLM can read the message and adapt.
 */
export async function handleToolCall(
  params: HandleToolCallParams,
): Promise<McpToolResponse> {
  const auth = await authenticateAgentToken(params.request);
  if (!auth.ok) {
    return formatMcpError(auth.code, auth.message);
  }

  await checkRateLimit();

  // Idempotent — safe to call on every request. No-op after the first.
  registerLocusTools();

  // MCP IN read-only allowlist. The shared tool registry includes write
  // tools for the Platform Agent; MCP IN must not be able to reach them.
  // Fail with `unknown_tool` so the external surface behaves exactly as
  // if the write tool weren't registered at all (consistent with the
  // `server.tool(...)` list in `./tools.ts`).
  if (!MCP_ALLOWED_TOOLS.has(params.toolName)) {
    return formatMcpError(
      'unknown_tool',
      `No tool named '${params.toolName}' is available over MCP.`,
    );
  }

  let brainId: string;
  try {
    const brain = await getBrainForCompany(auth.companyId);
    brainId = brain.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Brain lookup failed.';
    return formatMcpError('brain_not_found', message);
  }

  const context = buildToolContext({
    tokenId: auth.tokenId,
    companyId: auth.companyId,
    brainId,
    scopes: auth.scopes,
  });

  const result = await executeTool(params.toolName, params.rawInput, context);
  return formatMcpResponse(result);
}

// --- Test hooks -----------------------------------------------------------

/** Reset the rate-limit-stub warning flag. Call between tests. */
export function __resetMcpHandlerForTests(): void {
  warnedRateStub = false;
}
