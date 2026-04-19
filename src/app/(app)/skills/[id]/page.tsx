// /skills/[id] — Skill detail page.
//
// Server Component: fetches the root skill doc + resource children, strips
// YAML frontmatter, derives origin, counts agent usage, and hands everything
// to SkillDetailClient.
//
// Access control:
//   - Must be authenticated with a companyId.
//   - Skill must belong to the user's brain and not be soft-deleted.
//   - Skills from other companies → 404 (not 403, to avoid enumeration).

import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import {
  extractYamlFrontmatter,
  parseOrigin,
  parseSkillsFromAgentContent,
} from '@/lib/skills/frontmatter';
import { SkillDetailClient } from './_components/skill-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // 1. Fetch the root skill document.
  const [rootDoc] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.brainId, brain.id),
        eq(documents.type, 'skill'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!rootDoc) return notFound();

  // 2. Fetch all live resource children.
  const resourceDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      relativePath: documents.relativePath,
      content: documents.content,
    })
    .from(documents)
    .where(
      and(
        eq(documents.parentSkillId, rootDoc.id),
        eq(documents.type, 'skill-resource'),
        isNull(documents.deletedAt),
      ),
    );

  // 3. Strip frontmatter from root content to get the SKILL.md body.
  const body = rootDoc.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // 4. Parse origin for header badge + conditional actions.
  const origin = parseOrigin(rootDoc.content);

  // 5. Parse description from frontmatter.
  const fm = extractYamlFrontmatter(rootDoc.content);
  const description = typeof fm['description'] === 'string' ? fm['description'] : null;

  // 6. Agent usage count.
  const agentDocs = await db
    .select({ id: documents.id, content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        eq(documents.type, 'agent-definition'),
        isNull(documents.deletedAt),
      ),
    );

  let agentCount = 0;
  for (const agent of agentDocs) {
    const skillIds = parseSkillsFromAgentContent(agent.content);
    if (skillIds.includes(rootDoc.id)) agentCount++;
  }

  const canEdit = ['owner', 'admin', 'editor'].includes(ctx.role);

  return (
    <SkillDetailClient
      root={{
        id: rootDoc.id,
        title: rootDoc.title,
        description,
        body,
        origin,
        updatedAt: rootDoc.updatedAt,
      }}
      resources={resourceDocs}
      agentCount={agentCount}
      canEdit={canEdit}
    />
  );
}
