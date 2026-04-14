// ToolContext assembly for MCP calls.
//
// The Tool Executor expects a fully-formed `ToolContext`. The MCP server
// builds it from the authenticated token record + the brain resolved from
// the token's company. Keeping this split out of auth.ts so the auth
// layer stays focused on token validation and never needs to know about
// brain shape.

import type { ToolContext } from '@/lib/tools/types';

export function buildToolContext(params: {
  tokenId: string;
  companyId: string;
  brainId: string;
  scopes: string[];
}): ToolContext {
  return {
    actor: {
      type: 'agent_token',
      id: params.tokenId,
      scopes: params.scopes,
    },
    companyId: params.companyId,
    brainId: params.brainId,
    tokenId: params.tokenId,
    // Task 11 will derive this from the MCP actor + agent-definition.
    // For now the MCP server has no web capabilities — web_search +
    // web_fetch are Platform Agent-only surface.
    grantedCapabilities: [],
    webCallsThisTurn: 0,
  };
}
