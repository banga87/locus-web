// Server Actions for the marketing surface.
//
// `joinWaitlist` — validates an email, posts it to a Resend Audience, and
// fires a one-off welcome email to the new contact. Designed to be called
// via `useActionState` from the FinalCTA form. The return shape is a
// discriminated union (`WaitlistState`) so the client can switch between
// idle / ok / error without extra booleans.
//
// Env contract (see `.env.local.example`):
//   RESEND_API_KEY               — API key with audiences + emails scopes.
//   RESEND_WAITLIST_AUDIENCE_ID  — UUID of the audience to enroll into.
//
// If either env var is missing we short-circuit BEFORE calling fetch (so we
// never send an undefined bearer token) and return a friendly error. This is
// the expected state at build time on a dev/preview machine without secrets
// configured.
//
// Duplicate handling: Resend's contacts endpoint returns 409 when the email
// is already on the audience. We treat that as success ("you're already on
// the list") AND skip the welcome email so re-submits don't spam the user.
//
// Welcome email failures are logged but never bubble up to the user — the
// contact is on the list either way, and the email is a courtesy. Sending
// is wrapped in its own try/catch so a Resend outage can't take down the
// signup form.

'use server';

import { Resend } from 'resend';
import { z } from 'zod';

import WaitlistWelcomeEmail from '@/emails/waitlist-welcome';
import { logger } from '@/lib/axiom/server';

const FROM_ADDRESS = 'Angus at Tatara <angus@updates.tatara.app>';
const REPLY_TO = 'angus@azgard.tech';
const WELCOME_SUBJECT = "You're on the list at Tatara";
const LIST_UNSUBSCRIBE = '<mailto:angus@azgard.tech?subject=unsubscribe>';

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
      message: "Couldn't reach the invitation list. Try again in a minute.",
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
    // same as first-time signups, and skip the welcome email to avoid
    // spamming people who hit submit twice.
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
        message: 'Something went wrong on our side. Try again in a minute.',
      };
    }

    logger.info('joinWaitlist: added contact', { email: parsed.data });

    // Welcome email — fire-and-log. Failures don't change the user-facing
    // result because the contact IS on the list; the email is a courtesy.
    await sendWelcomeEmail(apiKey, parsed.data);

    return { status: 'ok', email: parsed.data };
  } catch (err) {
    logger.error('joinWaitlist: unexpected error', {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 'error',
      message: 'Something went wrong on our side. Try again in a minute.',
    };
  }
}

async function sendWelcomeEmail(apiKey: string, to: string): Promise<void> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      replyTo: REPLY_TO,
      subject: WELCOME_SUBJECT,
      react: WaitlistWelcomeEmail({ email: to }),
      headers: { 'List-Unsubscribe': LIST_UNSUBSCRIBE },
    });
    if (error) {
      logger.error('joinWaitlist: welcome email failed', {
        email: to,
        error: error.message,
      });
      return;
    }
    logger.info('joinWaitlist: welcome email sent', {
      email: to,
      messageId: data?.id,
    });
  } catch (err) {
    logger.error('joinWaitlist: welcome email threw', {
      email: to,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
