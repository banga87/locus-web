import { z } from 'zod';

export const CatalogEntrySchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  iconUrl: z.string().startsWith('/'),
  mcpUrl: z.string().url(),
  authMode: z.enum(['oauth-dcr', 'bearer']),
  docsUrl: z.string().url().optional(),
});

export type ConnectorCatalogEntry = z.infer<typeof CatalogEntrySchema>;

export function validateCatalog(entries: unknown): ConnectorCatalogEntry[] {
  const parsed = z.array(CatalogEntrySchema).parse(entries);
  const seen = new Set<string>();
  for (const e of parsed) {
    if (seen.has(e.id)) {
      throw new Error(`duplicate catalog id: ${e.id}`);
    }
    seen.add(e.id);
  }
  return parsed;
}

const RAW_ENTRIES: ConnectorCatalogEntry[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects, and comments.',
    iconUrl: '/connectors/linear.svg',
    mcpUrl: 'https://mcp.linear.app/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write your Notion workspace.',
    iconUrl: '/connectors/notion.svg',
    mcpUrl: 'https://mcp.notion.com/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Errors, issues, and performance traces.',
    iconUrl: '/connectors/sentry.svg',
    mcpUrl: 'https://mcp.sentry.dev/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repos, issues, and pull requests.',
    iconUrl: '/connectors/github.svg',
    mcpUrl: 'https://api.githubcopilot.com/mcp/',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.github.com/en/copilot/using-github-copilot/coding-agent/mcp-server',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments, customers, and subscriptions.',
    iconUrl: '/connectors/stripe.svg',
    mcpUrl: 'https://mcp.stripe.com',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.stripe.com/mcp',
  },
];

// Validate at module load — typos or schema drift crash the dev server.
export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] =
  Object.freeze(validateCatalog(RAW_ENTRIES));

export function getCatalogEntry(id: string): ConnectorCatalogEntry | null {
  return CONNECTOR_CATALOG.find((e) => e.id === id) ?? null;
}
