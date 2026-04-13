// Derives the permission "resource" from a tool call. Pre-MVP returns
// brain-scope for everything — the Permission Evaluator lives in Phase 1
// and will take over the category/document-level breakdown.
//
// The return shape already matches what the future evaluator will accept
// so callers don't need to change when the real resolver lands.

import type { ToolContext } from './types';

export type ResolvedResource =
  | { type: 'brain'; brainId: string }
  | { type: 'category'; brainId: string; categoryId: string }
  | { type: 'document'; brainId: string; categoryId: string; documentId: string };

/**
 * Resolve the resource targeted by a tool call.
 *
 * Pre-MVP stub: returns `{ type: 'brain', brainId }` for every tool. The
 * MCP server is the only consumer today, and MCP tokens are brain-scoped.
 *
 * TODO: Phase 1 — pull category/document ids from tool inputs via
 *   Drizzle lookups (see 02-tool-executor.md §"Resource Resolution").
 */
export function resolveResource(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: unknown,
  context: ToolContext,
): ResolvedResource {
  return { type: 'brain', brainId: context.brainId };
}
