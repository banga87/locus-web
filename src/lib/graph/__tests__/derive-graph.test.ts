import { describe, expect, it } from 'vitest';
import { deriveGraph } from '../derive-graph';

describe('deriveGraph', () => {
  it('maps a single document + folder into node + cluster with no edges', () => {
    const brain = { id: 'b1', slug: 'acme', name: 'Acme' };
    const docs = [{
      id: 'd1', title: 'Pricing Guide', slug: 'pricing-guide',
      path: '/pricing/pricing-guide', folderId: 'f1',
      isPinned: false, confidenceLevel: 'high' as const,
      tokenEstimate: 1200, metadata: { outbound_links: [] },
    }];
    const folders = [{ id: 'f1', slug: 'pricing', name: 'Pricing', parentId: null }];
    const mcps = [{ id: 'm1', name: 'Stripe', status: 'active' as const, serverUrl: 'https://stripe.com/mcp' }];

    const out = deriveGraph({ brain, docs, folders, mcps });

    expect(out.brain).toEqual(brain);
    expect(out.nodes).toEqual([{
      id: 'd1', title: 'Pricing Guide', slug: 'pricing-guide',
      path: '/pricing/pricing-guide', folder_id: 'f1',
      is_pinned: false, confidence_level: 'high', token_estimate: 1200,
    }]);
    expect(out.edges).toEqual([]);
    expect(out.clusters).toEqual([{
      folder_id: 'f1', slug: 'pricing', name: 'Pricing',
      parent_folder_id: null, depth: 0, doc_ids: ['d1'],
    }]);
    expect(out.mcpConnections).toEqual([{
      id: 'm1', name: 'Stripe', status: 'active', server_url_host: 'stripe.com',
    }]);
  });

  it('derives wikilink edges and dedupes by (source, target, type)', () => {
    const brain = { id: 'b1', slug: 'acme', name: 'Acme' };
    const docs = [
      { id: 'd1', title: 'A', slug: 'a', path: '/a', folderId: null, isPinned: false, confidenceLevel: null, tokenEstimate: null,
        metadata: { outbound_links: [
          { target_slug: 'b', source: 'wikilink' as const },
          { target_slug: 'b', source: 'wikilink' as const },
          { target_slug: 'b', source: 'markdown_link' as const },
          { target_slug: 'a', source: 'wikilink' as const },
          { target_slug: 'missing', source: 'wikilink' as const },
        ]} },
      { id: 'd2', title: 'B', slug: 'b', path: '/b', folderId: null, isPinned: false, confidenceLevel: null, tokenEstimate: null, metadata: { outbound_links: [] } },
    ];
    const out = deriveGraph({ brain, docs, folders: [], mcps: [] });
    expect(out.edges).toEqual([
      { source: 'd1', target: 'd2', type: 'wikilink' },
      { source: 'd1', target: 'd2', type: 'markdown_link' },
    ]);
  });

  it('computes folder depth correctly for nested folders', () => {
    const brain = { id: 'b1', slug: 'x', name: 'X' };
    const folders = [
      { id: 'f-root', slug: 'root', name: 'Root', parentId: null },
      { id: 'f-mid', slug: 'mid', name: 'Mid', parentId: 'f-root' },
      { id: 'f-leaf', slug: 'leaf', name: 'Leaf', parentId: 'f-mid' },
    ];
    const out = deriveGraph({ brain, docs: [], folders, mcps: [] });
    const byId = Object.fromEntries(out.clusters.map((c) => [c.folder_id, c.depth]));
    expect(byId).toEqual({ 'f-root': 0, 'f-mid': 1, 'f-leaf': 2 });
  });

  it('uses hostname for mcpConnections and falls back to full url on parse failure', () => {
    const brain = { id: 'b1', slug: 'x', name: 'X' };
    const mcps = [
      { id: 'm1', name: 'Stripe', status: 'active' as const, serverUrl: 'https://api.stripe.com/mcp/v1' },
      { id: 'm2', name: 'Garbage', status: 'error' as const, serverUrl: 'not a url' },
    ];
    const out = deriveGraph({ brain, docs: [], folders: [], mcps });
    expect(out.mcpConnections).toEqual([
      { id: 'm1', name: 'Stripe', status: 'active', server_url_host: 'api.stripe.com' },
      { id: 'm2', name: 'Garbage', status: 'error', server_url_host: 'not a url' },
    ]);
  });
});
