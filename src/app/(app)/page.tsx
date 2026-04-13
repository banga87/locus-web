// Dashboard home page.
//
// Server Component: counts the brain's documents and renders a single card
// with two CTAs. Activity feed, health score, and sparklines are explicitly
// out of scope for Pre-MVP (Task 10 §Scope).

import Link from 'next/link';
import { and, count, eq, isNull } from 'drizzle-orm';
import { BookOpenIcon, KeyIcon } from 'lucide-react';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function firstName(full: string | null, email: string): string {
  if (full && full.trim().length > 0) {
    return full.trim().split(/\s+/)[0] ?? full;
  }
  return email.split('@')[0] ?? 'there';
}

export default async function HomePage() {
  // (app)/layout already guarantees ctx.companyId is non-null here.
  const ctx = await requireAuth();
  if (!ctx.companyId) {
    return null;
  }

  const brain = await getBrainForCompany(ctx.companyId);

  const [row] = await db
    .select({ total: count() })
    .from(documents)
    .where(
      and(eq(documents.brainId, brain.id), isNull(documents.deletedAt)),
    );
  const total = row?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstName(ctx.fullName, ctx.email)}.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your brain at a glance.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Brain</CardTitle>
          <CardDescription>
            You have{' '}
            <span className="font-medium text-foreground">
              {total} {total === 1 ? 'document' : 'documents'}
            </span>{' '}
            in your brain.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button render={<Link href="/brain" />}>
            <BookOpenIcon className="size-4" />
            Browse brain
          </Button>
          <Button variant="outline" render={<Link href="/settings/agent-tokens" />}>
            <KeyIcon className="size-4" />
            Manage agent tokens
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
