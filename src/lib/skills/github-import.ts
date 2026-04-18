import * as yaml from 'js-yaml';

export interface ParsedSkillUrl {
  owner: string;
  repo: string;
  skillName: string | null;
}

export interface SkillPreview {
  name: string;
  description: string;
  sha: string;
  skillMdBody: string;
  resources: Array<{ relative_path: string; content: string; bytes: number }>;
  totalBytes: number;
  warnings: string[];
}

export function parseSkillUrl(url: string, explicitSkillName?: string): ParsedSkillUrl {
  const u = new URL(url);
  if (u.hostname === 'skills.sh') {
    const m = u.pathname.match(/^\/([^/]+)\/skills\/([^/]+)\/?$/);
    if (!m) throw new Error(`unrecognised URL: ${url}`);
    return { owner: m[1], repo: 'skills', skillName: m[2] };
    // NOTE: skills.sh always points at the 'skills' repo by convention.
  }
  if (u.hostname === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!m) throw new Error(`unrecognised URL: ${url}`);
    return { owner: m[1], repo: m[2], skillName: explicitSkillName ?? null };
  }
  throw new Error(`unrecognised URL: ${url}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | string;
  sha: string;
}

function githubApiBase(parsed: ParsedSkillUrl): string {
  return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

async function githubFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: authHeaders() });

  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset') ?? 'unknown';
    throw new Error(`GitHub API rate limit exceeded, resets at ${reset}`);
  }

  if (res.status === 404) {
    throw new Error(`GitHub returned 404: ${url}`);
  }

  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status}: ${url}`);
  }

  return res;
}

async function fetchLatestSha(parsed: ParsedSkillUrl, rootPath: string): Promise<string> {
  const pathParam = rootPath ? `&path=${encodeURIComponent(rootPath)}` : '';
  const url = `${githubApiBase(parsed)}/commits?per_page=1${pathParam}`;
  const res = await githubFetch(url);
  const commits = (await res.json()) as Array<{ sha: string }>;
  if (!commits.length) {
    throw new Error(`No commits found for path: ${rootPath || '(root)'}`);
  }
  return commits[0].sha;
}

async function fetchRecursiveTree(parsed: ParsedSkillUrl, sha: string): Promise<TreeEntry[]> {
  const url = `${githubApiBase(parsed)}/git/trees/${sha}?recursive=1`;
  const res = await githubFetch(url);
  const data = (await res.json()) as { tree: TreeEntry[] };
  return data.tree;
}

interface SkillMdEntry {
  path: string;
  dir: string; // directory that acts as the skill root (without trailing slash)
}

function findSkillMd(tree: TreeEntry[], rootPath: string): SkillMdEntry | null {
  const blobs = tree.filter((e) => e.type === 'blob');

  // (a) Look for <rootPath>/SKILL.md if rootPath is non-empty
  if (rootPath) {
    const subfolderPath = `${rootPath}/SKILL.md`;
    if (blobs.some((e) => e.path === subfolderPath)) {
      return { path: subfolderPath, dir: rootPath };
    }
  }

  // (b) Fallback: SKILL.md at repo root
  if (blobs.some((e) => e.path === 'SKILL.md')) {
    return { path: 'SKILL.md', dir: '' };
  }

  return null;
}

interface FilterResult {
  mdFiles: TreeEntry[];
  warnings: string[];
}

function filterTree(tree: TreeEntry[], skillDir: string): FilterResult {
  const blobs = tree.filter((e) => e.type === 'blob');
  const prefix = skillDir ? `${skillDir}/` : '';

  // All blobs under the skill dir, excluding SKILL.md itself
  const underDir = blobs.filter((e) => {
    if (skillDir === '') {
      // Root dir: include everything
      return e.path !== 'SKILL.md';
    }
    return e.path.startsWith(prefix) && e.path !== `${skillDir}/SKILL.md`;
  });

  const mdFiles: TreeEntry[] = [];
  const warnings: string[] = [];

  for (const entry of underDir) {
    if (entry.path.endsWith('.md')) {
      mdFiles.push(entry);
    } else {
      warnings.push(`Skipped non-.md file: ${entry.path}`);
    }
  }

  return { mdFiles, warnings };
}

function rawUrl(parsed: ParsedSkillUrl, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${sha}/${path}`;
}

async function fetchBodies(
  parsed: ParsedSkillUrl,
  sha: string,
  entries: TreeEntry[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const CONCURRENCY = 10;

  // Simple chunked concurrency — no new deps needed
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (entry) => {
        const url = rawUrl(parsed, sha, entry.path);
        const res = await githubFetch(url);
        const text = await res.text();
        results.set(entry.path, text);
      }),
    );
  }

  return results;
}

interface FrontmatterResult {
  name: string;
  description: string;
  body: string;
}

function parseSkillMdFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    // No frontmatter — use the whole content as body, name/description empty
    return { name: '', description: '', body: content };
  }

  const parsed = yaml.load(match[1]) as Record<string, unknown> | null;
  const meta = parsed && typeof parsed === 'object' ? parsed : {};
  const name = typeof meta['name'] === 'string' ? meta['name'] : '';
  const description = typeof meta['description'] === 'string' ? meta['description'] : '';
  const body = match[2].trim();

  return { name, description, body };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FetchSkillPreviewOptions {
  pinSha?: string;
}

export async function fetchSkillPreview(
  parsed: ParsedSkillUrl,
  options?: FetchSkillPreviewOptions,
): Promise<SkillPreview> {
  const rootPath = parsed.skillName ? `skills/${parsed.skillName}` : '';

  // 1. Latest SHA for the folder (or repo if rootPath is '').
  //    Skip if pinSha is provided.
  const sha = options?.pinSha ?? (await fetchLatestSha(parsed, rootPath));

  // 2. Full tree for that SHA, single call.
  const tree = await fetchRecursiveTree(parsed, sha);

  // 3. Find SKILL.md:
  //    (a) <rootPath>/SKILL.md
  //    (b) SKILL.md at repo root
  const skillMdEntry = findSkillMd(tree, rootPath);
  if (!skillMdEntry) throw new Error('not a valid skill — no SKILL.md found');

  // 4. Filter to .md files under the skill root. Non-md → warnings.
  const { mdFiles, warnings } = filterTree(tree, skillMdEntry.dir);

  // 5. Fetch raw content in parallel (concurrency 10).
  const bodies = await fetchBodies(parsed, sha, [skillMdEntry as unknown as TreeEntry, ...mdFiles]);

  // 6. Parse SKILL.md frontmatter for name + description; validate.
  const { name, description, body } = parseSkillMdFrontmatter(
    bodies.get(skillMdEntry.path)!,
  );
  if (!description) {
    throw new Error(
      "the skill's description is empty. Agents won't know when to use it.",
    );
  }

  // 7. Assemble resources (everything except SKILL.md itself, path relative
  //    to skillMdEntry.dir).
  const dirPrefix = skillMdEntry.dir ? `${skillMdEntry.dir}/` : '';
  const resources = mdFiles.map((f) => {
    const content = bodies.get(f.path)!;
    return {
      relative_path: dirPrefix ? f.path.slice(dirPrefix.length) : f.path,
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  });

  const totalBytes =
    Buffer.byteLength(body, 'utf8') +
    resources.reduce((n, r) => n + r.bytes, 0);

  return { name, description, sha, skillMdBody: body, resources, totalBytes, warnings };
}
