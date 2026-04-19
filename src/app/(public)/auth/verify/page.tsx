// /auth/verify — holding page users see right after sign-up. Supabase
// sends them a confirmation email with a link back to /auth/callback; we
// don't do anything here other than tell them to check their inbox.

import { Eyebrow, GaugeNeedle } from '@/components/tatara';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function VerifyPage() {
  return (
    <Card>
      <CardHeader>
        <Eyebrow number="02">CHECK YOUR EMAIL</Eyebrow>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We just sent you a verification link. Click it from the same device
          you signed up on and you&apos;ll land back here ready to set up your
          company.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <GaugeNeedle size="sm" />
          Waiting for confirmation…
        </div>
        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          Didn&apos;t arrive in a minute or two? Check your spam folder — or
          start over at{' '}
          <a
            className="text-[var(--link)] underline underline-offset-[3px]"
            href="/signup"
          >
            signup
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
