// src/lib/frontmatter/schemas/workflow.ts
//
// Wraps the existing `validateWorkflowFrontmatter` (narrow-typed) behind
// the generic FrontmatterSchema contract. The wrapper injects `type:
// 'workflow'` before calling the inner validator because the validator
// enforces it; the panel doesn't surface `type` as an editable field.

import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';
import type { FrontmatterSchema } from './types';

export const workflowSchema: FrontmatterSchema = {
  type: 'workflow',
  label: 'Workflow',
  fields: [
    {
      kind: 'enum',
      name: 'output',
      label: 'Output',
      options: ['document', 'message', 'both'] as const,
      required: true,
    },
    {
      kind: 'nullable-string',
      name: 'output_category',
      label: 'Category',
      placeholder: 'Folder slug or leave empty',
    },
    {
      kind: 'string-array',
      name: 'requires_mcps',
      label: 'Required MCPs',
      itemLabel: 'MCP slug',
    },
    {
      kind: 'nullable-string',
      name: 'agent',
      label: 'Run as',
      placeholder: 'platform-agent',
    },
    {
      kind: 'nullable-string',
      name: 'schedule',
      label: 'Schedule (cron)',
      placeholder: 'Reserved — manual only',
    },
  ],
  defaults: () => ({
    output: 'document',
    output_category: null,
    requires_mcps: [],
    agent: null,
    schedule: null,
  }),
  validate: (input) => {
    if (typeof input !== 'object' || input === null) {
      return { ok: false, errors: [{ field: 'input', message: 'must be an object' }] };
    }
    const r = validateWorkflowFrontmatter({ type: 'workflow', ...(input as Record<string, unknown>) });
    if (!r.ok) return { ok: false, errors: r.errors };
    return {
      ok: true,
      value: {
        output: r.value.output,
        output_category: r.value.output_category,
        requires_mcps: r.value.requires_mcps,
        agent: r.value.agent,
        schedule: r.value.schedule,
      },
    };
  },
};
