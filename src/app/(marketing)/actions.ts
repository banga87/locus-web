// Server Actions for the marketing surface.
//
// `joinWaitlist` — validates an email and posts it to a Resend Audience.
// Designed to be called via `useActionState` from the FinalCTA form. The
// return shape is a discriminated union (`WaitlistState`) so the client can
// switch between idle / ok / error without extra booleans.
//
// Env contract (see `.env.local.example`):
//   RESEND_API_KEY               — API key scoped to the audiences endpoint.
//   RESEND_WAITLIST_AUDIENCE_ID  — UUID of the audience to enroll into.
//
// If either env var is missing we short-circuit BEFORE calling fetch (so we
// never send an undefined bearer token) and return a friendly error. This is
// the expected state at build time on a dev/preview machine without secrets
// configured.
//
// Duplicate handling: Resend's contacts endpoint returns 409 when the email
// is already on the audience. We treat that as success ("you're already on
// the list") so a re-submission looks the same as a first-time signup.

'use server';

import { z } from 'zod';

import { logger } from '@/lib/axiom/server';

const emailSchema = z.string().email().max(320);

export type WaitlistState =
  | { status: 'idle' }
  | { status: 'ok'; email: string }
  | { status: 'error'; message: string };

export async function joinWaitlist(
  _prevState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw = formData.get('email');
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: 'Please enter a valid email address.' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_WAITLIST_AUDIENCE_ID;

  // Guard BEFORE fetch so we never send an undefined bearer token.
  if (!apiKey || !audienceId) {
    logger.warn('joinWaitlist called but Resend env vars are missing', {
      hasApiKey: !!apiKey,
      hasAudienceId: !!audienceId,
    });
    return {
      status: 'error',
      message: "Couldn't reach the invitation list — try again in a minute.",
    };
  }

  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: parsed.data, unsubscribed: false }),
      },
    );

    // 409 = already on the list. Treat as success so re-submits look the
    // same as first-time signups.
    if (res.status === 409) {
      logger.info('joinWaitlist: contact already present', { email: parsed.data });
      return { status: 'ok', email: parsed.data };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('Resend audience POST failed', {
        status: res.status,
        body: body.slice(0, 500),
      });
      return {
        status: 'error',
        message: 'Something went wrong on our side — try again in a minute.',
      };
    }

    logger.info('joinWaitlist: added contact', { email: parsed.data });
    return { status: 'ok', email: parsed.data };
  } catch (err) {
    logger.error('joinWaitlist: unexpected error', {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 'error',
      message: 'Something went wrong on our side — try again in a minute.',
    };
  }
}
