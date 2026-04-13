// Maps tool names to the permission action they require. Consumed by
// the executor's permission check (Step 3 of the pipeline).
//
// Pre-MVP only ships read tools — write entries stay commented out so the
// intent is obvious, but the map itself only contains the four read tools
// the MCP server will expose. When Phase 1 adds write tools we flip the
// commented lines on and update the executor's scope-check logic.

export type ToolAction = 'read' | 'write';

export const TOOL_ACTION_MAP: Record<string, ToolAction> = {
  // Read tools (Pre-MVP)
  search_documents: 'read',
  get_document: 'read',
  get_document_diff: 'read',
  get_diff_history: 'read',

  // Write tools — Phase 1 (listed here so the map is discoverable but
  // not registered; uncomment as each tool ships)
  // create_document: 'write',
  // update_document: 'write',
  // delete_document: 'write',
};
