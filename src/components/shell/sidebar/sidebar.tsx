'use client';

import type { ManifestFolder } from '@/lib/brain/manifest';
import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

import { SidebarExpanded } from './sidebar-expanded';
import { SidebarRail } from './sidebar-rail';

interface SidebarProps {
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
}

export function Sidebar(props: SidebarProps) {
  const { collapsed } = useSidebarLayout();
  return collapsed ? <SidebarRail /> : <SidebarExpanded {...props} />;
}
