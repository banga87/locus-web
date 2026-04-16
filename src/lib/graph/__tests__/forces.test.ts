import { describe, expect, it } from 'vitest';
import { folderClusterForce, type ClusterableNode } from '../forces';

function makeNode(id: string, folder_id: string | null, x: number, y: number): ClusterableNode {
  return { id, folder_id, x, y, vx: 0, vy: 0 };
}

describe('folderClusterForce', () => {
  it('pulls same-folder nodes toward their shared centroid', () => {
    const nodes = [
      makeNode('a', 'f1', 10, 0),
      makeNode('b', 'f1', -10, 0),
    ];
    const force = folderClusterForce({ strength: 0.1, orphanStrength: 0.01 });
    force.initialize(nodes);
    force(1);
    // centroid is (0, 0); node at +10 gets negative vx, node at -10 gets positive
    expect(nodes[0].vx!).toBeLessThan(0);
    expect(nodes[1].vx!).toBeGreaterThan(0);
    // symmetry
    expect(nodes[0].vx).toBeCloseTo(-nodes[1].vx!, 10);
  });

  it('pulls orphans toward the origin at orphanStrength, not strength', () => {
    const nodes = [makeNode('a', null, 50, 0)];
    const force = folderClusterForce({ strength: 0.1, orphanStrength: 0.01 });
    force.initialize(nodes);
    force(1);
    // pulled toward (0, 0) → negative vx
    expect(nodes[0].vx!).toBeLessThan(0);
    // magnitude matches orphanStrength: (0 - 50) * 1 * 0.01 = -0.5
    expect(nodes[0].vx!).toBeCloseTo(-0.5, 10);
  });

  it('scales velocity delta linearly with alpha', () => {
    const nodesA = [makeNode('a', null, 50, 0)];
    const nodesB = [makeNode('a', null, 50, 0)];
    const forceA = folderClusterForce({ strength: 0.1, orphanStrength: 0.01 });
    const forceB = folderClusterForce({ strength: 0.1, orphanStrength: 0.01 });
    forceA.initialize(nodesA);
    forceB.initialize(nodesB);
    forceA(1.0);
    forceB(0.1);
    // alpha=0.1 should produce a delta ~10× smaller than alpha=1
    expect(nodesB[0].vx!).toBeCloseTo(nodesA[0].vx! * 0.1, 10);
  });

  it('does not cross-pollinate centroids between folders', () => {
    const nodes = [
      // folder f1 centroid: (0, 100)
      makeNode('a1', 'f1', 10, 100),
      makeNode('a2', 'f1', -10, 100),
      // folder f2 centroid: (0, -100)
      makeNode('b1', 'f2', 10, -100),
      makeNode('b2', 'f2', -10, -100),
    ];
    const force = folderClusterForce({ strength: 0.1, orphanStrength: 0.01 });
    force.initialize(nodes);
    force(1);
    // f1 nodes should have ~zero vy (already at their centroid y); f2 likewise
    expect(nodes[0].vy!).toBeCloseTo(0, 10);
    expect(nodes[2].vy!).toBeCloseTo(0, 10);
    // but f1 and f2 nodes should NOT be pulled toward each other's y
    expect(nodes[0].vy!).not.toBeLessThan(-0.01);
    expect(nodes[2].vy!).not.toBeGreaterThan(0.01);
  });

  it('is a no-op with empty input', () => {
    const force = folderClusterForce();
    force.initialize([]);
    expect(() => force(1)).not.toThrow();
  });

  it('is a no-op when initialize was never called', () => {
    const force = folderClusterForce();
    // no initialize
    expect(() => force(1)).not.toThrow();
  });
});
