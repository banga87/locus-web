'use client';

// Primary side navigation for the authenticated app. Three items: Home,
// Brain, Settings. Active item derived from the current pathname.
// `collapsed` flips from "text + icon" to icon-only for narrow viewports
// (handled by the parent AppShell).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, BookOpenIcon, SettingsIcon, PlugIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const items = [
  { href: '/', label: 'Home', icon: HomeIcon, match: (p: string) => p === '/' },
  {
    href: '/brain',
    label: 'Brain',
    icon: BookOpenIcon,
    match: (p: string) => p === '/brain' || p.startsWith('/brain/'),
  },
  {
    href: '/settings/agent-tokens',
    label: 'Settings',
    icon: SettingsIcon,
    // Match the settings root and the agent-tokens subpage, but not
    // MCP connections — those get their own nav item below.
    match: (p: string) =>
      p === '/settings' ||
      p === '/settings/agent-tokens' ||
      p.startsWith('/settings/agent-tokens/'),
  },
  {
    href: '/settings/mcp-connections',
    label: 'MCP connections',
    icon: PlugIcon,
    match: (p: string) => p.startsWith('/settings/mcp-connections'),
  },
] as const;

interface SidebarProps {
  companyName: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ companyName, collapsed = false, onNavigate }: SidebarProps) {
  const pathname = usePathname() ?? '/';

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="text-base font-semibold tracking-tight">
          {collapsed ? 'L' : 'Locus'}
        </span>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {items.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'hover:bg-sidebar-accent/60 text-sidebar-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Company
          </div>
          <div className="truncate text-sm font-medium">{companyName}</div>
        </div>
      )}
    </aside>
  );
}
