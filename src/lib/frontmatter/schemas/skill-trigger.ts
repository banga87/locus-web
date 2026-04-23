// src/lib/frontmatter/schemas/skill-trigger.ts
//
// Describes the nested `trigger:` block that marks a skill doc as
// triggerable. The panel uses this to render + edit the four authored
// trigger fields in place.
//
// NOTE on the `type` field below: `'skill-trigger'` is a panel sentinel
// used by the frontmatter schema registry / emitter to identify THIS
// schema. It is NOT a value that appears on `documents.type` — the
// enclosing doc's `documents.type` is always `'skill'`. See
// `docs/superpowers/specs/2026-04-23-skill-workflow-unification-design.md`.
//
// The validator delegates to `validateSkillTrigger` in
// `@/lib/brain/frontmatter`, which enforces the nested-block shape (no
// top-level `type:` check — the trigger block does not carry a type).

import { validateSkillTrigger } from '@/lib/brain/frontmatter';
import type { FrontmatterSchema } from './types';

export const triggerSchema: FrontmatterSchema = {
  type: 'skill-trigger',
  label: 'Trigger',
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
      name: 'schedule',
      label: 'Schedule (cron)',
      placeholder: 'Reserved — manual only',
    },
  ],
  defaults: () => ({
    output: 'document',
    output_category: null,
    requires_mcps: [],
    schedule: null,
  }),
  validate: (input) => {
    const r = validateSkillTrigger(input);
    if (!r.ok) return { ok: false, errors: r.errors };
    return {
      ok: true,
      value: {
        output: r.value.output,
        output_category: r.value.output_category,
        requires_mcps: r.value.requires_mcps,
        schedule: r.value.schedule,
      },
    };
  },
};
