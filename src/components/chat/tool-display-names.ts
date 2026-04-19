// Human-friendly tool-name rendering for chat indicators.
//
// Internal tool names are terse (`search_documents`, `get_document`) and
// external MCP tools come through the bridge namespaced as
// `ext_<12hex>_<remote-name>` (see `src/lib/mcp-out/bridge.ts`). Neither
// shape is what we want to show a human. This helper turns both into
// conversational strings the message-bubble can render inline.
//
// Keeping the heuristic in one file so we can evolve it (e.g. Phase 2
// adds verbose tool names per category) without touching the indicator.
//
// Two helpers:
//   - `displayToolName(name, args)` → sentence for the pending state
//     ("Reading Brand Voice", "Searching brain").
//   - `pillToolName(name, args)` → short label for the collapsed chip
//     ("Brand Voice", "Search").
//
// If we can't figure it out, we fall back to the raw tool name cleaned
// up (underscores → spaces, title-cased) so nothing ever renders as a
// raw identifier.

interface ArgsLike {
  path?: unknown;
  query?: unknown;
  id?: unknown;
  skill_id?: unknown;
  relative_path?: unknown;
  [key: string]: unknown;
}

/**
 * Shorten a UUID-like skill id to an 8-char prefix with an ellipsis so the
 * fallback label is recognisable without being overwhelming.
 * Non-UUID strings are returned unchanged (truncated at 12 chars).
 */
function truncateId(id: string): string {
  if (id.length > 8) return `${id.slice(0, 8)}…`;
  return id;
}

/**
 * Turn a brain document path into a human label. Paths are slash-
 * separated and human-readable already (e.g. `brand/voice`,
 * `products/launch-plan`). We keep all segments so the user knows
 * which area was opened, replace separators with spaces, and
 * title-case. `brand/voice` → "Brand Voice"; `products/launch-plan`
 * → "Products Launch Plan". Single-segment paths stay short:
 * `voice` → "Voice".
 */
function prettyPath(path: string): string {
  return path
    .split('/')
    .map((seg) => seg.replace(/[-_]+/g, ' ').trim())
    .filter((seg) => seg.length > 0)
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Strip the `ext_<12hex>_` prefix that `buildToolKey` adds to external
 * MCP tool names. Returns the "real" remote name so the user sees what
 * the external server actually calls it.
 */
function stripExtPrefix(name: string): string {
  const m = /^ext_[0-9a-f]{12}_(.+)$/.exec(name);
  return m ? m[1] : name;
}

/**
 * Friendlier version of a raw tool name: underscores → spaces, title-case.
 * `search_documents` → "Search Documents".
 */
function humanise(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Sentence-cased pending string, shown next to a spinner:
 *   "Reading Brand Voice…" / "Searching brain…" / "Using Hubspot contacts…"
 *
 * For brain tools we know enough about the args to pick a sharper verb.
 * For external tools we fall back to "Using <cleaned name>" because we
 * don't know what the tool does.
 */
export function displayToolName(name: string, args: unknown): string {
  const a = (args ?? {}) as ArgsLike;

  switch (name) {
    case 'search_documents':
      return 'Searching brain';
    case 'get_document': {
      if (typeof a.path === 'string' && a.path.length > 0) {
        return `Reading ${prettyPath(a.path)}`;
      }
      return 'Reading document';
    }
    case 'get_document_diff':
      return 'Comparing document versions';
    case 'get_diff_history':
      return 'Checking edit history';
    case 'load_skill': {
      const idLabel =
        typeof a.skill_id === 'string' && a.skill_id.length > 0
          ? truncateId(a.skill_id)
          : 'skill';
      return `Loading skill (${idLabel})`;
    }
    case 'read_skill_file': {
      const idLabel =
        typeof a.skill_id === 'string' && a.skill_id.length > 0
          ? truncateId(a.skill_id)
          : 'skill';
      const pathLabel =
        typeof a.relative_path === 'string' && a.relative_path.length > 0
          ? a.relative_path
          : 'file';
      return `Reading skill file (${idLabel}) \u203a ${pathLabel}`;
    }
  }

  if (name.startsWith('ext_')) {
    return `Using ${humanise(stripExtPrefix(name))}`;
  }

  return `Using ${humanise(name)}`;
}

/**
 * Short label for the collapsed pill chip, shown AFTER the tool finishes:
 *   "Used: Brand Voice" / "Used: Search" / "Used: Hubspot contacts"
 *
 * The verb "Used" lives in the indicator component; this returns just the
 * label noun.
 */
export function pillToolName(name: string, args: unknown): string {
  const a = (args ?? {}) as ArgsLike;

  switch (name) {
    case 'search_documents':
      return 'Search';
    case 'get_document':
      if (typeof a.path === 'string' && a.path.length > 0) {
        return prettyPath(a.path);
      }
      return 'Document';
    case 'get_document_diff':
      return 'Diff';
    case 'get_diff_history':
      return 'Edit history';
    case 'load_skill': {
      const idLabel =
        typeof a.skill_id === 'string' && a.skill_id.length > 0
          ? truncateId(a.skill_id)
          : 'skill';
      return `Skill (${idLabel})`;
    }
    case 'read_skill_file': {
      const pathLabel =
        typeof a.relative_path === 'string' && a.relative_path.length > 0
          ? a.relative_path
          : 'file';
      return `Skill file: ${pathLabel}`;
    }
  }

  if (name.startsWith('ext_')) {
    return humanise(stripExtPrefix(name));
  }

  return humanise(name);
}
