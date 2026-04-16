'use client';
import { Menu } from 'lucide-react';

export function SidebarMobileTrigger() {
  return (
    <button
      type="button"
      className="sidebar-mobile-trigger"
      aria-label="Open sidebar"
      onClick={() => {
        const app = document.querySelector('.app');
        if (!app) return;
        const open = app.getAttribute('data-sidebar-mobile-open') === 'true';
        if (open) app.removeAttribute('data-sidebar-mobile-open');
        else app.setAttribute('data-sidebar-mobile-open', 'true');
      }}
    >
      <Menu size={20} />
    </button>
  );
}
