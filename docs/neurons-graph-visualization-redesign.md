# Neurons Graph Visualization — Architecture Redesign

**Date:** 2026-04-22
**Branch:** `claude/neurons-graph-visualization-47cfx`
**Status:** Proposal / RFC

---

## Problem Statement

The current Neurons page has two compounding performance problems that become critical as a company's document corpus grows past ~500 documents:

1. **Full graph sent to the client on every load.** The API serialises every node and every edge into a single JSON payload. The D3 force simulation then runs all of that on one browser thread. The code already contains a `>1000 docs → performance degraded` warning, acknowledging this is a known ceiling.

2. **JSONB link storage blocks efficient server-side graph queries.** Links are stored in `metadata.outbound_links` (a JSONB array on the `documents` table). To answer "what are the neighbours of node X?" the server must scan every document's metadata column — O(n) on every request with no meaningful index support.

Visually, the current 2D canvas rendering (via `react-force-graph-2d`) lacks the depth and density legibility that makes large graphs navigable. Users familiar with tools like Obsidian expect a richer, more spatial representation.

---

## Current Architecture

### Data flow

```
neurons/page.tsx (server)
  ├── Fetch all documents  (id, title, slug, path, folder_id, metadata)
  ├── Fetch all folders    (hierarchy)
  ├── Fetch MCP connections
  └── deriveGraph(rows) → GraphResponse
      └── nodes from docs, edges from metadata.outbound_links, clusters from folders

neurons-client.tsx (client)
  ├── useBrainPulse → SWR + Supabase Realtime (audit_events)
  └── NeuronCanvas → react-force-graph-2d (canvas, D3-force)
```

### Link storage

Links are extracted from document markdown (wikilinks `[[slug]]` and standard markdown `[text](path)`) and stored as:

```json
// documents.metadata.outbound_links
[
  { "target_slug": "some-other-doc", "source": "wikilink", "raw": "[[some-other-doc]]" }
]
```

There is no dedicated edge table. Inbound links are not tracked. Link validation (checking the target exists) is done at graph-derivation time by matching slugs.

### Visualization stack

| Library | Role |
|---|---|
| `react-force-graph-2d` v1.29.1 | Force-directed 2D canvas graph |
| D3-force (bundled) | Physics simulation |
| Custom `folderClusterForce` | Keeps documents near their folder centroid |

Adaptive physics is already in place (node sizes and cooldown ticks adjust at 500 and 1000 nodes), but this is a tuning measure, not a structural fix.

---

## Proposed Architecture

### 1. Dedicated `document_links` table (backend)

Add a first-class edge table in Postgres. This is **the foundational change** — everything else builds on top of it.

```sql
CREATE TABLE document_links (
  source_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('wikilink', 'markdown_link')),
  brain_id   uuid NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, target_id, type)
);

CREATE INDEX idx_document_links_source ON document_links(source_id);
CREATE INDEX idx_document_links_target ON document_links(target_id);
CREATE INDEX idx_document_links_brain  ON document_links(brain_id);
```

**Population:** The link-extraction logic already runs on every document create/update (`src/lib/brain-pulse/markdown-links.ts`). The change is to write extracted links into this table (in addition to or replacing the JSONB metadata approach).

**What this unlocks:**
- Indexed neighbour lookups (single join, not a full table scan)
- Bidirectional link queries (inbound + outbound) at no extra cost
- Degree/centrality aggregation in SQL
- Cascade deletes when a document is removed

The `metadata.outbound_links` JSONB can be kept for now as a cache/fallback and deprecated once the edge table is proven.

---

### 2. Ego-graph API (windowed subgraph delivery)

Instead of sending all N nodes to the client, introduce a **windowed subgraph** endpoint:

```
GET /api/brain/[slug]/graph
  → Returns the top ~150 nodes by degree (the dense core) as the initial view

GET /api/brain/[slug]/graph?center=[nodeId]&depth=2
  → Returns the 1- or 2-hop neighbourhood of a given node
```

The client requests the core on load, then lazily expands neighbourhoods as the user clicks or searches. The user never downloads 5,000 nodes — they navigate a viewport into the graph.

This is how Obsidian handles large vaults efficiently, and it's compatible with the existing SWR + Supabase Realtime architecture (real-time pulses continue to work within the visible subgraph).

**Degree query (example):**

