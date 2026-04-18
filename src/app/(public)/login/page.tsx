'use client';

// /login — email + password sign in. Client-side because we call
// supabase.auth.signInWithPassword directly from the browser; the session
// cookie is written by @supabase/ssr on the response.

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam ? decodeURIComponent(errorParam) : null,
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message || 'Sign in failed.');
      setPending(false);
      return;
    }

    // Full navigation so middleware re-evaluates with the new cookie and
    // sends us to /setup or /home as appropriate.
    router.refresh();
    router.replace('/home');
  }

  return (
    <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-foreground">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Welcome back. Enter your email and password.
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} size="lg">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        No account yet?{' '}
        <Link className="font-medium text-foreground underline" href="/signup">
          Create one
        </Link>
      </p>
    </div>
  );
}
