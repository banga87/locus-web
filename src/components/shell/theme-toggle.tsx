'use client';

// Theme toggle uses .quick-item / .rail-btn classnames to match sibling nav rows; avoids wrapping in <Button> which would override layout.
import { useSyncExternalStore } from 'react';
import { Icon } from '@/components/tatara';
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

function useThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
    void setThemeCookie(next);
  };
  return { theme, toggle };
}

// Sidebar variant — matches .quick-item layout so it reads as another nav row.
export function ThemeToggleNav() {
  const { theme, toggle } = useThemeToggle();
  const nextLabel = theme === 'light' ? 'Dark mode' : 'Light mode';
  return (
    <button
      type="button"
      onClick={toggle}
      className="quick-item"
      aria-label={`Switch to ${nextLabel}`}
    >
      {theme === 'light' ? <Icon name="Moon" size={16} /> : <Icon name="Sun" size={16} />}
      {nextLabel}
    </button>
  );
}

// Rail variant — icon-only, matches .rail-btn so it fits the collapsed column.
export function ThemeToggleRail() {
  const { theme, toggle } = useThemeToggle();
  const nextLabel = theme === 'light' ? 'Dark mode' : 'Light mode';
  return (
    <button
      type="button"
      onClick={toggle}
      className="rail-btn"
      title={nextLabel}
      aria-label={`Switch to ${nextLabel}`}
    >
      {theme === 'light' ? <Icon name="Moon" size={20} /> : <Icon name="Sun" size={20} />}
    </button>
  );
}
