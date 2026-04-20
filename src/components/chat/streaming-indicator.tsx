'use client';

// Three-dot "typing" animation. Rendered as an empty assistant message
// bubble when the hook `status` is 'submitted' (request sent, no tokens
// yet) or 'streaming' (tokens arriving). The chat container decides
// when to mount us; we just render the dots.
//
// Timing: Tailwind's `animate-bounce` is a 1s loop. Staggering each dot
// by ~0.15s gives the classic wave look without custom keyframes.

export function StreamingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Assistant is responding"
      className="inline-flex items-center gap-1 rounded-2xl border border-[var(--rule-1)] bg-[var(--surface-1)] px-4 py-3"
    >
      <Dot delay="0s" />
      <Dot delay="0.15s" />
      <Dot delay="0.3s" />
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 rounded-full"
      style={{
        backgroundColor: 'var(--ember-warm)',
        animation: 'locus-chat-bounce 1s infinite ease-in-out',
        animationDelay: delay,
      }}
    />
  );
}
