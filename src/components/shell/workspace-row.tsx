'use client';

// Sidebar workspace-row — visual-only placeholder for the future
// workspace picker. Shows avatar + company name + chevron. Has no
// picker behaviour yet; Task 11+ will wire the dropdown.

interface WorkspaceRowProps {
  companyName: string;
}

export function WorkspaceRow({ companyName }: WorkspaceRowProps) {
  const initial = companyName.charAt(0).toUpperCase() || '?';
  return (
    <div className="workspace-row">
      <div className="ws-avatar">{initial}</div>
      <div className="ws-name">{companyName}</div>
      <svg
        className="ws-chev"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}
