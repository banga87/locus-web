'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import type { McpCallLine, GraphMcpConnection, Pulse } from '@/lib/brain-pulse/types';
import { resolveAgentColor } from '@/lib/brain-pulse/agent-palette';
import { folderClusterForce } from '@/lib/graph/forces';

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
    nodes: graph.nodes.map((n) => ({ id: n.id, name: n.title, path: n.path, folder_id: n.folder_id })),
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

  const [fgReady, setFgReady] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const hasCentredRef = useRef(false);
  const setFgRef = useCallback((instance: ForceGraphMethods | null) => {
    fgRef.current = instance;
    setFgReady(Boolean(instance));
  }, []);

  // Track wrap dimensions — ForceGraph2D defaults to window.innerWidth when
  // width/height props are unset, overflowing narrower parents.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  useEffect(() => {
    if (!fgReady) return;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-80);
    fg.d3Force('link')?.distance(40).strength(0.4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fg.d3Force('cluster', folderClusterForce({ strength: 0.08, orphanStrength: 0.02 }) as any);
    // No manual reheat: react-force-graph-2d reheats automatically when
    // graphData identity changes, which covers the live-update case.
  }, [fgReady]);

  const onEngineStop = useCallback(() => {
    if (hasCentredRef.current) return;
    fgRef.current?.zoomToFit(400, 60);
    hasCentredRef.current = true;
  }, []);

  // Per-frame line drawing via onRenderFramePost.
  // MCP lines: gradient stroke with shadowBlur glow; outbound solid, return dashed.
  const onRenderFramePost = useCallback((ctx: CanvasRenderingContext2D) => {
    const fg = fgRef.current;
    if (!fg) return;
    const now = Date.now();
    const wrap = wrapRef.current;
    const wrapBox = wrap ? wrap.getBoundingClientRect() : null;

    ctx.save();
    for (const line of mcpCallLines) {
      const mcpScreen = mcpScreenPositions.current.get(line.mcpConnectionId);
      if (!mcpScreen) continue;

      let originScreen: { x: number; y: number } | null = null;
      if (line.originNodeId) {
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

      ctx.shadowBlur = 10;
      ctx.shadowColor = color;

      if (isComplete) {
        const returnAge = now - line.completedAt!;
        const alpha = Math.max(0, 1 - returnAge / 600);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -(now - line.completedAt!) / 40;
        ctx.beginPath();
        ctx.moveTo(mcpScreen.x, mcpScreen.y);
        ctx.lineTo(originScreen.x, originScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const alpha = Math.max(0.4, 1 - age / 15_000);
        const grad = ctx.createLinearGradient(originScreen.x, originScreen.y, mcpScreen.x, mcpScreen.y);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(255,200,87,0.9)');
        ctx.strokeStyle = grad;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(originScreen.x, originScreen.y);
        ctx.lineTo(mcpScreen.x, mcpScreen.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }, [mcpCallLines]);

  return (
    <div className="neurons-canvas-wrap" ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={setFgRef as never}
        graphData={graphData}
        width={dims.w || undefined}
        height={dims.h || undefined}
        nodeRelSize={nodeRelSize}
        cooldownTicks={cooldownTicks}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.4}
        backgroundColor="transparent"
        linkColor={() => 'rgba(164, 201, 169, 0.07)'}
        onNodeClick={(node: NodeObject) => onNodeClick?.(String(node.id))}
        onEngineStop={onEngineStop}
        nodeCanvasObject={(node: NodeObject, ctx: CanvasRenderingContext2D) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;

          // Pass 1: radial halo
          const halo = ctx.createRadialGradient(x, y, 0, x, y, 11);
          halo.addColorStop(0, 'rgba(168, 163, 151, 0.42)');
          halo.addColorStop(1, 'rgba(168, 163, 151, 0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, 2 * Math.PI);
          ctx.fill();

          // Pass 2: warm-gray core
          ctx.fillStyle = '#a8a397';
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, 2 * Math.PI);
          ctx.fill();

          // Pass 3: pulse overlays — additive blend for glow
          const now = Date.now();
          const arr = pulsesByNode.get(String(node.id)) ?? [];
          if (arr.length === 0) return;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (const p of arr) {
            if (soloAgentId && p.agentId !== soloAgentId) continue;
            const age = now - p.createdAt;
            if (age > p.durationMs) continue;
            const isDelete = p.category === 'document_mutation' && p.eventType === 'delete';
            const isBirth = p.category === 'document_mutation' && p.eventType === 'create';
            const stroke = isDelete ? '#ff6b6b' : resolveAgentColor(p.agentId).canvas;

            if (isBirth) {
              // 3-ring expanding wave + brief core flash
              for (let k = 0; k < 3; k++) {
                const tk = (age - k * 300) / Math.max(1, p.durationMs - 600);
                if (tk < 0 || tk > 1) continue;
                ctx.globalAlpha = (1 - tk) * 0.85;
                ctx.strokeStyle = '#5ef0c8';
                ctx.lineWidth = 2.2 * (1 - tk);
                ctx.beginPath();
                ctx.arc(x, y, 4 + 28 * tk, 0, 2 * Math.PI);
                ctx.stroke();
              }
              const flashT = age / p.durationMs;
              if (flashT < 0.12) {
                ctx.globalAlpha = (1 - flashT / 0.12) * 0.9;
                ctx.fillStyle = '#5ef0c8';
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, 2 * Math.PI);
                ctx.fill();
              }
            } else {
              // Standard pulse: double wave (two rings offset 100ms)
              for (let k = 0; k < 2; k++) {
                const tk = (age - k * 100) / Math.max(1, p.durationMs - 200);
                if (tk < 0 || tk > 1) continue;
                ctx.globalAlpha = (1 - tk) * 0.9;
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 1.6 * (1 - tk);
                ctx.beginPath();
                ctx.arc(x, y, 3 + 14 * tk, 0, 2 * Math.PI);
                ctx.stroke();
              }
            }
          }
          ctx.restore();
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
