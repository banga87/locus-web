'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { NodeObject } from 'react-force-graph-2d';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import type { Pulse } from '@/lib/brain-pulse/types';
import { resolveAgentColor } from '@/lib/brain-pulse/agent-palette';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface Props {
  graph: GraphResponse;
  pulses: Pulse[];
  soloAgentId?: string | null;
  onNodeClick?: (nodeId: string) => void;
}

export function NeuronCanvas({ graph, pulses, soloAgentId = null, onNodeClick }: Props) {
  const graphData = useMemo(() => ({
    nodes: graph.nodes.map((n) => ({ id: n.id, name: n.title, path: n.path })),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, type: e.type })),
  }), [graph]);

  // Adaptive physics per spec §10:
  //   <=500 docs -> defaults (nodeRelSize=4, cooldownTicks=100)
  //    501-1000  -> nodeRelSize=3, cooldownTicks=300
  //    >5000     -> banner in neurons-client (T19); canvas still renders
  const docCount = graph.nodes.length;
  const isLarge = docCount > 500;
  const nodeRelSize = isLarge ? 3 : 4;
  const cooldownTicks = isLarge ? 300 : 100;

  const pulsesByNode = useMemo(() => {
    const map = new Map<string, Pulse[]>();
    for (const p of pulses) {
      const arr = map.get(p.nodeId) ?? [];
      arr.push(p);
      map.set(p.nodeId, arr);
    }
    return map;
  }, [pulses]);

  return (
    <div className="neurons-canvas-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeRelSize={nodeRelSize}
        cooldownTicks={cooldownTicks}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.4}
        backgroundColor="var(--paper-2, #0d0f13)"
        linkColor={() => 'rgba(255,255,255,0.08)'}
        onNodeClick={(node: NodeObject) => onNodeClick?.(String(node.id))}
        nodeCanvasObject={(node: NodeObject, ctx: CanvasRenderingContext2D) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const baseR = 4;

          // Base node dot
          ctx.fillStyle = '#3a3f4a';
          ctx.beginPath();
          ctx.arc(x, y, baseR, 0, 2 * Math.PI);
          ctx.fill();

          // Pulse overlays
          const now = Date.now();
          const arr = pulsesByNode.get(String(node.id)) ?? [];
          for (const p of arr) {
            if (soloAgentId && p.agentId !== soloAgentId) continue;
            const age = now - p.createdAt;
            if (age > p.durationMs) continue;
            const t = age / p.durationMs; // 0..1
            const isDelete = p.category === 'document_mutation' && p.eventType === 'delete';
            const stroke = isDelete ? '#e57373' : resolveAgentColor(p.agentId).canvas;
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = Math.max(1, 2 * (1 - t));
            ctx.beginPath();
            ctx.arc(x, y, baseR + 10 * t, 0, 2 * Math.PI);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }}
        nodeCanvasObjectMode={() => 'replace'}
      />
    </div>
  );
}
