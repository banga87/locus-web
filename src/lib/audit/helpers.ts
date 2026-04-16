// Typed convenience wrappers around `logEvent()` for the two Pre-MVP
// event categories: `document_access` (Tool Executor reads) and
// `authentication` (auth layer + MCP token validation outcomes).
//
// Helpers for `document_mutation`, `proposal`, `confidence`, `maintenance`,
// `administration`, and `token_usage` are deliberately NOT implemented here
// — they land in MVP / Phase 1 when the owning components ship.

import { logEvent } from './logger';
import type { ActorType } from './types';

// ---------- document_access ----------------------------------------------
//
// Logged by the Tool Executor. The `details` shape is inferred from the
// tool name + tokens served; see 07-audit-logging.md "document_access".

export function logDocumentAccess(params: {
  companyId: string;
  actorType: ActorType;
  actorId: string;
  actorName?: string;
  documentId: string;
  tool: string;
  section?: string | null;
  tokensServed: number;
  sessionId?: string;
  tokenId?: string;
}): void {
  logEvent({
    companyId: params.companyId,
    category: 'document_access',
    // Tool name maps 1:1 to event type per the design doc's table:
    //   read_document     -> document.read
    //   search_brain      -> document.search
    //   get_manifest      -> manifest.read
    //   get_brain_context -> context.read
    //   get_brain_diff    -> diff.read
    eventType: toolToEventType(params.tool),
    actorType: params.actorType,
    actorId: params.actorId,
    actorName: params.actorName,
    targetType: 'document',
    targetId: params.documentId,
    details: {
      tool: params.tool,
      section: params.section ?? null,
      tokensServed: params.tokensServed,
    },
    sessionId: params.sessionId,
    tokenId: params.tokenId,
  });
}

function toolToEventType(tool: string): string {
  switch (tool) {
    case 'read_document':
      return 'document.read';
    case 'search_brain':
      return 'document.search';
    case 'get_manifest':
      return 'manifest.read';
    case 'get_brain_context':
      return 'context.read';
    case 'get_brain_diff':
      return 'diff.read';
    default:
      // Fall back to the raw tool name. Better than silently dropping the
      // event — an unknown tool still deserves an audit row, and the
      // caller can fix the mapping later.
      return `document.${tool}`;
  }
}

// ---------- authentication -----------------------------------------------
//
// Logged by the auth layer and the MCP server. `eventType` is a constrained
// union matching the design doc's auth event table.

export type AuthEventType =
  | 'auth.login'
  | 'auth.failed'
  | 'token.created'
  | 'token.revoked'
  | 'token.used';

export function logAuthEvent(params: {
  companyId: string;
  actorType: ActorType;
  actorId: string;
  actorName?: string;
  eventType: AuthEventType;
  details?: Record<string, unknown>;
  ipAddress?: string;
  sessionId?: string;
  tokenId?: string;
  // 'pat' | 'oauth' for token-backed events, null otherwise. Matches the
  // `token_type` column added in the MCP-IN OAuth migration. Optional so
  // existing call sites that predate OAuth don't need to pass it.
  tokenType?: 'pat' | 'oauth' | null;
  // Per design doc: token events target the token owner's user id;
  // login events have no target (actor is the target).
  targetUserId?: string;
}): void {
  logEvent({
    companyId: params.companyId,
    category: 'authentication',
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId,
    actorName: params.actorName,
    targetType: params.targetUserId ? 'user' : undefined,
    targetId: params.targetUserId,
    details: params.details ?? {},
    ipAddress: params.ipAddress,
    sessionId: params.sessionId,
    tokenId: params.tokenId,
    tokenType: params.tokenType ?? null,
  });
}
