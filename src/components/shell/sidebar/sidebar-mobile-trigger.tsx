'use client';
import { useEffect } from 'react';
import { Menu } from 'lucide-react';

export function SidebarMobileTrigger() {
  useEffect(() => {
    const clear = () => {
      if (window.innerWidth >= 768) {
        document.querySelector('.app')?.removeAttribute('data-sidebar-mobile-open');
      }
    };
    window.addEventListener('resize', clear);
    return () => window.removeEventListener('resize', clear);
  }, []);

  return (
    <button
      type="button"
      className="sidebar-mobile-trigger"
      aria-label="Open sidebar"
      onClick={(e) => {
        const app = document.querySelector('.app');
        if (!app) return;
        const open = app.getAttribute('data-sidebar-mobile-open') === 'true';
        if (open) {
          app.removeAttribute('data-sidebar-mobile-open');
          e.currentTarget.setAttribute('aria-label', 'Open sidebar');
        } else {
          app.setAttribute('data-sidebar-mobile-open', 'true');
          e.currentTarget.setAttribute('aria-label', 'Close sidebar');
        }
      }}
    >
      <Menu size={20} />
    </button>
  );
}
