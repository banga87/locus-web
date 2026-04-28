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

import { handleToolCall, MCP_ALLOWED_TOOLS } from './handler';

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
  // Track names as we register them. After the four `server.tool(...)`
  // calls we assert exact parity with `MCP_ALLOWED_TOOLS` so the two
  // lists cannot drift: adding a tool to one side without the other
  // crashes a dev / CI build before it ships.
  const registered = new Set<string>();

  server.tool(
    'search_documents',
    'Full-text and semantic search across the Tatara brain. Returns ranked ' +
      'results with snippets, document ids, types, and confidence levels. ' +
      'Use when you need to locate information by content rather than by known ' +
      'path. Always run a search before proposing a new document — duplicates ' +
      'are common and the Maintenance Agent will flag them. ' +
      'Filters: type (canonical | decision | note | fact | procedure | entity | artifact), ' +
      'folder (/company | /customers | /market | /product | /marketing | /operations | /signals), ' +
      'topics (array of topic tags), confidence_min (low | medium | high), ' +
      'max_results (1–50, default 10).',
    {
      query: z.string().min(1),
      folder: z.string().optional(),
      type: z.string().optional(),
      topics: z.array(z.string()).optional(),
      confidence_min: z.enum(['low', 'medium', 'high']).optional(),
      max_results: z.number().int().min(1).max(50).optional(),
    },
    async (input) =>
      handleToolCall({
        toolName: 'search_documents',
        rawInput: input,
        request,
      }),
  );
  registered.add('search_documents');

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
  registered.add('get_document');

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
  registered.add('get_document_diff');

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
  registered.add('get_diff_history');

  server.tool(
    'get_taxonomy',
    "Returns the workspace's allowed folders, document types, and topic " +
      'vocabulary. Cache the result for the duration of your session — ' +
      'taxonomy changes infrequently. Call once at the start of any session ' +
      'that may write to the brain. Without taxonomy, you cannot construct ' +
      'valid documents. Returns: folders (slug + description), types (name + ' +
      'description), topics (controlled vocabulary), source_format (how to ' +
      'format the source field).',
    {},
    async (input) =>
      handleToolCall({
        toolName: 'get_taxonomy',
        rawInput: input,
        request,
      }),
  );
  registered.add('get_taxonomy');

  server.tool(
    'get_type_schema',
    'Returns the YAML frontmatter schema for a given document type — required ' +
      'fields, optional fields, and value constraints. Call before writing a ' +
      'document of a type you have not written before in this session. Type ' +
      'must be one of: canonical, decision, note, fact, procedure, entity, artifact.',
    {
      type: z.enum([
        'canonical',
        'decision',
        'note',
        'fact',
        'procedure',
        'entity',
        'artifact',
      ]),
    },
    async (input) =>
      handleToolCall({
        toolName: 'get_type_schema',
        rawInput: input,
        request,
      }),
  );
  registered.add('get_type_schema');

  // Compile-time link to `MCP_ALLOWED_TOOLS` — the gate in `./handler.ts`
  // rejects any tool name not in that set with `unknown_tool`, so a name
  // registered here but missing from the set would be unreachable, and
  // vice versa. Assert exact parity.
  for (const name of MCP_ALLOWED_TOOLS) {
    if (!registered.has(name)) {
      throw new Error(
        `[mcp] MCP_ALLOWED_TOOLS includes "${name}" but registerMcpTools does not register it. Update src/lib/mcp/tools.ts.`,
      );
    }
  }
  for (const name of registered) {
    if (!MCP_ALLOWED_TOOLS.has(name)) {
      throw new Error(
        `[mcp] registerMcpTools registered "${name}" but MCP_ALLOWED_TOOLS does not permit it. Update src/lib/mcp/handler.ts.`,
      );
    }
  }
}
