'use client';

// Client wrapper that composes the session sidebar (always-visible on
// desktop, drawer on mobile) with the live chat interface for the
// current session.
//
// Lives next to the page (not in /components/chat/) because it owns
// the page-level layout and is unique to this route. Components in
// /components/chat/ are reusable building blocks; this file is the
// one place that wires them together for the /chat/[sessionId] route.
//
// Mobile pattern mirrors AppShell's: < 768px hides the sidebar inline
// and exposes a hamburger button that toggles a Sheet.

import { useEffect, useState } from 'react';
import { MenuIcon } from 'lucide-react';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ChatInterface } from '@/components/chat/chat-interface';
import { SessionSidebar } from '@/components/chat/session-sidebar';
import type { UIMessage } from 'ai';

interface ChatRootProps {
  sessionId: string;
  initialMessages: UIMessage[];
}

export function ChatRoot({ sessionId, initialMessages }: ChatRootProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const compute = () => setIsMobile(window.innerWidth < 768);
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return (
    <div className="flex h-full w-full min-h-0">
      {/* Desktop sidebar — always visible. */}
      {!isMobile && (
        <div className="h-full w-72 shrink-0">
          <SessionSidebar activeSessionId={sessionId} />
        </div>
      )}

      {/* Mobile drawer. */}
      {isMobile && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            className="w-72 p-0"
            showCloseButton={false}
          >
            <SessionSidebar
              activeSessionId={sessionId}
              onNavigate={() => setDrawerOpen(false)}
            />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex h-full min-h-0 flex-1 flex-col">
        {isMobile && (
          <div className="flex h-10 items-center border-b border-border bg-background px-2">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Open chat list"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          <ChatInterface
            sessionId={sessionId}
            initialMessages={initialMessages}
          />
        </div>
      </div>
    </div>
  );
}
