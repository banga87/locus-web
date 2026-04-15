// Post-arrival category filter. Realtime can't IN(...) on enums in one
// subscription, so we filter client-side. The three excluded categories
// are low-volume so no network cost concern.

import type { VisibleCategory } from './types';

const VISIBLE_CATEGORIES: readonly VisibleCategory[] = [
  'document_access',
  'document_mutation',
  'mcp_invocation',
];

interface MaybeEvent { category: string }

export function filterEvent<T extends MaybeEvent>(evt: T): (T & { category: VisibleCategory }) | null {
  if ((VISIBLE_CATEGORIES as readonly string[]).includes(evt.category)) {
    return evt as T & { category: VisibleCategory };
  }
  return null;
}
