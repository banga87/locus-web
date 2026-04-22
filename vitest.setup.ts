import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { config } from 'dotenv';

// Load base .env first (DATABASE_URL, SUPABASE_URL, etc.).
// Then overlay .env.test if present so tests can override individual values.
config({ path: '.env' });
config({ path: '.env.test', override: true });

// jsdom doesn't implement several DOM APIs that Radix UI primitives
// (Select, DropdownMenu, Popover, etc.) call when their listboxes or
// popovers open. Polyfill them to no-ops at the suite level so any test
// that renders a Radix overlay in jsdom can interact with it.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
  // Radix Select's pointer handlers read hasPointerCapture/releasePointerCapture.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
}
