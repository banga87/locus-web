// Section 07 — "The Invitation". Final CTA band, dark palette with hero image
// backdrop and the waitlist form. Client Component because the form uses
// `useActionState` to wire into the `joinWaitlist` Server Action.
//
// Ported from Tatara/components/Sections.jsx lines 522–604. Deviations from
// the prototype:
//   - Static backdrop image uses next/image (fill, priority={false}) instead
//     of a CSS background-image URL — LCP stays on Hero's priority image.
//   - Form goes through `useActionState` for proper Server Action wiring,
//     including an `isPending` guard against double-submits.
//   - Success / error states are rendered inline per the Task 7 spec.
//   - SpecLabel is colored in gold via its existing `className` prop (same
//     pattern section-frame.tsx uses for its dark-section SpecLabels). No
//     primitive refactor needed — see "SpecLabel tone" note in the PR.

'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import type { CSSProperties } from 'react';

import { GaugeNeedle, SpecLabel } from '@/components/marketing/primitives';
import { joinWaitlist, type WaitlistState } from '@/app/(marketing)/actions';

const INITIAL_STATE: WaitlistState = { status: 'idle' };

const H2_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 300,
  fontSize: 'clamp(52px, 6vw, 96px)',
  lineHeight: 1.0,
  letterSpacing: '-0.025em',
  color: 'var(--mk-paper)',
  margin: '28px 0 0',
  fontVariationSettings: '"SOFT" 50, "opsz" 144',
  textWrap: 'balance',
};

const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: 'var(--font-body), system-ui, sans-serif',
  fontSize: 18,
  lineHeight: 1.6,
  color: 'var(--mk-paper-dim)',
  maxWidth: 620,
  margin: '32px auto 0',
  textWrap: 'pretty',
};

const CONFIRM_HEADLINE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontStyle: 'italic',
  fontWeight: 300,
  fontSize: 22,
  lineHeight: 1.4,
  color: 'var(--mk-paper)',
  margin: 0,
  fontVariationSettings: '"SOFT" 50',
  textWrap: 'balance',
};

export function FinalCTA() {
  const [state, formAction, isPending] = useActionState<WaitlistState, FormData>(
    joinWaitlist,
    INITIAL_STATE,
  );

  const isOk = state.status === 'ok';
  const isError = state.status === 'error';

  return (
    <section
      id="invitation"
      className="relative overflow-hidden"
      style={{ background: 'var(--mk-ink)', color: 'var(--mk-paper)' }}
    >
      {/* Backdrop image. Not LCP-eligible (below the fold), so no `priority`.
          `object-[center_60%]` mirrors the prototype's background-position. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Image
          src="/images/hero.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[center_60%]"
          style={{ opacity: 0.35, filter: 'saturate(0.9)' }}
        />
      </div>

      {/* Dark gradient overlay for legibility. Sits above the image, below
          the content. The rgba literal is specific to this one band — no
          token equivalent elsewhere in marketing.css. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(27,20,16,0.85) 0%, rgba(27,20,16,0.55) 50%, rgba(27,20,16,0.9) 100%)',
        }}
      />

      {/* Content. Padding scales down on mobile so the section doesn't swallow
          small-screen viewports; desktop matches the prototype's 160/48. */}
      <div className="relative mx-auto max-w-[1100px] px-6 py-[96px] text-center min-[900px]:px-12 min-[900px]:py-[160px]">
        <SpecLabel
          number="07"
          className="text-[color:var(--mk-gold)] [&>span[aria-hidden]]:!bg-[color:var(--mk-gold)]"
        >
          The Invitation
        </SpecLabel>

        <h2 style={H2_STYLE}>
          Come and{' '}
          <span className="italic" style={{ color: 'var(--mk-gold-2)' }}>
            stoke the fire.
          </span>
        </h2>

        <p className="mx-auto" style={SUBHEAD_STYLE}>
          Tatara is in private beta. We&rsquo;re letting in a small number of operators at a time,
          so the machine stays warm and everyone who&rsquo;s in it gets real attention from our
          side.
        </p>

        {isOk ? (
          <ConfirmationCard email={state.email} />
        ) : (
          <WaitlistForm isPending={isPending} formAction={formAction} errorMessage={isError ? state.message : null} />
        )}
      </div>
    </section>
  );
}

// --- Subcomponents ---------------------------------------------------------

interface WaitlistFormProps {
  isPending: boolean;
  formAction: (formData: FormData) => void;
  errorMessage: string | null;
}

function WaitlistForm({ isPending, formAction, errorMessage }: WaitlistFormProps) {
  return (
    <>
      <form
        action={formAction}
        className="mx-auto mt-12 flex w-full max-w-[520px] flex-col gap-[10px] sm:flex-row"
      >
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          disabled={isPending}
          placeholder="you@workshop.com"
          className="flex-1 border bg-[rgba(245,239,227,0.06)] px-[18px] py-[16px] text-[15px] text-[color:var(--mk-paper)] placeholder:text-[color:var(--mk-paper-dim)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mk-gold-2)] disabled:opacity-60"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            borderColor: 'rgba(245,239,227,0.25)',
          }}
        />
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex cursor-pointer items-center justify-center gap-[10px] border px-6 py-[16px] text-[15px] font-medium transition-colors duration-150 hover:bg-[color:var(--mk-paper)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            background: 'var(--mk-gold-2)',
            borderColor: 'var(--mk-gold-2)',
            color: 'var(--mk-ink)',
          }}
        >
          {isPending ? 'Requesting…' : 'Request an invitation'}
          {!isPending && (
            <span
              className="italic leading-none"
              style={{ fontFamily: 'var(--font-display), serif', fontSize: 17 }}
            >
              →
            </span>
          )}
        </button>
      </form>

      {errorMessage && (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-[520px] text-[13px]"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            color: 'var(--mk-gold-2)',
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* Badge — mono, amber, centered. */}
      <div
        className="mt-7 flex items-center justify-center gap-[10px] text-[11px] uppercase tracking-[0.14em]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'rgba(245,239,227,0.6)',
        }}
      >
        <GaugeNeedle size={14} color="var(--mk-gold-2)" />
        <span>No credit card &middot; no autopilot &middot; no surprises</span>
      </div>
    </>
  );
}

function ConfirmationCard({ email }: { email: string }) {
  return (
    <div className="mx-auto mt-12 flex w-full max-w-[520px] flex-col items-center gap-4">
      <p style={CONFIRM_HEADLINE_STYLE}>
        On the list. We&rsquo;ll be in touch when the forge is ready.
      </p>
      <p
        className="text-[12px]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'var(--mk-paper-dim)',
          letterSpacing: '0.04em',
        }}
      >
        {email}
      </p>

      <div
        className="mt-3 flex items-center justify-center gap-[10px] text-[11px] uppercase tracking-[0.14em]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'rgba(245,239,227,0.6)',
        }}
      >
        <GaugeNeedle size={14} color="var(--mk-gold-2)" />
        <span>No credit card &middot; no autopilot &middot; no surprises</span>
      </div>
    </div>
  );
}
