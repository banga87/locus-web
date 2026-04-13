// Setup wizard — one step for Pre-MVP: name your company.
//
// On submit we do four things in a single transaction: create the company,
// attach the user to it, create their first brain, and seed that brain
// with the Universal Base Pack. Then we try to regenerate the navigation
// manifest (no-op for now — Task 11 wires it) and bounce the user to /.
//
// Anything that fails mid-flow rolls the whole thing back, so a user
// never ends up half-set-up.

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains, companies, users } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { seedBrainFromUniversalPack } from '@/lib/templates/seed';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { Button } from '@/components/ui/button';

// ----- Server Action -----------------------------------------------------

async function completeSetup(formData: FormData) {
  'use server';

  let ctx;
  try {
    ctx = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError && err.statusCode === 401) {
      redirect('/login');
    }
    throw err;
  }

  if (ctx.companyId) {
    // Already set up — shouldn't be hitting this action, but if a stale
    // tab posts the form, silently bounce to the dashboard.
    redirect('/');
  }

  const rawName = formData.get('companyName');
  const name =
    typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) {
    redirect(
      '/setup?error=' + encodeURIComponent('Please enter a company name.'),
    );
  }
  if (name.length > 100) {
    redirect(
      '/setup?error=' +
        encodeURIComponent('Company name must be 100 characters or fewer.'),
    );
  }

  // URL-safe slug. Collision handling is best-effort — we append a short
  // random suffix if the derived slug is already taken, rather than
  // prompting the user. A founder picking "Acme" shouldn't have to
  // litigate global uniqueness.
  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'company';

  let brainId: string | null = null;
  let companyId: string | null = null;

  await db.transaction(async (tx) => {
    let slug = baseSlug;
    let attempts = 0;

    while (attempts < 5) {
      const existing = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, slug))
        .limit(1);
      if (existing.length === 0) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      attempts += 1;
    }

    const [companyRow] = await tx
      .insert(companies)
      .values({ name, slug })
      .returning({ id: companies.id });
    if (!companyRow) throw new Error('Failed to create company.');
    companyId = companyRow.id;

    await tx
      .update(users)
      .set({
        companyId: companyRow.id,
        role: 'owner',
        status: 'active',
        fullName:
          ctx.fullName && ctx.fullName.trim().length > 0
            ? ctx.fullName
            : ctx.email.split('@')[0] || 'Owner',
      })
      .where(eq(users.id, ctx.userId));

    const [brainRow] = await tx
      .insert(brains)
      .values({
        companyId: companyRow.id,
        name: 'Main',
        slug: 'main',
        description: `${name}'s primary brain.`,
      })
      .returning({ id: brains.id });
    if (!brainRow) throw new Error('Failed to create brain.');
    brainId = brainRow.id;
  });

  // Seed outside the outer transaction so the (itself transactional)
  // seeder manages its own atomicity — keeping the first transaction
  // narrowly scoped avoids long-running locks on companies/users/brains.
  //
  // `seedBrainFromUniversalPack` already regenerates the manifest on
  // success. The extra `tryRegenerateManifest` call is a defensive
  // idempotent refresh — cheap, and guarantees a current manifest even if
  // the seed's regen failed silently.
  if (companyId && brainId) {
    await seedBrainFromUniversalPack(brainId, companyId);
    await tryRegenerateManifest(brainId);
  }

  redirect('/');
}

// ----- Page --------------------------------------------------------------

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError && err.statusCode === 401) {
      redirect('/login');
    }
    throw err;
  }

  if (ctx.companyId) {
    redirect('/');
  }

  const { error } = await searchParams;

  return (
    <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-foreground">
        Name your company
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        This creates your brain and seeds it with ten starter documents. You
        can rename or edit everything later.
      </p>

      <form action={completeSetup} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Company name</span>
          <input
            name="companyName"
            type="text"
            required
            maxLength={100}
            autoComplete="organization"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg">
          Create company & continue
        </Button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        Signed in as {ctx.email}.
      </p>
    </div>
  );
}
