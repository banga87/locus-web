'use client';

// /signup — email + password account creation. Supabase sends a
// confirmation email; on click, the link lands on /auth/callback which
// finalises the session and creates the public.users row.

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
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

    const { error: signUpError } = await supabase.auth.signUp({
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

    router.replace('/auth/verify');
  }

  return (
    <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-foreground">
        Create your account
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        One minute to sign up. We&apos;ll send a verification email before you
        get started.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            8 characters minimum.
          </span>
        </label>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} size="lg">
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link className="font-medium text-foreground underline" href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
