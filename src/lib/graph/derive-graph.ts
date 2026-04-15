// Pure transformer: rows → graph response.
//
// Consumers (graph route + tests) pass already-loaded rows. This file
// does NOT query the DB — keeps us pure + test-friendly.

export interface DeriveGraphInput {
  brain: { id: string; slug: string; name: string };
  docs: Array<{
    id: string;
    title: string;
    slug: string;
    path: string;
    folderId: string | null;
    isPinned: boolean;
    confidenceLevel: 'verified' | 'inferred' | 'uncertain' | null;
    tokenEstimate: number | null;
    metadata: { outbound_links?: Array<{ target_slug: string; source: 'wikilink' | 'markdown_link' }> } | null;
  }>;
  folders: Array<{ id: string; slug: string; name: string; parentId: string | null }>;
  mcps: Array<{ id: string; name: string; status: 'active' | 'disabled' | 'error'; serverUrl: string }>;
}

export interface GraphNode {
  id: string; title: string; slug: string; path: string;
  folder_id: string | null; is_pinned: boolean;
  confidence_level: 'verified' | 'inferred' | 'uncertain' | null;
  token_estimate: number | null;
}

export interface GraphEdge {
  source: string; target: string; type: 'wikilink' | 'markdown_link';
}

export interface GraphCluster {
  folder_id: string; slug: string; name: string;
  parent_folder_id: string | null; depth: number; doc_ids: string[];
}

export interface GraphMcpConnection {
  id: string; name: string; status: 'active' | 'disabled' | 'error';
  server_url_host: string;
}

export interface GraphResponse {
  brain: { id: string; slug: string; name: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  mcpConnections: GraphMcpConnection[];
}

export function deriveGraph(input: DeriveGraphInput): GraphResponse {
  const slugToId = new Map<string, string>();
  for (const d of input.docs) slugToId.set(d.slug, d.id);

  const nodes: GraphNode[] = input.docs.map((d) => ({
    id: d.id, title: d.title, slug: d.slug, path: d.path,
    folder_id: d.folderId, is_pinned: d.isPinned,
    confidence_level: d.confidenceLevel, token_estimate: d.tokenEstimate,
  }));

  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const d of input.docs) {
    const links = d.metadata?.outbound_links ?? [];
    for (const link of links) {
      const targetId = slugToId.get(link.target_slug);
      if (!targetId) continue;
      if (targetId === d.id) continue;
      const key = `${d.id}|${targetId}|${link.source}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ source: d.id, target: targetId, type: link.source });
    }
  }

  const docsByFolder = new Map<string, string[]>();
  for (const d of input.docs) {
    if (!d.folderId) continue;
    const arr = docsByFolder.get(d.folderId) ?? [];
    arr.push(d.id);
    docsByFolder.set(d.folderId, arr);
  }

  const depthCache = new Map<string, number>();
  const foldersById = new Map(input.folders.map((f) => [f.id, f]));
  function depth(folderId: string): number {
    const cached = depthCache.get(folderId);
    if (cached !== undefined) return cached;
    const f = foldersById.get(folderId);
    const d = f?.parentId ? depth(f.parentId) + 1 : 0;
    depthCache.set(folderId, d);
    return d;
  }

  const clusters: GraphCluster[] = input.folders.map((f) => ({
    folder_id: f.id, slug: f.slug, name: f.name,
    parent_folder_id: f.parentId, depth: depth(f.id),
    doc_ids: docsByFolder.get(f.id) ?? [],
  }));

  const mcpConnections: GraphMcpConnection[] = input.mcps.map((m) => ({
    id: m.id, name: m.name, status: m.status,
    server_url_host: safeHost(m.serverUrl),
  }));

  return { brain: input.brain, nodes, edges, clusters, mcpConnections };
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
