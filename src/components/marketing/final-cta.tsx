// Section 07 — "The Invitation". Final CTA band, restyled onto HeroPlate +
// canonical voice. Client Component because the waitlist form uses
// `useActionState` to wire into the `joinWaitlist` Server Action.
//
// Structure:
//   <HeroPlate image={...} bottomFade={false}>
//     <dark overlay>             ← legibility scrim over the hero image
//     <copy deck>                ← Eyebrow + h1 + lede + form / confirmation
//   </HeroPlate>
//
// bottomFade is off because this band sits directly above the footer — the
// footer owns that transition, not the plate.

'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Eyebrow, GaugeNeedle, HeroPlate } from '@/components/tatara';
import { joinWaitlist, type WaitlistState } from '@/app/(marketing)/actions';

const INITIAL_STATE: WaitlistState = { status: 'idle' };

export function FinalCTA() {
  const [state, formAction, isPending] = useActionState<WaitlistState, FormData>(
    joinWaitlist,
    INITIAL_STATE,
  );

  const isOk = state.status === 'ok';
  const isError = state.status === 'error';

  return (
    <section id="invitation">
      <HeroPlate
        image="/images/hero-2400.jpg"
        alt=""
        bottomFade={false}
        className="min-h-[480px]"
      >
        {/* Dark gradient overlay for legibility. Sits above the image, below
            the content. The rgba literal is specific to this one band — no
            token equivalent elsewhere in the design system. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(27,20,16,0.85) 0%, rgba(27,20,16,0.55) 50%, rgba(27,20,16,0.9) 100%)',
          }}
        />

        {/* Content. Padding scales down on mobile so the section doesn't
            swallow small-screen viewports; desktop matches the prototype's
            160/48. */}
        <div
          className="relative mx-auto max-w-[1100px] px-6 py-[96px] text-center lg:px-12 lg:py-[160px]"
          style={{ color: 'var(--ink-inverse)' }}
        >
          <Eyebrow number="04" color="var(--brass-soft)">
            The Invitation
          </Eyebrow>

          <h2 className="t-h1 mt-7" style={{ color: 'var(--ink-inverse)' }}>
            Come and{' '}
            <span className="italic" style={{ color: 'var(--brass-soft)' }}>
              stoke the fire.
            </span>
          </h2>

          <p
            className="t-lede mx-auto mt-8 max-w-[620px]"
            style={{ color: 'var(--ink-inverse-2)' }}
          >
            Tatara is in private beta. We&rsquo;re letting in a small number of businesses at a
            time, so the machinery stays warm and every team that joins gets real attention from
            our side.
          </p>

          {isOk ? (
            <ConfirmationCard email={state.email} />
          ) : (
            <WaitlistForm
              isPending={isPending}
              formAction={formAction}
              errorMessage={isError ? state.message : null}
            />
          )}
        </div>
      </HeroPlate>
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
          inputMode="email"
          autoComplete="email"
          enterKeyHint="send"
          disabled={isPending}
          placeholder="you@workshop.com"
          className="flex-1 border px-[18px] py-[16px] text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] disabled:opacity-60"
          style={{
            background: 'rgba(242,234,216,0.06)',
            borderColor: 'rgba(242,234,216,0.25)',
            color: 'var(--ink-inverse)',
            fontFamily: 'var(--font-body)',
          }}
        />
        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? 'Requesting…' : 'Request an invitation'}
        </Button>
      </form>

      {errorMessage && (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-[520px] text-[13px]"
          style={{
            fontFamily: 'var(--font-body)',
            color: 'var(--brass-soft)',
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* Badge — mono, brass, centered. Adds a little warmth below the form. */}
      <div
        className="mt-7 flex items-center justify-center gap-[10px] text-[11px] uppercase tracking-[0.14em]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'var(--ink-inverse-3)',
        }}
      >
        <GaugeNeedle size="sm" color="var(--brass-soft)" />
        <span>No credit card &middot; no autopilot &middot; no surprises{/* tatara:allow-banned */}</span>
      </div>
    </>
  );
}

function ConfirmationCard({ email }: { email: string }) {
  return (
    <div className="mx-auto mt-12 flex w-full max-w-[520px] flex-col items-center gap-4">
      <p
        className="t-lede italic"
        style={{ color: 'var(--ink-inverse)', fontFamily: 'var(--font-display), serif' }}
      >
        On the list. We&rsquo;ll be in touch when the forge is ready.
      </p>
      <p
        className="text-[12px]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'var(--ink-inverse-2)',
          letterSpacing: '0.04em',
        }}
      >
        {email}
      </p>

      <div
        className="mt-3 flex items-center justify-center gap-[10px] text-[11px] uppercase tracking-[0.14em]"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          color: 'var(--ink-inverse-3)',
        }}
      >
        <GaugeNeedle size="sm" color="var(--brass-soft)" />
        <span>No credit card &middot; no autopilot &middot; no surprises{/* tatara:allow-banned */}</span>
      </div>
    </div>
  );
}
