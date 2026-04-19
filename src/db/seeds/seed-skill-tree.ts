/**
 * Pure I/O helper for loading skill-tree seed files from disk.
 *
 * Exported API:
 *   loadSeedSkill(pathFromSeedsDir: string): SeedSkillData
 *
 * Two shapes are supported:
 *   • A .md file   — treated as a SKILL.md with zero resources.
 *   • A directory  — reads <dir>/SKILL.md as the root; recursively collects
 *                    all *.md files under <dir>/references/ (or any nested
 *                    subdir) as resources, with `relative_path` relative to
 *                    the directory root.
 *
 * Frontmatter is parsed with js-yaml. Both `name` and `description` must be
 * present; missing either throws so callers surface the error at module load
 * time rather than silently seeding blank skills.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SeedSkillData {
  name: string;
  description: string;
  /** Raw markdown body with frontmatter stripped. */
  skillMdBody: string;
  resources: Array<{ relative_path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path for a seeds-relative input.
 * Works whether called from the Next.js runtime (cwd = repo root) or
 * directly via `tsx` (also cwd = repo root by convention, with
 * import.meta.url fallback).
 */
function resolveSeedsPath(relativeInput: string): string {
  const cwdCandidate = path.resolve(
    process.cwd(),
    'src',
    'db',
    'seeds',
    relativeInput,
  );
  try {
    // For directories we can just check existence; for files readFileSync.
    const s = statSync(cwdCandidate);
    if (s.isDirectory() || s.isFile()) return cwdCandidate;
  } catch {
    // Fall through to import.meta.url-based path.
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, relativeInput);
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

interface SkillFrontmatter {
  name: string;
  description: string;
}

/**
 * Split a seed Markdown file into frontmatter + body. Throws descriptively
 * on malformed files — these are repo assets that must be valid at deploy time.
 */
function parseSeedSkillFile(filePath: string): { fm: SkillFrontmatter; body: string } {
  const raw = readFileSync(filePath, 'utf8');

  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Skill seed ${filePath} has no frontmatter block.`);
  }

  const fmRaw = yaml.load(match[1]) as Record<string, unknown> | null;
  if (!fmRaw || typeof fmRaw !== 'object') {
    throw new Error(`Skill seed ${filePath} frontmatter did not parse.`);
  }

  const name = typeof fmRaw.name === 'string' ? fmRaw.name.trim() : '';
  const description =
    typeof fmRaw.description === 'string' ? fmRaw.description.trim() : '';

  if (!name) {
    throw new Error(`Skill seed ${filePath} frontmatter is missing 'name'.`);
  }
  if (!description) {
    throw new Error(
      `Skill seed ${filePath} frontmatter is missing 'description'.`,
    );
  }

  // `match[2]` is everything after the closing `---`. Trim leading newline.
  const body = match[2].replace(/^\n/, '');

  return { fm: { name, description }, body };
}

// ---------------------------------------------------------------------------
// Resource collection
// ---------------------------------------------------------------------------

/**
 * Recursively walk `dir` and collect every *.md file. Returns paths relative
 * to the given `rootDir` so callers can store `relative_path` cleanly.
 */
function collectMarkdownFiles(
  dir: string,
  rootDir: string,
): Array<{ relative_path: string; content: string }> {
  const results: Array<{ relative_path: string; content: string }> = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      results.push(...collectMarkdownFiles(full, rootDir));
    } else if (stat.isFile() && entry.endsWith('.md')) {
      const relative_path = path.relative(rootDir, full).replace(/\\/g, '/');
      const content = readFileSync(full, 'utf8');
      results.push({ relative_path, content });
    }
  }

  // Sort by relative_path for deterministic ordering in tests and DB inserts.
  results.sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a seed skill from either:
 *   • A single `.md` file path (relative to `src/db/seeds/`) — zero resources.
 *   • A directory path (relative to `src/db/seeds/`) — reads SKILL.md + all
 *     `*.md` files under any subdirectory as resources.
 *
 * Returns the `SeedSkillData` shape accepted by `writeSkillTree`.
 *
 * Throws on missing required frontmatter fields, missing SKILL.md in a
 * directory, or a path that resolves to neither a file nor a directory.
 */
export function loadSeedSkill(pathFromSeedsDir: string): SeedSkillData {
  const resolved = resolveSeedsPath(pathFromSeedsDir);

  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new Error(
      `Seed skill path does not exist: ${resolved} (input: ${pathFromSeedsDir})`,
    );
  }

  if (stat.isFile()) {
    // Single-file skill — the .md IS the SKILL.md; no resources.
    const { fm, body } = parseSeedSkillFile(resolved);
    return {
      name: fm.name,
      description: fm.description,
      skillMdBody: body,
      resources: [],
    };
  }

  if (stat.isDirectory()) {
    const skillMdPath = path.join(resolved, 'SKILL.md');
    const { fm, body } = parseSeedSkillFile(skillMdPath);

    // Collect all *.md files under any subdirectory (not SKILL.md itself,
    // which is at the root). We walk the whole directory and filter SKILL.md out.
    const allFiles = collectMarkdownFiles(resolved, resolved);
    const resources = allFiles.filter((f) => f.relative_path !== 'SKILL.md');

    return {
      name: fm.name,
      description: fm.description,
      skillMdBody: body,
      resources,
    };
  }

  throw new Error(
    `Seed skill path is neither a file nor a directory: ${resolved}`,
  );
}
