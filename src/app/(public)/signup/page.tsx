'use client';

// /signup — email + password account creation. Supabase sends a
// confirmation email; on click, the link lands on /auth/callback which
// finalises the session and creates the public.users row.

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Eyebrow } from '@/components/tatara';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setPending(false);
      return;
    }

    const supabase = createClient();
    const redirectBase =
      typeof window !== 'undefined' ? window.location.origin : '';

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${redirectBase}/auth/callback`,
      },
    });

    if (signUpError) {
      setError(signUpError.message || 'Sign up failed.');
      setPending(false);
      return;
    }

    // If email confirmation is disabled in Supabase, signUp returns an
    // active session immediately — skip the "check your email" screen.
    if (data.session) {
      router.replace('/setup');
      return;
    }

    router.replace('/auth/verify');
  }

  return (
    <>
      <Card>
        <CardHeader>
          <Eyebrow number="01">CREATE ACCOUNT</Eyebrow>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            One minute to sign up. We&apos;ll send a verification email before
            you get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                8 characters minimum.
              </p>
            </div>

            {error ? (
              <p
                role="alert"
                className="text-sm"
                style={{ color: 'var(--state-error)' }}
              >
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="default"
              size="lg"
              disabled={pending}
              className="w-full"
            >
              {pending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-[var(--ink-3)]">
        Already have an account?{' '}
        <Link
          className="text-[var(--link)] underline underline-offset-[3px]"
          href="/login"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
