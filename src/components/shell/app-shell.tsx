'use client';

// Three-region layout: sidebar (left), header (top), main (fills rest).
// Responsive behaviour:
//   >= 1024px  — full text sidebar
//   768–1024px — icon-only sidebar
//   < 768px    — sidebar hidden; header menu button opens it as a sheet
//
// Kept intentionally lightweight — no persisted collapse toggle for Pre-MVP.

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';

import { Sheet, SheetContent } from '@/components/ui/sheet';

import { Sidebar } from './sidebar';
import { Header } from './header';

interface AppShellProps {
  children: ReactNode;
  companyName: string;
  user: {
    email: string;
    fullName: string | null;
    role: string;
  };
}

export function AppShell({ children, companyName, user }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewport, setViewport] = useState<'mobile' | 'compact' | 'full'>('full');

  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      if (w < 768) setViewport('mobile');
      else if (w < 1024) setViewport('compact');
      else setViewport('full');
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const sidebarCollapsed = viewport === 'compact';
  const sidebarInline = viewport !== 'mobile';

  return (
    <div className="flex h-full min-h-screen flex-1 bg-background">
      {sidebarInline && (
        <Sidebar companyName={companyName} collapsed={sidebarCollapsed} />
      )}

      {!sidebarInline && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-60" showCloseButton={false}>
            <Sidebar
              companyName={companyName}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <Header
          user={user}
          companyName={companyName}
          onMenuClick={
            sidebarInline ? undefined : () => setMobileOpen(true)
          }
        />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
