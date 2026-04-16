// WorkflowFrontmatterFields — read-only display of workflow-specific
// frontmatter fields (output, output_category, requires_mcps, schedule).
//
// v0: READ-ONLY. Editing workflow frontmatter via this panel is deferred.
// The workflow definition lives in the Tiptap body as a YAML frontmatter
// block; the PATCH endpoint's strict schema does not yet support a
// `frontmatterPatch` field (see the NOTE in /api/brain/documents/[id]/route.ts).
// A future task will add a dedicated workflow-frontmatter PATCH endpoint.

import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export interface WorkflowFrontmatterValue {
  output: string;
  output_category: string | null;
  requires_mcps: string[];
  schedule: string | null;
}

interface Props {
  frontmatter: WorkflowFrontmatterValue;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export function WorkflowFrontmatterFields({ frontmatter }: Props) {
  return (
    <aside className="w-full space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Workflow
      </h2>

      <dl className="space-y-4">
        <Field label="Output">
          <Badge variant="secondary">{frontmatter.output}</Badge>
        </Field>

        <Field label="Category">
          {frontmatter.output_category ? (
            <span>{frontmatter.output_category}</span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>

        <Field label="Required MCPs">
          {frontmatter.requires_mcps.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {frontmatter.requires_mcps.map((mcp) => (
                <Badge key={mcp} variant="outline">
                  {mcp}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>

        <Field label="Schedule">
          {frontmatter.schedule ? (
            <code className="rounded bg-secondary px-1 py-0.5 text-xs">
              {frontmatter.schedule}
            </code>
          ) : (
            <span className="text-muted-foreground">Manual only</span>
          )}
        </Field>
      </dl>

      <p className="text-xs text-muted-foreground">
        Edit these fields in the document body.{' '}
        <Link
          href="/settings/mcp-connections"
          className="underline-offset-4 hover:underline"
        >
          Manage MCP connections
        </Link>
      </p>
    </aside>
  );
}
