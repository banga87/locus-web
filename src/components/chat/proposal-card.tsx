'use client';

// Proposal card — the user-gated approval surface for agent writes.
//
// Rendered by `tool-call-indicator.tsx` when a tool-result payload
// carries `isProposal: true` and its tool name starts with
// `propose_document_`. Two variants, discriminated on `proposal.kind`:
//
//   - `create` → user approves → POST /api/brain/documents
//   - `update` → user approves → PATCH /api/brain/documents/[id]
//
// Discard is purely client-side — no network call, just fires the
// `onDiscard` callback so the parent can dismiss.
//
// Design scope (plan wording, "pragmatic MVP visual stub"):
//   - Clear header + rationale + minimal preview.
//   - Approve / Discard buttons.
//   - Error display inline on HTTP error; success state briefly
//     before the parent dismisses.
//   - Styling uses existing shadcn primitives (Card, Button) so the
//     visual language matches the rest of the chat UI. No bespoke
//     design system invented here.
//
// Attachment wiring: when the proposal originated from a session
// attachment (agent's `propose_document_create` referenced an extracted
// file), the parent forwards `attachmentId` here. The approve handler
// includes it in the Brain CRUD POST/PATCH body; the server then
// transitions the attachment to `committed` and sets
// `committed_doc_id` on success. See `/api/brain/documents/route.ts`.
//
// Slug + category resolution: the POST endpoint requires a `slug`
// (kebab-case) and a `categoryId` (UUID). The agent-generated
// proposal carries a `category` slug and a `title` — so we
//   1. derive a document slug from the title (lowercase, hyphen-
//      separated, alphanumerics only),
//   2. GET /api/brain/categories and match the proposed `category`
//      slug to its id.
// If the category doesn't exist in the brain, we surface the error
// inline so the user can either rename the category or edit the
// category list manually before retrying. This is deliberately a
// v0 flow — a nicer UX (suggest nearby categories, allow inline
// creation) is a Phase 2 follow-up.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Create-variant payload — mirrors the `proposeDocumentCreateTool` output. */
export interface CreateProposal {
  kind: 'create';
  category: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body_markdown: string;
  rationale: string;
}

/** Update-variant payload — mirrors the `proposeDocumentUpdateTool` output. */
export interface UpdateProposal {
  kind: 'update';
  target_doc_id: string;
  frontmatter_patch?: Record<string, unknown>;
  body_patch?: string;
  rationale: string;
}

/** Tagged union — the card renders either variant from this prop. */
export type Proposal = CreateProposal | UpdateProposal;

interface ProposalCardProps {
  proposal: Proposal;
  /**
   * When the proposal originated from an extracted attachment, the
   * parent passes its id through here so the approval write can link
   * the new/updated doc back to its session_attachment row. Task 8
   * wires the actual status update; today the prop is accepted +
   * forwarded into the fetch body but not yet consumed server-side.
   */
  attachmentId?: string;
  /** Called after a 2xx response from the Brain CRUD endpoint. */
  onApprove?: () => void;
  /** Called when the user clicks Discard; no network call is made. */
  onDiscard?: () => void;
}

type ActionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export function ProposalCard({
  proposal,
  attachmentId,
  onApprove,
  onDiscard,
}: ProposalCardProps) {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });

  const handleApprove = async () => {
    setState({ kind: 'submitting' });
    try {
      const response =
        proposal.kind === 'create'
          ? await submitCreate(proposal, attachmentId)
          : await submitUpdate(proposal, attachmentId);

      if (!response.ok) {
        const message = await readErrorMessage(response);
        setState({ kind: 'error', message });
        return;
      }
      setState({ kind: 'success' });
      onApprove?.();
    } catch (err) {
      // Network-level failure — typed as `unknown`, so we stringify.
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  };

  const handleDiscard = () => {
    onDiscard?.();
  };

  const isCreate = proposal.kind === 'create';

  return (
    <Card
      size="sm"
      className="border-primary/20"
      data-testid="proposal-card"
      data-kind={proposal.kind}
    >
      <CardHeader>
        <CardTitle>
          {isCreate
            ? 'Agent proposes a new document'
            : 'Agent proposes an update'}
        </CardTitle>
        <CardDescription>{proposal.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {isCreate ? (
          <CreatePreview proposal={proposal} />
        ) : (
          <UpdatePreview proposal={proposal} />
        )}
        {state.kind === 'error' ? (
          <p
            role="alert"
            className="text-destructive"
            data-testid="proposal-error"
          >
            {state.message}
          </p>
        ) : null}
        {state.kind === 'success' ? (
          <p className="text-muted-foreground" data-testid="proposal-success">
            Filed.
          </p>
        ) : null}
      </CardContent>
      <CardFooter
        className={cn(
          'flex items-center justify-end gap-2 border-t-0 bg-transparent p-3',
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDiscard}
          disabled={state.kind === 'submitting' || state.kind === 'success'}
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={state.kind === 'submitting' || state.kind === 'success'}
          data-testid="proposal-approve"
        >
          {state.kind === 'submitting' ? 'Filing…' : 'Approve'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Preview sub-components
// ---------------------------------------------------------------------------

function CreatePreview({ proposal }: { proposal: CreateProposal }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">Title</dt>
      <dd className="font-medium text-foreground">{proposal.title}</dd>
      <dt className="text-muted-foreground">Category</dt>
      <dd className="font-mono text-foreground">{proposal.category}</dd>
      <dt className="text-muted-foreground">Type</dt>
      <dd className="font-mono text-foreground">{proposal.type}</dd>
    </dl>
  );
}

function UpdatePreview({ proposal }: { proposal: UpdateProposal }) {
  const hasBody =
    typeof proposal.body_patch === 'string' && proposal.body_patch.length > 0;
  return (
    <div className="space-y-1">
      <p>
        <span className="text-muted-foreground">Document:</span>{' '}
        <span className="font-mono text-foreground">
          {proposal.target_doc_id}
        </span>
      </p>
      {hasBody ? (
        <p className="line-clamp-4 whitespace-pre-wrap rounded bg-muted/40 p-2 text-muted-foreground">
          {proposal.body_patch}
        </p>
      ) : (
        <p className="text-muted-foreground">Frontmatter-only update.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network helpers — thin wrappers around the Brain CRUD endpoints.
// ---------------------------------------------------------------------------

/** Slugify a title — lowercase, non-alphanumerics → single hyphens. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function submitCreate(
  proposal: CreateProposal,
  attachmentId?: string,
): Promise<Response> {
  // Resolve the category slug → categoryId the CRUD endpoint expects.
  // GET /api/brain/categories returns the list for the caller's brain;
  // we pick the matching slug or throw a "category not found" error
  // the outer handler surfaces inline.
  //
  // GET /api/brain/categories is re-fetched per approve click. Acceptable
  // while proposals are rare; revisit caching when Task 8 ships bulk ingestion.
  const catResponse = await fetch('/api/brain/categories', {
    credentials: 'include',
  });
  if (!catResponse.ok) {
    throw new Error('Could not load categories.');
  }
  // Response shape: { data: Category[] } per `success()` in response.ts.
  const catPayload = (await catResponse.json()) as {
    data?: Array<{ id: string; slug: string }>;
  };
  const categories = catPayload.data ?? [];
  const match = categories.find((c) => c.slug === proposal.category);
  if (!match) {
    throw new Error(
      `Category "${proposal.category}" does not exist in your brain. Create it first, then retry.`,
    );
  }

  return fetch('/api/brain/documents', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: proposal.title,
      slug: slugify(proposal.title),
      content: proposal.body_markdown,
      categoryId: match.id,
      // Forwards to `/api/brain/documents` POST. When present the
      // server calls `markCommitted(attachmentId, newDocId)` after
      // insert. A mismatched company is a 400 — caught inline by the
      // error path above.
      attachmentId,
    }),
  });
}

async function submitUpdate(
  proposal: UpdateProposal,
  attachmentId?: string,
): Promise<Response> {
  // PATCH only carries the fields the user can change. The propose
  // tool's `body_patch` maps straight to `content` on the CRUD
  // endpoint.
  //
  // TODO(Phase 2): forward `proposal.frontmatter_patch` once the
  // server-side PATCH schema grows real frontmatter-merge handling.
  // Today we deliberately do NOT include it in the body — the server
  // rejects unknown keys with a 400 via the route's `.strict()` zod
  // schema, so sending an unhandled field would fail the whole update.
  // The rendered `UpdatePreview` still shows the proposed frontmatter
  // changes so the user knows what was proposed; they just won't be
  // applied yet. See `src/app/api/brain/documents/[id]/route.ts`
  // for the paired server-side guard.
  const body: Record<string, unknown> = {};
  if (typeof proposal.body_patch === 'string') {
    body.content = proposal.body_patch;
  }
  // Forwards to `/api/brain/documents/[id]` PATCH. See the paired
  // note in `submitCreate` for the server-side contract.
  if (attachmentId) {
    body.attachmentId = attachmentId;
  }

  return fetch(`/api/brain/documents/${proposal.target_doc_id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Extract a user-facing error message from a non-2xx Brain CRUD
 * response. The `error()` helper shapes every error as
 * `{ error: { code, message, details? } }`. We pluck `.error.message`
 * when present, otherwise fall back to the status line.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    if (payload?.error?.message) return payload.error.message;
  } catch {
    /* fall through */
  }
  return `${response.status} ${response.statusText || 'Request failed'}`;
}
