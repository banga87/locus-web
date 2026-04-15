'use client';

import { useSyncExternalStore } from 'react';
import { setThemeCookie } from '@/lib/theme/cookie';

type Theme = 'light' | 'dark';

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function getServerSnapshot(): Theme {
  return 'light';
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
    void setThemeCookie(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="font-mono text-[10.5px] uppercase tracking-[0.08em] bg-secondary text-ink-2 border border-rule rounded-full px-3 py-1.5 hover:text-ink"
    >
      {theme === 'light' ? 'Light · Dark' : 'Dark · Light'}
    </button>
  );
}
