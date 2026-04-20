'use client';

// /login — email + password sign in. Client-side because we call
// supabase.auth.signInWithPassword directly from the browser; the session
// cookie is written by @supabase/ssr on the response.

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

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
    <>
      <Card>
        <CardHeader>
          <Eyebrow number="01">SIGN IN</Eyebrow>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Welcome back. Enter your email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-[var(--state-error)]">
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
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-[var(--ink-3)]">
        No account yet?{' '}
        <Link
          className="text-[var(--link)] underline underline-offset-[3px]"
          href="/signup"
        >
          Create one
        </Link>
      </p>
    </>
  );
}
