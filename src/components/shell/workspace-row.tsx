'use client';

// Sidebar workspace-row — visual-only placeholder for the future
// workspace picker. Shows avatar + company name + chevron. Has no
// picker behaviour yet; Task 11+ will wire the dropdown.

import { Icon } from '@/components/tatara';

interface WorkspaceRowProps {
  companyName: string;
}

export function WorkspaceRow({ companyName }: WorkspaceRowProps) {
  const initial = companyName.charAt(0).toUpperCase() || '?';
  return (
    <div className="workspace-row">
      <div className="ws-avatar">{initial}</div>
      <div className="ws-name">{companyName}</div>
      <Icon name="ChevronDown" size={14} className="ws-chev" />
    </div>
  );
}
