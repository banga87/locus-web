// Pure formatters for narrative lines + collapse rule.

import type { BrainPulseEventBase } from './types';

// Matches documents.path conventions: leading slash, alphanumeric + _ - /
const DOC_PATH_RE = /^\/[A-Za-z0-9_\-/]+$/;

export interface NarrativeLine {
  id: string;
  type: 'event' | 'aggregate' | 'divider';
  text: string;
  docPath: string | null;
  createdAt: number;
  actorId: string | null;
  actorName?: string;
}

function extractDocPath(details: Record<string, unknown>): string | null {
  const candidate = (details.path ?? details.origin_doc_path ?? details.doc_path) as unknown;
  if (typeof candidate !== 'string') return null;
  return DOC_PATH_RE.test(candidate) ? candidate : null;
}

export function formatEventLine(evt: BrainPulseEventBase): NarrativeLine {
  const who = evt.actorName || 'Unknown';
  const path = extractDocPath(evt.details);
  let text: string;

  if (evt.category === 'mcp_invocation' && evt.eventType === 'invoke') {
    const mcp = (evt.details.mcp_name as string | undefined) ?? 'MCP';
    text = path ? `${who} called ${mcp} from ${path}` : `${who} called ${mcp}`;
  } else if (evt.category === 'mcp_invocation' && evt.eventType === 'complete') {
    const mcp = (evt.details.mcp_name as string | undefined) ?? 'MCP';
    text = `${who} finished ${mcp}`;
  } else if (evt.category === 'mcp_invocation' && evt.eventType === 'error') {
    const mcp = (evt.details.mcp_name as string | undefined) ?? 'MCP';
    text = `${who} — ${mcp} failed`;
  } else if (evt.category === 'document_mutation' && evt.eventType === 'create') {
    text = path ? `${who} created ${path}` : `${who} created a document`;
  } else if (evt.category === 'document_mutation' && evt.eventType === 'delete') {
    text = path ? `${who} deleted ${path}` : `${who} deleted a document`;
  } else if (evt.category === 'document_mutation') {
    text = path ? `${who} updated ${path}` : `${who} updated a document`;
  } else if (evt.category === 'document_access' && evt.eventType === 'document.read') {
    text = path ? `${who} read ${path}` : `${who} read a document`;
  } else {
    text = `${who} · ${evt.category}`;
  }

  return {
    id: evt.id, type: 'event', text, docPath: path,
    createdAt: evt.createdAt.getTime(), actorId: evt.actorId, actorName: who,
  };
}

const COLLAPSE_WINDOW_MS = 2000;
const COLLAPSE_MIN = 5;

export function collapseEvents(batch: BrainPulseEventBase[]): NarrativeLine[] {
  const byKey = new Map<string, BrainPulseEventBase[]>();
  for (const e of batch) {
    const cluster = (e.details.cluster_slug as string | undefined) ?? '';
    const key = `${e.actorId}|${cluster}`;
    const arr = byKey.get(key) ?? [];
    arr.push(e);
    byKey.set(key, arr);
  }

  const aggregated = new Set<string>();
  const aggregates: NarrativeLine[] = [];
  for (const [key, group] of byKey) {
    if (group.length <= COLLAPSE_MIN) continue;
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const span = group[group.length - 1].createdAt.getTime() - group[0].createdAt.getTime();
    if (span > COLLAPSE_WINDOW_MS) continue;
    for (const e of group) aggregated.add(e.id);
    const cluster = (group[0].details.cluster_slug as string | undefined) ?? 'unknown';
    aggregates.push({
      id: `agg-${key}-${group[0].id}`, type: 'aggregate',
      text: `${group[0].actorName} · touched ${group.length} docs in /${cluster}`,
      docPath: null, createdAt: group[0].createdAt.getTime(), actorId: group[0].actorId,
      actorName: group[0].actorName,
    });
  }

  const individuals = batch.filter((e) => !aggregated.has(e.id)).map(formatEventLine);
  return [...aggregates, ...individuals].sort((a, b) => b.createdAt - a.createdAt);
}
