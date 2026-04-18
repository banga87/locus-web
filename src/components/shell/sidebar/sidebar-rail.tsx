'use client';

import Link from 'next/link';
import { Brain, Pin, Search, Home, Clock, Network, MessageSquare, Plug, Settings, PanelLeft } from 'lucide-react';

import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

import { ThemeToggleRail } from '../theme-toggle';

const SECTIONS = [
  { id: 'brain', icon: Brain, label: 'Brain' },
  { id: 'pinned', icon: Pin, label: 'Pinned' },
] as const;

export function SidebarRail() {
  const { collapsed, sections, toggleCollapsed, expandSidebarWithSection } = useSidebarLayout();
  return (
    <aside className="side side-rail">
      <div className="rail-brand" title="Locus">
        <span className="brand-dot" aria-hidden="true" />
      </div>
      <button
        type="button"
        className="rail-btn"
        onClick={toggleCollapsed}
        aria-label="Expand sidebar"
        aria-expanded={!collapsed}
      >
        <PanelLeft size={18} />
      </button>

      <div className="rail-quick">
        <button type="button" className="rail-btn" title="Search" aria-label="Search">
          <Search size={18} />
        </button>
        <Link href="/home" className="rail-btn" title="Home" aria-label="Home"><Home size={18} /></Link>
        <Link href="/recent" className="rail-btn" title="Recent" aria-label="Recent"><Clock size={18} /></Link>
        <Link href="/neurons" className="rail-btn" title="Neurons" aria-label="Neurons"><Network size={18} /></Link>
      </div>

      <div className="rail-sections">
        {SECTIONS.map(({ id, icon: Icon, label }) => {
          const active = sections[id] === true;
          return (
            <button
              key={id}
              type="button"
              className="rail-btn"
              title={label}
              aria-label={label}
              aria-current={active || undefined}
              onClick={() => expandSidebarWithSection(id)}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      <div className="rail-bottom">
        <Link href="/chat" className="rail-btn" title="Chat" aria-label="Chat"><MessageSquare size={18} /></Link>
        <Link href="/connectors" className="rail-btn" title="Connectors" aria-label="Connectors"><Plug size={18} /></Link>
        <Link href="/settings" className="rail-btn" title="Settings" aria-label="Settings"><Settings size={18} /></Link>
        <ThemeToggleRail />
      </div>
    </aside>
  );
}
