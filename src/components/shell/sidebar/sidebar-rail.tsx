'use client';

import Link from 'next/link';

import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';
import { Icon } from '@/components/tatara';

import { ThemeToggleRail } from '../theme-toggle';

const SECTIONS = [
  { id: 'brain', iconName: 'Brain', label: 'Brain' },
  { id: 'pinned', iconName: 'Pin', label: 'Pinned' },
] as const;

export function SidebarRail() {
  const { collapsed, sections, toggleCollapsed, expandSidebarWithSection } = useSidebarLayout();
  return (
    <aside className="side side-rail">
      <div className="rail-brand" title="Tatara">
        <span className="brand-dot" aria-hidden="true" />
      </div>
      <button
        type="button"
        className="rail-btn"
        onClick={toggleCollapsed}
        aria-label="Expand sidebar"
        aria-expanded={!collapsed}
      >
        <Icon name="PanelLeft" size={20} />
      </button>

      <div className="rail-quick">
        <button type="button" className="rail-btn" title="Search" aria-label="Search">
          <Icon name="Search" size={20} />
        </button>
        <Link href="/home" className="rail-btn" title="Home" aria-label="Home"><Icon name="Home" size={20} /></Link>
        <Link href="/recent" className="rail-btn" title="Recent" aria-label="Recent"><Icon name="Clock" size={20} /></Link>
        <Link href="/neurons" className="rail-btn" title="Neurons" aria-label="Neurons"><Icon name="Network" size={20} /></Link>
        <Link href="/skills" className="rail-btn" title="Skills" aria-label="Skills"><Icon name="BookOpen" size={20} /></Link>
      </div>

      <div className="rail-sections">
        {SECTIONS.map(({ id, iconName, label }) => {
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
              <Icon name={iconName} size={20} />
            </button>
          );
        })}
      </div>

      <div className="rail-bottom">
        <Link href="/chat" className="rail-btn" title="Chat" aria-label="Chat"><Icon name="MessageSquare" size={20} /></Link>
        <Link href="/connectors" className="rail-btn" title="Connectors" aria-label="Connectors"><Icon name="Plug" size={20} /></Link>
        <Link href="/settings" className="rail-btn" title="Settings" aria-label="Settings"><Icon name="Settings" size={20} /></Link>
        <ThemeToggleRail />
      </div>
    </aside>
  );
}
