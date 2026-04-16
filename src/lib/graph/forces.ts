// Pure d3-force-compatible custom force: nudges nodes toward the centroid
// of their folder siblings each tick. Orphans (folder_id = null) get a
// weaker pull toward the canvas origin.
//
// Used by src/app/(app)/neurons/_components/neuron-canvas.tsx via
// ForceGraph2D's d3Force(name, force) API. d3-force-3d invokes
// `initialize(nodes)` once when the force is registered, then calls the
// force function with `alpha` each tick.
//
// d3-force-3d ships no TypeScript types, hence the local ClusterableNode
// interface below. Fields x, y, vx, vy are optional because d3 assigns
// them on simulation init (radial layout); they are guaranteed numeric
// by the time the tick function runs in production.

export interface ClusterableNode {
  id: string;
  folder_id: string | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface FolderClusterForceOptions {
  /** Per-tick multiplier on the velocity nudge toward a node's folder centroid. */
  strength?: number;
  /** Per-tick multiplier on the velocity nudge toward the origin for folder-less nodes. */
  orphanStrength?: number;
}

export interface FolderClusterForce {
  (alpha: number): void;
  initialize: (nodes: ClusterableNode[]) => void;
  strength: (value?: number) => number | FolderClusterForce;
  orphanStrength: (value?: number) => number | FolderClusterForce;
}

interface FolderAccumulator {
  sumX: number;
  sumY: number;
  count: number;
}

export function folderClusterForce(options: FolderClusterForceOptions = {}): FolderClusterForce {
  let strength = options.strength ?? 0.08;
  let orphanStrength = options.orphanStrength ?? 0.02;

  let nodes: ClusterableNode[] = [];
  const accumulators = new Map<string, FolderAccumulator>();

  const force = ((alpha: number) => {
    if (nodes.length === 0) return;

    // Reset accumulators (preserve map entries across ticks to avoid reallocation).
    for (const acc of accumulators.values()) {
      acc.sumX = 0;
      acc.sumY = 0;
      acc.count = 0;
    }

    // First pass: accumulate per-folder centroid components.
    for (const node of nodes) {
      if (node.folder_id === null) continue;
      let acc = accumulators.get(node.folder_id);
      if (!acc) {
        acc = { sumX: 0, sumY: 0, count: 0 };
        accumulators.set(node.folder_id, acc);
      }
      acc.sumX += node.x ?? 0;
      acc.sumY += node.y ?? 0;
      acc.count += 1;
    }

    // Second pass: nudge each node's velocity toward its target.
    for (const node of nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (node.folder_id === null) {
        // Orphan: pulled weakly toward origin.
        node.vx = (node.vx ?? 0) + (0 - x) * alpha * orphanStrength;
        node.vy = (node.vy ?? 0) + (0 - y) * alpha * orphanStrength;
        continue;
      }

      const acc = accumulators.get(node.folder_id);
      if (!acc || acc.count === 0) continue;
      const cx = acc.sumX / acc.count;
      const cy = acc.sumY / acc.count;
      node.vx = (node.vx ?? 0) + (cx - x) * alpha * strength;
      node.vy = (node.vy ?? 0) + (cy - y) * alpha * strength;
    }
  }) as FolderClusterForce;

  force.initialize = (newNodes: ClusterableNode[]) => {
    nodes = newNodes;
    accumulators.clear();
  };

  force.strength = (value?: number) => {
    if (value === undefined) return strength;
    strength = value;
    return force;
  };

  force.orphanStrength = (value?: number) => {
    if (value === undefined) return orphanStrength;
    orphanStrength = value;
    return force;
  };

  return force;
}
