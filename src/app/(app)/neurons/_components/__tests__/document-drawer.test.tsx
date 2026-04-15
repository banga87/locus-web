import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { DocumentDrawer } from '../document-drawer';

const mockDoc = {
  id: 'd1',
  title: 'Pricing Guide',
  path: '/ops/pricing-tiers',
  folderName: 'Ops',
  confidenceLevel: 'high' as const,
  updatedAt: new Date().toISOString(),
  tokenEstimate: 1200,
};

// Seed SWR cache with fallback data for the key DocumentDrawer will use.
// This bypasses the custom fetcher entirely so no network call is made.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig
    value={{
      provider: () => new Map(),
      dedupingInterval: 0,
      fallback: {
        '/api/brain/documents/d1': mockDoc,
      },
    }}
  >
    {children}
  </SWRConfig>
);

describe('DocumentDrawer', () => {
  it('renders the title after opening with a documentId', async () => {
    render(<DocumentDrawer open documentId="d1" onOpenChange={() => {}} />, {
      wrapper,
    });
    await waitFor(() =>
      expect(screen.getByText('Pricing Guide')).toBeInTheDocument(),
    );
  });
});
