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
import { loadSkillTool } from './implementations/load-skill';
import { readSkillFileTool } from './implementations/read-skill-file';
import { createDocumentTool } from './implementations/create-document';
import { updateDocumentTool } from './implementations/update-document';
import { getTaxonomyTool } from './implementations/get-taxonomy';
import { getTypeSchemaTool } from './implementations/get-type-schema';

let registered = false;

/**
 * Register all tools on the shared executor registry. Safe to call
 * multiple times — subsequent calls are no-ops.
 */
export function registerLocusTools(): void {
  if (registered) return;
  // Read tools
  registerTool(searchDocumentsTool);
  registerTool(getDocumentTool);
  registerTool(getDocumentDiffTool);
  registerTool(getDiffHistoryTool);
  registerTool(webSearchTool);
  registerTool(webFetchTool);
  // Skill tools
  registerTool(loadSkillTool);
  registerTool(readSkillFileTool);
  // Write tools (Task 2)
  registerTool(createDocumentTool);
  registerTool(updateDocumentTool);
  // Discovery tools (Task 11 + 12)
  registerTool(getTaxonomyTool);
  registerTool(getTypeSchemaTool);
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
  loadSkillTool,
  readSkillFileTool,
  createDocumentTool,
  updateDocumentTool,
  getTaxonomyTool,
  getTypeSchemaTool,
};