```sql
-- Top N nodes by total degree, for the initial overview
SELECT
  d.id,
  d.title,
  d.slug,
  COUNT(l.source_id) + COUNT(l2.target_id) AS degree
FROM documents d
LEFT JOIN document_links l  ON l.source_id = d.id AND l.brain_id = $brainId
LEFT JOIN document_links l2 ON l2.target_id = d.id AND l2.brain_id = $brainId
WHERE d.brain_id = $brainId
  AND d.deleted_at IS NULL
GROUP BY d.id
ORDER BY degree DESC
LIMIT 150;
```

---

### 3. 3D visualization — `react-force-graph-3d`

`react-force-graph-3d` is a **near drop-in upgrade** from `react-force-graph-2d`. It is the same library family (by the same author), exposes the same prop API, and uses Three.js/WebGL for rendering — comfortably handling 10,000+ nodes.

**Migration impact on `neuron-canvas.tsx`:**

| Change | Effort |
|---|---|
| Import swap (`react-force-graph-2d` → `react-force-graph-3d`) | Trivial |
| Custom canvas draw callbacks (`nodeCanvasObject`) → Three.js equivalents (`nodeThreeObject`) | Moderate |
| Folder cluster force (pure D3, not canvas-specific) | No change |
| Pulse/highlight rendering | Moderate — move from canvas paint to mesh material updates |
| MCP gradient lines | Moderate — Three.js `Line` / `LineSegments` |
| Bundle size impact | ~200 KB added (Three.js) — manageable since canvas is already dynamic-imported with SSR disabled |

The visual result is the Obsidian-style orbital graph the user described: depth cues, rotation, zoom, with nodes floating in 3D space and edges as lines between them.

**Fallback:** If 3D proves too heavy for a particular device, the same family's `react-force-graph` (2D WebGL via Pixi.js) is a faster alternative to the current canvas renderer with minimal API difference.

---

### 4. Folder-cluster colouring and node sizing

In 3D, the existing folder-cluster logic can be enhanced:

- **Cluster colour:** Assign each folder a hue; nodes within it share that hue (already partially done in 2D).
- **Node radius:** Scale by `log(tokenEstimate)` so dense documents are visually larger.
- **Edge opacity:** Scale by link type — wikilinks (intentional) slightly more opaque than markdown links (incidental).
- **Confidence shell:** Core documents (isCore=true) rendered as slightly larger, brighter nodes.

---

## Implementation Sequence

The changes are intentionally staged so each phase is independently deployable and the existing page continues to function throughout.

### Phase 1 — Edge table (backend only, no UX change)
1. Write and run migration for `document_links` table + indexes.
2. Backfill from existing `metadata.outbound_links` for all current documents.
3. Update `POST /api/brain/documents` and `PATCH /api/brain/documents/[id]` to write to the table on link extraction (keep JSONB write for now).
4. Update `deriveGraph` to read edges from `document_links` instead of scanning JSONB.
5. Add test coverage for link upsert and cascade delete.

### Phase 2 — Ego-graph API
1. Add `?center&depth` query params to `GET /api/brain/[slug]/graph`.
2. Implement degree-ranked overview (top 150 nodes) as the default response.
3. Update `useBrainPulse` to accept the windowed graph and handle expand-on-click.
4. Realtime pulses continue as-is; nodes outside the window queue and appear when the window expands.

### Phase 3 — 3D visualization
1. Swap `react-force-graph-2d` for `react-force-graph-3d` in `neuron-canvas.tsx`.
2. Port custom draw callbacks to Three.js equivalents.
3. Update pulse/MCP line rendering to Three.js materials.
4. Add orbit controls, reset-camera button, and depth-of-field toggle.

### Phase 4 — Polish
1. Node sizing by token estimate.
2. Edge opacity by link type.
3. Search-to-zoom (fly camera to a searched node).
4. Performance profiling and tuning at 1000+ nodes.

---

## What Is Not Proposed

- **A graph database (Neo4j, etc.):** Unnecessary operational complexity. Postgres with a proper edge table and indexes handles this scale comfortably.
- **Full rewrite of the realtime layer:** Supabase Realtime + SWR continues to work as-is.
- **Removing JSONB links immediately:** Kept as a fallback through Phase 1 and deprecated in Phase 2.

---

## Open Questions

1. **Ego-graph UX:** What triggers neighbourhood expansion — click, hover, or a "focus" button? Should the unexpanded rest of the graph be shown as dim/ghost nodes?
2. **Edge directionality:** Should edges be rendered as directed (arrows) or undirected? Wikilinks feel bidirectional in intent even if currently tracked as outbound.
3. **3D performance floor:** What is the minimum device spec we target? This affects whether we need a 2D WebGL fallback.
4. **Backfill timing:** The `document_links` backfill on a large corpus needs to run as a background job, not a blocking migration step.
