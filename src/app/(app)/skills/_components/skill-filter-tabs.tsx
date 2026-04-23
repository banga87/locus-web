// SkillFilterTabs — topbar-adjacent filter control for the /skills index.
//
// Server-renderable: uses plain <Link>s so the active filter is encoded in
// the URL (`?filter=...`), the result stays bookmarkable, and the server
// renders the correct subset on first paint (no hydration flicker).
//
// Filters:
//   all         — every skill (default)
//   triggerable — skills with a `trigger:` block in metadata
//   ondemand    — skills without a `trigger:` block

import Link from 'next/link';

import { cn } from '@/lib/utils';

type FilterValue = 'all' | 'triggerable' | 'ondemand';

interface SkillFilterTabsProps {
  active: FilterValue;
  counts: Record<FilterValue, number>;
}

interface TabDef {
  value: FilterValue;
  label: string;
}

const TABS: TabDef[] = [
  { value: 'all', label: 'All' },
  { value: 'triggerable', label: 'Triggerable' },
  { value: 'ondemand', label: 'On-demand' },
];

function hrefFor(value: FilterValue): string {
  // Omit the query string entirely for "all" so bookmarked URLs are clean.
  if (value === 'all') return '/skills';
  return `/skills?filter=${value}`;
}

export function SkillFilterTabs({ active, counts }: SkillFilterTabsProps) {
  return (
    <div
      className="mb-6 flex items-center gap-1 border-b border-border"
      role="tablist"
      aria-label="Filter skills"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab.value)}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-ink text-ink'
                : 'border-transparent text-muted-foreground hover:text-ink',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-xs font-normal',
                isActive
                  ? 'bg-secondary text-muted-foreground'
                  : 'bg-secondary text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {counts[tab.value]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
