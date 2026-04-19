/**
 * @vitest-environment node
 */
// Integration test for Task 11 Step 4 — large attachment pointer form.
//
// Scope
// -----
// Task 6's pure unit test (`src/lib/context/user-prompt.test.ts`) covers
// the pointer vs inline branching with a mocked repo. Nothing yet
// proves, against a LIVE DB, that an attachment whose extracted text
// exceeds the inline threshold actually lands as a pointer block in the
// UserPromptSubmit payload. This test closes that gap at the layer that
// matters: the inject payload built by the live-DB repo.
//
// Why the pure-repo path rather than the full chat route
// ------------------------------------------------------
// The chat route wraps SessionStart + UserPromptSubmit in the hook bus,
// which means the "did a pointer land?" assertion has to go through
// the concatenated system prompt — noisy to parse. Going one layer in
// (`buildUserPromptPayload(input, createDbUserPromptRepo())`) gives the
// exact same DB behaviour with a tight, structural assertion:
// `block.kind === 'attachment-pointer'`. Task 9's route test already
// covers "inject payloads reach the system prompt"; this test owns the
// "pointer-form is used when content exceeds the inline threshold"
// half of the contract.
//
// What this test asserts
// ----------------------
//   1. A 30KB pasted-text attachment is saved to the DB with
//      `status = 'extracted'` (via `createAttachment` — bypasses the
//      route handler + Storage mocks because pasted-text has no
//      storage path).
//   2. `buildUserPromptPayload(...)` running against the live DB repo
//      returns a block with `kind = 'attachment-pointer'` whose body
//      carries the pointer-form question about source-doc promotion
//      vs section-walk.
//   3. A SMALL (2KB) attachment in the same session falls into the
//      inline branch — `kind = 'attachment-inline'`. This negative
//      case pins the branch: without it, a regression that always-
//      pointer'd every attachment would pass the pointer assertion.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  companies,
  sessionAttachments,
  sessions,
  users,
} from '@/db/schema';
import { createAttachment } from '@/lib/ingestion/attachments';
import { createDbUserPromptRepo } from '@/lib/context/repos';
import { buildUserPromptPayload } from '@/lib/context/user-prompt';

// --- Fixture ------------------------------------------------------------

const suffix = `t11-lrg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let sessionId: string;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `T11 Large Co ${suffix}`, slug: `t11-lrg-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@e2e.local`,
    fullName: `T11 Large ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [session] = await db
    .insert(sessions)
    .values({ companyId, brainId, userId, status: 'active' })
    .returning({ id: sessions.id });
  sessionId = session.id;
}, 60_000);

afterAll(async () => {
  await db
    .delete(sessionAttachments)
    .where(eq(sessionAttachments.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.delete(users).where(eq(users.id, userId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// --- Tests --------------------------------------------------------------

describe('Large attachment → pointer block (integration, Task 11 Step 4)', () => {
  it(
    'an attachment whose extracted text exceeds the inline threshold lands as a pointer block from the live DB',
    async () => {
      // 30KB pasted-text. The inline threshold is 8KB (see
      // `src/lib/context/budgets.ts`), so 30KB is comfortably in the
      // pointer-eligible zone and immune to future small threshold
      // tweaks. `createAttachment` writes the row straight to the DB
      // with status='extracted' — no extraction step needed for
      // pasted-text.
      const largeText = 'x'.repeat(30_000);
      const largeAtt = await createAttachment({
        sessionId,
        companyId,
        kind: 'pasted-text',
        filename: `large-${suffix}.md`,
        mimeType: 'text/plain',
        sizeBytes: largeText.length,
        extractedText: largeText,
        status: 'extracted',
      });

      // A second small attachment for the negative branch assertion.
      const smallText = 'y'.repeat(2_000);
      const smallAtt = await createAttachment({
        sessionId,
        companyId,
        kind: 'pasted-text',
        filename: `small-${suffix}.md`,
        mimeType: 'text/plain',
        sizeBytes: smallText.length,
        extractedText: smallText,
        status: 'extracted',
      });

      // Build the user-prompt payload via the live-DB repo. This is
      // the same path the UserPromptSubmit handler runs on every chat
      // turn — so whatever this assertion passes is what the agent
      // actually sees.
      const repo = createDbUserPromptRepo();
      const payload = await buildUserPromptPayload(
        {
          companyId,
          sessionId,
          userMessage: 'summarise what I uploaded',
        },
        repo,
      );

      // Both attachments should show up, identifiable by id. Order is
      // newest-first from `getExtractedAttachmentsForSession` — the
      // small one was inserted second so it lands first; the large
      // one second. Assert by id rather than index to stay robust
      // against ordering tweaks.
      const pointerBlock = payload.blocks.find(
        (b) =>
          (b.kind === 'attachment-pointer' ||
            b.kind === 'attachment-inline') &&
          'attachmentId' in b &&
          b.attachmentId === largeAtt.id,
      );
      expect(pointerBlock).toBeDefined();
      expect(pointerBlock!.kind).toBe('attachment-pointer');
      // The user-facing question that prompts the agent to ask about
      // source-doc promotion vs section-walk — stable wording that
      // lives in `renderPointer` inside `user-prompt.ts`. Matching on
      // a fragment keeps us robust to minor phrasing changes.
      expect(pointerBlock!.body).toMatch(/source document/i);
      expect(pointerBlock!.body).toMatch(/section by section/i);
      // Pointer form should NOT inline the full text. Sanity-check
      // that the 30KB body isn't dumped in the block body.
      expect(pointerBlock!.body.length).toBeLessThan(largeText.length);

      // Negative branch — the 2KB attachment inlines.
      const inlineBlock = payload.blocks.find(
        (b) =>
          (b.kind === 'attachment-pointer' ||
            b.kind === 'attachment-inline') &&
          'attachmentId' in b &&
          b.attachmentId === smallAtt.id,
      );
      expect(inlineBlock).toBeDefined();
      expect(inlineBlock!.kind).toBe('attachment-inline');
      // Inline body carries the raw extracted text verbatim.
      expect(inlineBlock!.body).toBe(smallText);
    },
    60_000,
  );
});
