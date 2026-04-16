'use client';

import Link from 'next/link';
import { Pin } from 'lucide-react';

import { Section } from '@/components/shell/sidebar/section';
import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

interface PinnedSectionProps {
  pinned: Array<{ id: string; title: string; path: string }>;
}

export function PinnedSection({ pinned }: PinnedSectionProps) {
  const { sections, toggleSection } = useSidebarLayout();
  if (pinned.length === 0) return null;
  return (
    <Section
      id="pinned"
      icon={Pin}
      label="Pinned"
      count={pinned.length}
      expanded={sections.pinned ?? true}
      onToggle={() => toggleSection('pinned')}
    >
      {pinned.map((p) => (
        <Link key={p.id} href={`/brain/${p.id}`} className="node doc leaf">
          <span className="chev">›</span>
          <span className="node-bullet" style={{ color: 'var(--accent-2)' }}>◆</span>
          <span className="node-label">{p.title}</span>
        </Link>
      ))}
    </Section>
  );
}
