'use client';

// Skill-proposal card — the user-gated approval surface for agent skill creation.
//
// Rendered by `tool-call-indicator.tsx` when a tool-result payload
// carries `isProposal: true` and its tool name is `propose_skill_create`.
//
// Flow:
//   - Agent calls `propose_skill_create` → tool result has `{ isProposal: true, proposal: { kind: 'skill-create', ... } }`
//   - `tool-call-indicator.tsx` detects this and renders <SkillProposalCard>.
//   - User reviews skill name, description, SKILL.md body preview, resource
//     files (each expandable inline), and the agent's rationale.
//   - [Approve] → POST /api/skills/propose/accept → card transitions to success
//     state with a link to the new skill.
//   - [Discard] → client-side dismiss, no network call.
//
// Mirrors the patterns in `proposal-card.tsx`.

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

// ---------------------------------------------------------------------------
// Exported interface (consumed by tool-call-indicator.tsx)
// ---------------------------------------------------------------------------

/** Skill-create proposal payload — mirrors the `proposeSkillCreateTool` output. */
export interface SkillCreateProposal {
  kind: 'skill-create';
  name: string;
  description: string;
  body: string;
  resources: Array<{ relative_path: string; content: string }>;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SkillProposalCardProps {
  proposal: SkillCreateProposal;
  /** Called after a 2xx response from the accept endpoint. */
  onApprove?: () => void;
  /** Called when the user clicks Discard; no network call is made. */
  onDiscard?: () => void;
}

type ActionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; skillId: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillProposalCard({
  proposal,
  onApprove,
  onDiscard,
}: SkillProposalCardProps) {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  const handleApprove = async () => {
    setState({ kind: 'submitting' });
    try {
      const response = await fetch('/api/skills/propose/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Strip `kind` — the server schema validates name/description/body/resources/rationale.
        body: JSON.stringify({
          name: proposal.name,
          description: proposal.description,
          body: proposal.body,
          resources: proposal.resources,
          rationale: proposal.rationale,
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        setState({ kind: 'error', message });
        return;
      }

      const envelope = (await response.json()) as {
        success?: boolean;
        data?: { skill_id?: string };
      };
      const skillId = envelope.data?.skill_id ?? '';
      setState({ kind: 'success', skillId });
      onApprove?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  };

  const handleDiscard = () => {
    setDismissed(true);
    onDiscard?.();
  };

  const isSettled = state.kind === 'success' || state.kind === 'submitting';

  if (dismissed) return null;

  return (
    <Card
      size="sm"
      className="border-primary/20"
      data-testid="skill-proposal-card"
    >
      <CardHeader>
        <CardTitle>Agent proposes a new skill</CardTitle>
        <CardDescription>{proposal.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {/* Skill header info */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium text-foreground">{proposal.name}</dd>
          <dt className="text-muted-foreground">Description</dt>
          <dd className="text-foreground">{proposal.description}</dd>
        </dl>

        {/* SKILL.md body preview */}
        <div className="space-y-1">
          <p className="text-muted-foreground">SKILL.md</p>
          <pre
            className="line-clamp-6 whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-muted-foreground"
            data-testid="skill-body-preview"
          >
            {proposal.body}
          </pre>
        </div>

        {/* Resource files */}
        {proposal.resources.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              Resources ({proposal.resources.length})
            </p>
            <ul className="space-y-1">
              {proposal.resources.map((res, index) => (
                <ResourceRow key={`${index}-${res.relative_path}`} index={index} resource={res} />
              ))}
            </ul>
          </div>
        ) : null}

        {/* Inline feedback */}
        {state.kind === 'error' ? (
          <p
            role="alert"
            className="text-destructive"
            data-testid="skill-proposal-error"
          >
            {state.message}
          </p>
        ) : null}

        {state.kind === 'success' ? (
          <p
            className="text-muted-foreground"
            data-testid="skill-proposal-success"
          >
            Skill created.{' '}
            {state.skillId ? (
              <a
                href={`/skills/${state.skillId}`}
                className="text-primary underline underline-offset-2"
                data-testid="skill-proposal-link"
              >
                View skill
              </a>
            ) : null}
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
          disabled={isSettled}
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={isSettled}
          data-testid="skill-proposal-approve"
        >
          {state.kind === 'submitting' ? 'Creating…' : 'Approve'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resource row — path label + collapsible content
// ---------------------------------------------------------------------------

function ResourceRow({
  index,
  resource,
}: {
  index: number;
  resource: { relative_path: string; content: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = `resource-content-${index}`;

  return (
    <li className="rounded border border-border/50">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="font-mono text-foreground">{resource.relative_path}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-primary hover:underline"
          aria-expanded={expanded}
          aria-controls={contentId}
        >
          {expanded ? 'Hide' : 'View'}
        </button>
      </div>
      {expanded ? (
        <pre
          id={contentId}
          className="whitespace-pre-wrap rounded-b bg-muted/40 p-2 font-mono text-muted-foreground"
          data-testid={contentId}
        >
          {resource.content}
        </pre>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/**
 * Extract a user-facing error message from a non-2xx accept response.
 * The `error()` helper shapes every error as
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
