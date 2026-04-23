'use client';

// RunButton — triggers POST /api/skills/runs for a triggered skill.
//
// Relocated from src/components/workflows/run-button.tsx during the
// skill/workflow unification. Request field name updated to match the
// new API: `skill_document_id` instead of `workflow_document_id`.
//
// Disables itself while the POST is in flight.
// On 202: navigates to view_url.
// On 400 skill_not_triggerable: shows a toast with the message.
// On 400 missing_mcps: shows a toast listing the missing connections + link.
// On 403 forbidden / no_company: shows a forbidden toast.
// On other errors: shows a generic toast.
//
// Uses the browser native alert() for toasts rather than a toast library,
// since the project has no installed toast primitive (no toast.tsx in ui/).
// This is intentional for v0 — upgrade to a proper toast when the UI lib
// is extended.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

interface Props {
  skillDocumentId: string;
}

type ApiResponse =
  | { run_id: string; view_url: string }
  | { error: 'missing_mcps'; missing: string[] }
  | { error: string; message?: string };

export function RunButton({ skillDocumentId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRun() {
    setPending(true);
    try {
      const res = await fetch('/api/skills/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill_document_id: skillDocumentId }),
      });

      const data = (await res.json()) as ApiResponse;

      if (res.ok && res.status === 202) {
        const ok = data as { run_id: string; view_url: string };
        router.push(ok.view_url);
        return;
      }

      const err = data as { error: string; missing?: string[]; message?: string };

      if (res.status === 400 && err.error === 'missing_mcps') {
        const list = (err.missing ?? []).join(', ');
        // Using window.alert for v0 — no toast library installed.
        // TODO: replace with a proper toast when ui/toast.tsx is added.
        window.alert(
          `Cannot run skill: missing MCP connections.\n\nRequired: ${list}\n\nGo to Settings → MCP Connections to add them.`,
        );
        return;
      }

      if (res.status === 400 && err.error === 'skill_not_triggerable') {
        window.alert(
          err.message ??
            'This skill is not configured as triggerable. Add a `trigger:` block in its frontmatter to make it runnable.',
        );
        return;
      }

      if (res.status === 403) {
        window.alert(
          err.message ?? 'Your role cannot trigger skills.',
        );
        return;
      }

      // 404 (skill_not_found — cross-tenant or deleted), 409 (terminal run
      // state — shouldn't happen from the detail page), or 500.
      window.alert(
        err.message ?? `Unexpected error (${res.status}). Please try again.`,
      );
    } catch (err) {
      console.error('[RunButton] fetch failed', err);
      window.alert('Network error. Please check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => void handleRun()}
    >
      {pending ? 'Starting…' : 'Run'}
    </Button>
  );
}
