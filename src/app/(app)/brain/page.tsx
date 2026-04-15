// Brain home — overview of the company's brain. Uses the editorial
// <ArticleView> shell to frame a stats strip and a "Recent" list of the
// most recently updated user-authored documents.
//
// Brain browsing happens in the left sidebar (see <NewSidebar> / <BrainTree>);
// this page is the landing view when a user clicks "Brain" in the chrome.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, folders } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { ArticleView } from '@/components/brain/article-view';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { getFreshness } from '@/lib/brain/freshness';
import { formatDistance } from '@/lib/format/time';

function firstName(full: string | null, email: string): string {
  if (full && full.trim().length > 0) {
    return full.trim().split(/\s+/)[0] ?? full;
  }
  return email.split('@')[0] ?? 'there';
}

interface StatCardProps {
  label: string;
  value: number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="border border-rule rounded-lg px-4 py-4 bg-secondary">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">
        {label}
      </div>
      <div
        className="mt-2 text-3xl text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
      >
        {value}
      </div>
    </div>
  );
}

export default async function BrainHomePage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // Stats: total user-authored docs, folder count, pinned doc count.
  // MVP scale — three COUNT queries are fine; revisit if this page becomes hot.
  const [docCountRow] = await db
    .select({ total: count() })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    );
  const [folderCountRow] = await db
    .select({ total: count() })
    .from(folders)
    .where(eq(folders.brainId, brain.id));
  const [pinnedCountRow] = await db
    .select({ total: count() })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        eq(documents.isPinned, true),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    );

  const stats = {
    docCount: docCountRow?.total ?? 0,
    folderCount: folderCountRow?.total ?? 0,
    pinnedCount: pinnedCountRow?.total ?? 0,
  };

  // Recent docs — 6 most recently updated user-authored entries.
  const recent = await db
    .select({
      id: documents.id,
      title: documents.title,
      updatedAt: documents.updatedAt,
      confidenceLevel: documents.confidenceLevel,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(6);

  const name = firstName(ctx.fullName, ctx.email);
  const now = new Date();

  return (
    <ArticleView
      eyebrow="Brain · Overview"
      title={`Welcome back, ${name}`}
      deck="Your company's documents, organised and agent-ready."
      breadcrumb={[{ label: 'Brain' }]}
      meta={{
        status: 'Active',
        confidence: '—',
        updatedAt: 'Just now',
        updatedFreshness: 'fresh',
        author: name,
      }}
      actions={<ThemeToggle />}
    >
      <div className="grid grid-cols-3 gap-4 my-8">
        <StatCard label="Documents" value={stats.docCount} />
        <StatCard label="Folders" value={stats.folderCount} />
        <StatCard label="Pinned" value={stats.pinnedCount} />
      </div>

      <h2
        className="mt-10 mb-4 text-xl text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
      >
        Recent
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-ink-2">No documents yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 not-prose">
          {recent.map((doc) => {
            const updatedIso = doc.updatedAt.toISOString();
            const freshness = getFreshness(
              updatedIso,
              doc.confidenceLevel,
              now,
            );
            return (
              <li key={doc.id}>
                <Link
                  href={`/brain/${doc.id}`}
                  data-freshness={freshness}
                  className="flex items-baseline justify-between gap-4 py-2 border-b border-rule hover:text-ink text-ink"
                >
                  <span className="truncate">{doc.title}</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2 shrink-0">
                    {formatDistance(doc.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ArticleView>
  );
}
