import { describe, expect, it } from 'vitest';
import { formatEventLine, collapseEvents } from '../event-formatters';
import type { BrainPulseEventBase } from '../types';

const baseEvt = (over: Partial<BrainPulseEventBase>): BrainPulseEventBase => ({
  id: 'e', createdAt: new Date(), companyId: 'c', brainId: 'b',
  actorType: 'agent_token', actorId: 'a1', actorName: 'Marketing',
  targetType: 'document', targetId: 'd1', category: 'document_access',
  eventType: 'document.read', details: { path: '/ops/pricing-tiers' },
  ...over,
});

describe('formatEventLine', () => {
  it('formats a document read event', () => {
    const line = formatEventLine(baseEvt({}));
    expect(line.text).toContain('Marketing');
    expect(line.text).toContain('read');
    expect(line.docPath).toBe('/ops/pricing-tiers');
  });

  it('formats an MCP invocation', () => {
    const line = formatEventLine(baseEvt({
      category: 'mcp_invocation', eventType: 'invoke',
      details: { mcp_name: 'Stripe', tool_name: 'search_prices', origin_doc_path: '/ops/pricing-tiers' },
    }));
    expect(line.text).toContain('Marketing');
    expect(line.text).toContain('Stripe');
    expect(line.docPath).toBe('/ops/pricing-tiers');
  });

  it('formats a document creation', () => {
    const line = formatEventLine(baseEvt({
      category: 'document_mutation', eventType: 'create',
      details: { path: '/eng/webhook-spec' },
    }));
    expect(line.text).toContain('created');
    expect(line.docPath).toBe('/eng/webhook-spec');
  });

  it('returns docPath as null when path fails the slug regex', () => {
    const line = formatEventLine(baseEvt({ details: { path: 'https://evil.com/x' } }));
    expect(line.docPath).toBeNull();
  });
});

describe('collapseEvents', () => {
  it('collapses >5 events from same actor in same cluster in <2s', () => {
    const now = Date.now();
    const evts = Array.from({ length: 8 }, (_, i) => baseEvt({
      id: `e${i}`,
      createdAt: new Date(now + i * 100),
      targetId: `d${i}`,
      details: { path: `/product/doc-${i}`, cluster_slug: 'product' },
    }));
    const out = collapseEvents(evts);
    expect(out.filter((e) => e.type === 'aggregate')).toHaveLength(1);
    const agg = out.find((e) => e.type === 'aggregate')!;
    expect(agg.text).toContain('Marketing');
    expect(agg.text).toContain('8 docs');
  });

  it('does not collapse distinct actors', () => {
    const now = Date.now();
    const evts = [
      baseEvt({ id: '1', createdAt: new Date(now),        actorId: 'a', actorName: 'A', details: { cluster_slug: 'x', path: '/x/1' } }),
      baseEvt({ id: '2', createdAt: new Date(now + 50),   actorId: 'b', actorName: 'B', details: { cluster_slug: 'x', path: '/x/2' } }),
      baseEvt({ id: '3', createdAt: new Date(now + 100),  actorId: 'c', actorName: 'C', details: { cluster_slug: 'x', path: '/x/3' } }),
      baseEvt({ id: '4', createdAt: new Date(now + 150),  actorId: 'd', actorName: 'D', details: { cluster_slug: 'x', path: '/x/4' } }),
      baseEvt({ id: '5', createdAt: new Date(now + 200),  actorId: 'e', actorName: 'E', details: { cluster_slug: 'x', path: '/x/5' } }),
      baseEvt({ id: '6', createdAt: new Date(now + 250),  actorId: 'f', actorName: 'F', details: { cluster_slug: 'x', path: '/x/6' } }),
    ];
    const out = collapseEvents(evts);
    expect(out.filter((e) => e.type === 'aggregate')).toHaveLength(0);
  });
});
