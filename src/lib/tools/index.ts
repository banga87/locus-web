// Tool registration entrypoint. The MCP server (Task 8) and tests call
// `registerLocusTools()` before dispatching — we do NOT auto-register at
// import time because (a) tests need to reset the registry between cases
// and (b) the MCP server may want to register a reduced set once we grow
// beyond four tools.

import { registerTool } from './executor';
import { searchDocumentsTool } from './implementations/search-documents';
import { getDocumentTool } from './implementations/get-document';
import { getDocumentDiffTool } from './implementations/get-document-diff';
import { getDiffHistoryTool } from './implementations/get-diff-history';
import { webSearchTool } from './implementations/web-search';
import { webFetchTool } from './implementations/web-fetch';

let registered = false;

/**
 * Register all Pre-MVP read tools on the shared executor registry. Safe
 * to call multiple times — subsequent calls are no-ops.
 */
export function registerLocusTools(): void {
  if (registered) return;
  registerTool(searchDocumentsTool);
  registerTool(getDocumentTool);
  registerTool(getDocumentDiffTool);
  registerTool(getDiffHistoryTool);
  registerTool(webSearchTool);
  registerTool(webFetchTool);
  registered = true;
}

/** Test hook: re-enable registration after `__resetRegistryForTests()`. */
export function __resetLocusToolsRegistered(): void {
  registered = false;
}

export {
  searchDocumentsTool,
  getDocumentTool,
  getDocumentDiffTool,
  getDiffHistoryTool,
  webSearchTool,
  webFetchTool,
};
