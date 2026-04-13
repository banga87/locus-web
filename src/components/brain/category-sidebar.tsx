'use client';

// Left-rail category filter for /brain. Renders a list of category slugs;
// the active slug is derived from the `category` search param. "All" is a
// special pseudo-entry (no slug) that clears the filter.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

interface Category {
  id: string;
  slug: string;
  name: string;
  documentCount: number;
}

interface Props {
  categories: Category[];
  totalCount: number;
}

export function CategorySidebar({ categories, totalCount }: Props) {
  const params = useSearchParams();
  const active = params?.get('category') ?? '';

  return (
    <aside className="w-56 shrink-0">
      <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Categories
      </h2>
      <ul className="space-y-0.5">
        <li>
          <Link
            href="/brain"
            className={cn(
              'flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
              active === ''
                ? 'bg-accent font-medium text-accent-foreground'
                : 'hover:bg-muted/60',
            )}
          >
            <span>All</span>
            <span className="text-xs text-muted-foreground">{totalCount}</span>
          </Link>
        </li>
        {categories.map((cat) => (
          <li key={cat.id}>
            <Link
              href={`/brain?category=${encodeURIComponent(cat.slug)}`}
              className={cn(
                'flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                active === cat.slug
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'hover:bg-muted/60',
              )}
            >
              <span className="truncate">{cat.name}</span>
              <span className="text-xs text-muted-foreground">
                {cat.documentCount}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
