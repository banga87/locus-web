'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useEffect, useCallback } from 'react';
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import type { McpCallLine, GraphMcpConnection, Pulse } from '@/lib/brain-pulse/types';
import { resolveAgentColor } from '@/lib/brain-pulse/agent-palette';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface Props {
  graph: GraphResponse;
  pulses: Pulse[];
  mcpCallLines: McpCallLine[];
  mcpConnections: GraphMcpConnection[];
  soloAgentId?: string | null;
  onNodeClick?: (nodeId: string) => void;
}

// Position a hex on the perimeter (45% radius from center, 12 o'clock start).
function mcpOverlayStyle(index: number, total: number): React.CSSProperties {
  const angle = (index / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2;
  const top = `${50 + 45 * Math.sin(angle)}%`;
  const left = `${50 + 45 * Math.cos(angle)}%`;
  return {
    position: 'absolute', top, left,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  };
}

export function NeuronCanvas({ graph, pulses, mcpCallLines, mcpConnections, soloAgentId = null, onNodeClick }: Props) {
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

  const fgRef = useRef<ForceGraphMethods | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mcpScreenPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Re-measure hex screen positions on resize + mount.
  useEffect(() => {
    const measure = () => {
      if (!wrapRef.current) return;
      const wrapBox = wrapRef.current.getBoundingClientRect();
      const positions = new Map<string, { x: number; y: number }>();
      for (const hex of wrapRef.current.querySelectorAll<HTMLElement>('[data-mcp-id]')) {
        const r = hex.getBoundingClientRect();
        positions.set(hex.dataset.mcpId!, {
          x: r.left - wrapBox.left + r.width / 2,
          y: r.top - wrapBox.top + r.height / 2,
        });
      }
      mcpScreenPositions.current = positions;
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [mcpConnections.length]);

  // Per-frame line drawing via onRenderFramePost.
  const onRenderFramePost = useCallback((ctx: CanvasRenderingContext2D) => {
    const fg = fgRef.current;
    if (!fg) return;
    const now = Date.now();
    const wrap = wrapRef.current;
    const wrapBox = wrap ? wrap.getBoundingClientRect() : null;

    for (const line of mcpCallLines) {
      const mcpScreen = mcpScreenPositions.current.get(line.mcpConnectionId);
      if (!mcpScreen) continue;

      let originScreen: { x: number; y: number } | null = null;
      if (line.originNodeId) {
        // graph2ScreenCoords needs world coords — look up current node position.
        const graphData = (fg as unknown as { graphData: () => { nodes: Array<{ id: string; x: number; y: number }> } }).graphData();
        const node = graphData.nodes.find((n) => n.id === line.originNodeId);
        originScreen = node ? fg.graph2ScreenCoords(node.x, node.y) : null;
      }
      if (!originScreen && wrapBox) {
        originScreen = { x: wrapBox.width / 2, y: wrapBox.height / 2 };
      }
      if (!originScreen) continue;

      const color = resolveAgentColor(line.agentId).canvas;
      const age = now - line.startedAt;
      const isComplete = line.completedAt !== null;

      if (isComplete) {
        const returnAge = now - line.completedAt!;
        const alpha = Math.max(0, 1 - returnAge / 600);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(mcpScreen.x, mcpScreen.y);
        ctx.lineTo(originScreen.x, originScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const alpha = Math.max(0.3, 1 - age / 15_000);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(originScreen.x, originScreen.y);
        ctx.lineTo(mcpScreen.x, mcpScreen.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }, [mcpCallLines]);

  return (
    <div className="neurons-canvas-wrap" ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={fgRef as never}
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
        onRenderFramePost={onRenderFramePost}
      />
      {mcpConnections.map((m, i) => (
        <div
          key={m.id}
          data-mcp-id={m.id}
          className="neurons-mcp-hex"
          data-status={m.status}
          style={mcpOverlayStyle(i, mcpConnections.length)}
        >
          <span className="neurons-mcp-hex__label">{m.name}</span>
        </div>
      ))}
    </div>
  );
}
