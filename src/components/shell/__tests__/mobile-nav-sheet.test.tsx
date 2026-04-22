// src/components/shell/__tests__/mobile-nav-sheet.test.tsx
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom does not implement window.matchMedia. Stub it so the component's
// viewport-resize effect can register without throwing.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

// We control what usePathname returns across renders via a ref-like mock.
let currentPath = '/home';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

// SidebarExpanded has heavy deps (db-driven sections). Stub it for this test.
vi.mock('@/components/shell/sidebar/sidebar-expanded', () => ({
  SidebarExpanded: () => <div data-testid="sidebar-expanded">sidebar</div>,
}));

import { MobileNavSheet } from '@/components/shell/mobile-nav-sheet';

const sidebarProps = {
  companyName: 'Test Co',
  user: { email: 'a@b.com', fullName: null, role: 'owner' },
  tree: [],
  pinned: [],
};

describe('<MobileNavSheet>', () => {
  it('closes when pathname changes', async () => {
    currentPath = '/home';
    const { rerender } = render(<MobileNavSheet {...sidebarProps} />);
    // Open the sheet
    fireEvent.click(screen.getByLabelText('Open navigation'));
    expect(screen.getByTestId('sidebar-expanded')).toBeInTheDocument();

    // Simulate a route change
    currentPath = '/recent';
    rerender(<MobileNavSheet {...sidebarProps} />);

    // Radix may animate content out — wait for it to detach from the DOM.
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-expanded')).not.toBeInTheDocument();
    });
  });
});
