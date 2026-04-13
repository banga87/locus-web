// MCP tool registration.
//
// The Tool Executor validates inputs via ajv / JSON Schema. The MCP SDK
// validates inputs via Zod. To avoid double-validation drift, we keep
// the Zod schemas here loose — they describe the shape the MCP client
// must send, but the authoritative check is the JSON Schema on the
// underlying tool definition. The executor re-validates on every call.
//
// Each handler delegates to `handleToolCall` which runs the full
// auth → context → executor pipeline.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { handleToolCall } from './handler';

/**
 * Register the four Pre-MVP read tools on an MCP server instance. Called
 * once per Vercel Function invocation — `McpServer` holds no persistent
 * state and tool definitions are cheap to register.
 *
 * The `request` parameter is captured in every tool handler closure so
 * per-call auth can read the incoming Authorization header.
 */
export function registerMcpTools(
  server: McpServer,
  request: Request,
): void {
  server.tool(
    'search_documents',
    'Full-text search across brain documents. Returns ranked results with snippets. ' +
      'Filter by category slug, cap results with max_results. Use when you need to ' +
      'locate information by content rather than by known path.',
    {
      query: z.string().min(1),
      category: z.string().optional(),
      max_results: z.number().int().min(1).max(50).optional(),
    },
    async (input) =>
      handleToolCall({
        toolName: 'search_documents',
        rawInput: input,
        request,
      }),
  );

  server.tool(
    'get_document',
    'Read a document by path or id. Returns YAML frontmatter + markdown body by default. ' +
      'Use the `section` parameter to fetch a single H2 section and save tokens.',
    {
      path: z.string().optional(),
      id: z.string().uuid().optional(),
      section: z.string().optional(),
      include_metadata: z.boolean().optional(),
    },
    async (input) =>
      handleToolCall({
        toolName: 'get_document',
        rawInput: input,
        request,
      }),
  );

  server.tool(
    'get_document_diff',
    'View recent version history for a single document. Returns an ordered list ' +
      'of versions with author, timestamp, and change summary.',
    {
      document_id: z.string().uuid(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (input) =>
      handleToolCall({
        toolName: 'get_document_diff',
        rawInput: input,
        request,
      }),
  );

  server.tool(
    'get_diff_history',
    'View brain-wide changes since a given timestamp. Pass the `brain_version` ' +
      'from your last interaction as `since` to get only new changes.',
    {
      since: z.string().datetime(),
      category: z.string().optional(),
      include_content_preview: z.boolean().optional(),
    },
    async (input) =>
      handleToolCall({
        toolName: 'get_diff_history',
        rawInput: input,
        request,
      }),
  );
}
