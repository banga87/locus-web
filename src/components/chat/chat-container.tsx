'use client';

// Scrollable message stream. Handles two small-but-fiddly pieces of UX:
//
//   1. Auto-scroll to bottom when new messages arrive — but only if the
//      user is already near the bottom. If they've scrolled up to read
//      history we don't yank them back down.
//   2. Scroll-to-bottom button appears when the user is NOT near the
//      bottom. Clicking it restores the pinned-to-bottom behaviour.
//
// The "near bottom" tolerance (48px) is generous enough that the normal
// streaming-indicator bounce doesn't nudge us into "user scrolled up"
// territory.
//
// We intentionally don't use IntersectionObserver here — we need the
// numeric distance-from-bottom to decide how aggressively to follow,
// and a plain scroll handler on a ref is ~10 lines of code.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowDownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatContainerProps {
  children: ReactNode;
  /**
   * A value that changes when the stream advances (e.g. message count
   * or total character count across all messages). We use it to decide
   * whether to auto-scroll — `children` alone doesn't give us a cheap
   * change signal because React re-renders the whole tree every tick.
   */
  streamTick: number | string;
  className?: string;
}

// Pixels from the bottom within which we consider the user "at bottom"
// and auto-follow the stream. 48px is roughly one message line.
const NEAR_BOTTOM_THRESHOLD = 48;

export function ChatContainer({
  children,
  streamTick,
  className,
}: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const updateAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance <= NEAR_BOTTOM_THRESHOLD);
  }, []);

  // Initial pin to the bottom on mount so resumed sessions don't open
  // scrolled to the top of a long history.
  useLayoutEffect(() => {
    scrollToBottom('auto');
    updateAtBottom();
    // Run once — subsequent auto-scrolls come from the streamTick effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-follow the stream ONLY while the user is already at the bottom.
  useEffect(() => {
    if (!atBottom) return;
    scrollToBottom('auto');
    // Intentionally not depending on `atBottom` directly — we want to
    // re-run on every streamTick, but sample the latest `atBottom` value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamTick]);

  return (
    <div className={cn('relative flex-1 min-h-0', className)}>
      <div
        ref={scrollRef}
        onScroll={updateAtBottom}
        className="h-full overflow-y-auto px-4 py-6"
        data-slot="chat-scroll"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
          {children}
        </div>
      </div>

      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => scrollToBottom('smooth')}
            className="pointer-events-auto shadow-sm"
            aria-label="Scroll to latest message"
          >
            <ArrowDownIcon className="size-3.5" aria-hidden="true" />
            <span>Scroll to bottom</span>
          </Button>
        </div>
      )}
    </div>
  );
}
