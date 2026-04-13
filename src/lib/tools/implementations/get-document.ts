// get_document — fetch a single document by path or id.
//
// Returns markdown content prefixed with a YAML frontmatter block that
// surfaces status / owner / confidence_level / is_core so the calling
// agent does not need a second round-trip to see key metadata. Enforces
// an 8,000 token response cap via truncation. On miss, returns
// `document_not_found` with fuzzy-match suggestions.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { users } from '@/db/schema/users';
import {
  serializeFrontmatter,
  type DocumentFrontmatter,
} from '@/lib/brain/frontmatter';
import { estimateTokens } from '../token-estimator';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetDocumentInput {
  path?: string;
  id?: string;
  section?: string;
  include_metadata?: boolean;
}

interface GetDocumentOutput {
  document: {
    content: string;
    path: string;
    id: string;
    title: string;
  };
}

const TOKEN_LIMIT = 8000;
const TRUNCATION_MARKER = '\n\n<!-- response truncated at 8000 tokens -->';

export const getDocumentTool: LocusTool<GetDocumentInput, GetDocumentOutput> = {
  name: 'get_document',
  description:
    'Read a document by path or id. Returns content with a YAML ' +
    'frontmatter prefix (status, owner, confidence, is_core). Optional ' +
    '`section` returns a single H2. Caps at 8,000 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      id: { type: 'string', format: 'uuid' },
      section: { type: 'string', minLength: 1 },
      include_metadata: { type: 'boolean' },
    },
    additionalProperties: false,
    // Exactly one of path or id must be present.
    oneOf: [{ required: ['path'] }, { required: ['id'] }],
  },

  isReadOnly() {
    return true;
  },

  async call(
    input: GetDocumentInput,
    context: ToolContext,
  ): Promise<ToolResult<GetDocumentOutput>> {
    const includeMetadata = input.include_metadata !== false;
    const section = input.section ?? null;

    // -------- Lookup ----------------------------------------------------
    const whereClause = input.id
      ? and(
          eq(documents.id, input.id),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        )
      : and(
          eq(documents.path, input.path!),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        );

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        path: documents.path,
        content: documents.content,
        status: documents.status,
        ownerId: documents.ownerId,
        confidenceLevel: documents.confidenceLevel,
        isCore: documents.isCore,
        updatedAt: documents.updatedAt,
        version: documents.version,
      })
      .from(documents)
      .where(whereClause)
      .limit(1);

    const doc = rows[0];
    if (!doc) {
      // Collect suggestions: all non-deleted paths in this brain, then
      // rank by a cheap fuzzy distance.
      const allPaths = await db
        .select({ path: documents.path })
        .from(documents)
        .where(
          and(
            eq(documents.brainId, context.brainId),
            isNull(documents.deletedAt),
          ),
        );

      const target = input.path ?? input.id ?? '';
      const suggestions = findSimilarPaths(
        target,
        allPaths.map((r) => r.path),
        3,
      );

      return {
        success: false,
        error: {
          code: 'document_not_found',
          message: `No document matches ${
            input.path ? `path '${input.path}'` : `id '${input.id}'`
          } in this brain.`,
          suggestions,
          hint: suggestions.length
            ? 'Try one of the suggested paths, or call search_documents to explore.'
            : 'Call search_documents to discover what paths exist in this brain.',
          retryable: false,
        },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
          details: {
            eventType: 'document.read',
            path: input.path ?? null,
            section_requested: section,
            found: false,
          },
        },
      };
    }

    // -------- Body (optionally sliced to a section) --------------------
    let body = doc.content;
    if (section) {
      const extracted = extractH2Section(doc.content, section);
      // Missing section is not an error — we return the full doc with a
      // note. Keeps the tool forgiving while the agent figures out what
      // sections exist. (If this proves noisy in practice we can flip it
      // to `document_not_found`; for Pre-MVP keep it permissive.)
      body =
        extracted ??
        `<!-- section '${section}' not found; returning full document -->\n\n${doc.content}`;
    }

    // -------- Owner email lookup ---------------------------------------
    let ownerEmail: string | null = null;
    if (doc.ownerId) {
      const ownerRows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, doc.ownerId))
        .limit(1);
      ownerEmail = ownerRows[0]?.email ?? null;
    }

    // -------- Assemble response -----------------------------------------
    let serialized: string;
    if (includeMetadata) {
      const meta: DocumentFrontmatter = {
        title: doc.title,
        path: doc.path,
        status: doc.status,
        owner: ownerEmail,
        confidenceLevel: doc.confidenceLevel,
        isCore: doc.isCore,
        updatedAt: doc.updatedAt.toISOString(),
        version: doc.version,
      };
      serialized = serializeFrontmatter(meta, body);
    } else {
      serialized = body;
    }

    // -------- Token-size cap --------------------------------------------
    let truncated = false;
    if (estimateTokens(serialized) > TOKEN_LIMIT) {
      // 4 chars per token is the estimator's rule; keep a little headroom
      // for the marker itself.
      const maxChars = TOKEN_LIMIT * 4 - TRUNCATION_MARKER.length;
      serialized = serialized.slice(0, maxChars) + TRUNCATION_MARKER;
      truncated = true;
    }

    return {
      success: true,
      data: {
        document: {
          content: serialized,
          path: doc.path,
          id: doc.id,
          title: doc.title,
        },
      },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [doc.id],
        details: {
          eventType: 'document.read',
          path: doc.path,
          section_requested: section,
          truncated,
        },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single H2 section from markdown content. Matches the H2
 * heading by text (case-insensitive, trimmed) and returns from the
 * heading through the next H2 (or EOF).
 */
function extractH2Section(content: string, section: string): string | null {
  const want = section.trim().toLowerCase();
  const lines = content.split('\n');

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim().toLowerCase();
      if (heading === want) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Rank candidate paths by fuzzy similarity to the target. Uses a cheap
 * distance metric — the best of (prefix-match score, normalized
 * Levenshtein) — so users typing near-misses get the right hits without
 * pulling in a new dependency.
 *
 * Returns up to `limit` paths, best match first, filtered to scores ≥
 * 0.35 so totally unrelated paths don't surface as "suggestions".
 */
export function findSimilarPaths(
  target: string,
  candidates: string[],
  limit: number,
): string[] {
  if (!target || candidates.length === 0) return [];

  const scored = candidates
    .map((c) => ({ path: c, score: similarity(target, c) }))
    .filter((s) => s.score >= 0.35)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.path);
}

function similarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;

  // Cheap signals: substring containment, shared prefix length, and a
  // normalized Levenshtein. Take the max so "brand" matches "brand/voice"
  // via substring while "branding" still matches "brand" via Levenshtein.
  let best = 0;

  if (bl.includes(al) || al.includes(bl)) {
    best = Math.max(best, 0.8);
  }

  const prefix = sharedPrefixLen(al, bl);
  best = Math.max(best, prefix / Math.max(al.length, bl.length));

  const lev = levenshtein(al, bl);
  const norm = 1 - lev / Math.max(al.length, bl.length, 1);
  best = Math.max(best, norm);

  return best;
}

function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Classic O(m*n) DP. Inputs here are bounded by `documents.path`
  // (varchar 512) so this stays fast even on a few-hundred-path brain.
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}
