// ChatContainer scroll behaviour tests. The key case: when history
// hydrates into the DOM AFTER first mount (which is what happens with
// the useEffect-driven setMessages hydration in ChatInterface), the
// container must still end up pinned to the bottom — not stuck at the
// top of the message list.
//
// jsdom doesn't actually lay anything out — every element has 0
// scrollHeight by default — so we stub the relevant DOM properties
// and spy on scrollTo to observe behaviour.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

import { ChatContainer } from '@/components/chat/chat-container';

describe('ChatContainer scroll-to-bottom on hydration', () => {
  const originalScrollTo = HTMLDivElement.prototype.scrollTo;

  afterEach(() => {
    HTMLDivElement.prototype.scrollTo = originalScrollTo;
    vi.restoreAllMocks();
  });

  it('scrolls to bottom once the first non-zero streamTick arrives', () => {
    const scrollCalls: Array<{ top: number; behavior?: ScrollBehavior }> = [];
    // Override jsdom's no-op scrollTo so we can observe the numeric
    // target the container asks for.
    HTMLDivElement.prototype.scrollTo = function scrollTo(
      options?: number | ScrollToOptions,
    ) {
      if (typeof options === 'object' && options) {
        scrollCalls.push({
          top: options.top ?? 0,
          behavior: options.behavior,
        });
      }
    };
    // Keep dimensions honest — scrollHeight > clientHeight so
    // "at bottom" actually exercises the numeric branch.
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 1000;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 400;
      },
    });

    // Render with streamTick=0 first (simulates mount-before-hydration).
    const { rerender } = render(
      <ChatContainer streamTick={0}>
        <div>pre-hydrate</div>
      </ChatContainer>,
    );

    // Clear any mount-time scrollTo calls so we isolate the hydration
    // pin. useLayoutEffect on mount does one scrollTo(0) because the
    // viewport is empty at that moment — that's the bug we're fixing:
    // the useful pin comes with the hydration effect below.
    scrollCalls.length = 0;

    // Second render — hydration complete, streamTick jumps to a
    // representative non-zero value. ChatContainer should respond by
    // pinning to bottom (scrollTo({ top: scrollHeight })).
    act(() => {
      rerender(
        <ChatContainer streamTick={120}>
          <div>hydrated message 1</div>
          <div>hydrated message 2</div>
        </ChatContainer>,
      );
    });

    // At least one scrollTo should target the bottom (top: 1000).
    const pinnedToBottom = scrollCalls.some((c) => c.top >= 1000);
    expect(pinnedToBottom).toBe(true);
  });

  it('does not re-fire the hydration pin on subsequent streamTick changes', () => {
    let mountPinCount = 0;
    const scrollCalls: Array<{ top: number }> = [];
    HTMLDivElement.prototype.scrollTo = function scrollTo(
      options?: number | ScrollToOptions,
    ) {
      if (typeof options === 'object' && options) {
        scrollCalls.push({ top: options.top ?? 0 });
      }
      mountPinCount++;
    };
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 1000;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 400;
      },
    });

    const { rerender } = render(
      <ChatContainer streamTick={0}>
        <div>empty</div>
      </ChatContainer>,
    );

    // First hydration — pin fires.
    act(() => {
      rerender(
        <ChatContainer streamTick={10}>
          <div>turn 1</div>
        </ChatContainer>,
      );
    });
    const callsAfterHydration = scrollCalls.length;

    // Further ticks — the hydration-specific pin MUST NOT re-fire.
    // (The normal auto-follow path will still fire while the user is
    // at the bottom; that's expected. We're checking that we don't
    // have a runaway re-scroll every tick beyond the normal one.)
    act(() => {
      rerender(
        <ChatContainer streamTick={20}>
          <div>turn 1</div>
          <div>turn 2</div>
        </ChatContainer>,
      );
    });
    // Should add at most one more scroll (the normal at-bottom
    // follow), definitely not two.
    expect(scrollCalls.length - callsAfterHydration).toBeLessThanOrEqual(1);
    expect(mountPinCount).toBeGreaterThan(0);
  });
});
