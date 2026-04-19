'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/tatara';

export function SidebarMobileTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const clear = () => {
      if (window.innerWidth >= 768) {
        document.querySelector('.app')?.removeAttribute('data-sidebar-mobile-open');
        setOpen(false);
      }
    };
    window.addEventListener('resize', clear);
    return () => window.removeEventListener('resize', clear);
  }, []);

  const handleClick = () => {
    const app = document.querySelector('.app');
    if (!app) return;
    if (open) {
      app.removeAttribute('data-sidebar-mobile-open');
      setOpen(false);
    } else {
      app.setAttribute('data-sidebar-mobile-open', 'true');
      setOpen(true);
    }
  };

  return (
    <button
      type="button"
      className="sidebar-mobile-trigger"
      aria-label={open ? 'Close sidebar' : 'Open sidebar'}
      aria-expanded={open}
      onClick={handleClick}
    >
      <Icon name="Menu" size={20} />
    </button>
  );
}
