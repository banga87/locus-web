'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface SectionProps {
  id: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  headerAction?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function Section({
  id,
  icon: Icon,
  label,
  count,
  headerAction,
  expanded,
  onToggle,
  children,
}: SectionProps) {
  const bodyId = useId();

  return (
    <div className="sidebar-section" data-section-id={id}>
      <div className="sidebar-section-header-row">
        <button
          type="button"
          className="sidebar-section-header"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <ChevronRight
            size={12}
            className="sidebar-section-chevron"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease-out',
            }}
            aria-hidden="true"
          />
          <Icon size={14} aria-hidden="true" />
          <span className="label">{label}</span>
          {typeof count === 'number' && <span className="count">{count}</span>}
        </button>
        {headerAction && <span className="sidebar-section-action">{headerAction}</span>}
      </div>
      <div id={bodyId} className="sidebar-section-body" hidden={!expanded}>
        {expanded && children}
      </div>
    </div>
  );
}
