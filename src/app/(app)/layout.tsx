// Authenticated app shell. Guards everything under the (app) route group.
//   - No Supabase session     → redirect /login
//   - Session but no companyId → redirect /setup
// The /setup page has its own minimal layout; it lives in (app) so the same
// auth gate applies, but it opts out of this shell via its own layout.tsx.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { companies } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getFolderTree } from '@/lib/brain/folders';
import {
  getBrainForCompany,
  getPinnedDocuments,
} from '@/lib/brain/queries';
import { NewAppShell } from '@/components/shell/new-app-shell';
import { SidebarLayoutBoot } from '@/components/shell/sidebar/sidebar-layout-boot';
import { GlobalRunBadge } from '@/components/layout/global-run-badge';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
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

  // /setup lives under (app) so it inherits this auth gate, but it has its
  // own minimal layout and must render even when companyId is null. We read
  // the pathname (stamped by middleware) to avoid redirect-looping /setup
  // onto itself.
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '';
  const onSetup = pathname.startsWith('/setup');

  if (!ctx.companyId && !onSetup) {
    redirect('/setup');
  }

  // On /setup without a company: render children directly (SetupLayout
  // provides its own chrome). No app shell, no companies lookup.
  if (!ctx.companyId) {
    return <>{children}</>;
  }

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, ctx.companyId))
    .limit(1);

  const companyName = company?.name ?? 'Your company';

  // /setup with a companyId will itself redirect to /home (see setup/page.tsx).
  // Everything else renders the app shell.
  if (onSetup) {
    return <>{children}</>;
  }

  // Load sidebar data alongside the app shell render. Both queries hit
  // indexed per-brain paths; doing them in parallel keeps the layout
  // TTFB close to a single round-trip.
  const brain = await getBrainForCompany(ctx.companyId);
  const [tree, pinned] = await Promise.all([
    getFolderTree({ brainId: brain.id }),
    getPinnedDocuments({ brainId: brain.id }),
  ]);

  return (
    <>
      {/* Must mount alongside (not inside) NewAppShell: hydrates the
          sidebar store so children can read persisted state on first
          render and binds the global Cmd/Ctrl+\ keyboard shortcut. */}
      <SidebarLayoutBoot />
      <NewAppShell
        companyName={companyName}
        user={{ email: ctx.email, fullName: ctx.fullName, role: ctx.role }}
        tree={tree}
        pinned={pinned}
        workflowsBadge={<GlobalRunBadge auth={ctx} />}
      >
        {children}
      </NewAppShell>
    </>
  );
}
