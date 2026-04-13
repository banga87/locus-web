'use client';

// Top bar for the authenticated app. Hosts the mobile-menu trigger (wired
// via parent callback) on the left, and the user avatar + dropdown on the
// right. Sign-out calls supabase.auth.signOut() then redirects to /login.

import { useRouter } from 'next/navigation';
import { MenuIcon, LogOutIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { createClient } from '@/lib/supabase/client';

interface HeaderProps {
  user: {
    email: string;
    fullName: string | null;
    role: string;
  };
  companyName: string;
  onMenuClick?: () => void;
}

function initials(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    return parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }
  return (email[0] ?? '?').toUpperCase();
}

export function Header({ user, companyName, onMenuClick }: HeaderProps) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <MenuIcon className="size-4" />
          </Button>
        )}
        <span className="text-base font-semibold tracking-tight md:hidden">
          Locus
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            />
          }
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials(user.fullName, user.email)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="text-sm font-medium">
              {user.fullName ?? user.email}
            </span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
            <span className="text-xs text-muted-foreground">
              {companyName} · {user.role}
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={<button type="button" onClick={signOut} className="w-full" />}
          >
            <LogOutIcon className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
