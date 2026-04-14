// Unit tests for the skill manifest compiler. Pure logic — no DB.
//
// Two cases per the Phase 1.5 plan:
//   1. Happy path — a well-formed skill doc compiles to a single manifest
//      entry with all trigger fields parsed.
//   2. Diagnostic path — a skill doc missing the `triggers` block (or with
//      otherwise unusable frontmatter) is rejected without throwing, and a
//      diagnostic is appended to the manifest.

import { describe, it, expect } from 'vitest';
import { compileSkillDocs } from './manifest-compiler';

const sampleSkillMarkdown = `---
type: skill
title: Draft a Landing Page
description: Use when the user asks to draft a landing page or hero copy.
triggers:
  phrases:
    - landing page
    - hero section
  allOf:
    - [draft, write]
    - [page, copy]
  anyOf:
    - conversion
    - CTA
  minScore: 3
priority: 5
---

Skill body here.`;

describe('compileSkillDocs', () => {
  it('extracts trigger metadata from skill doc frontmatter', () => {
    const manifest = compileSkillDocs([
      {
        id: 'c9f5e4a6-1',
        companyId: 'co-1',
        title: 'Draft a Landing Page',
        content: sampleSkillMarkdown,
      },
    ]);
    expect(manifest.skills).toHaveLength(1);
    const s = manifest.skills[0];
    expect(s.id).toBe('c9f5e4a6-1');
    expect(s.triggers.phrases).toContain('landing page');
    expect(s.triggers.minScore).toBe(3);
    expect(s.priority).toBe(5);
    expect(s.bodyBytes).toBeGreaterThan(0);
  });

  it('skips skill docs with invalid frontmatter and logs diagnostic', () => {
    const bad = `---\ntype: skill\n---\nno triggers`;
    const manifest = compileSkillDocs([
      { id: 'bad-1', companyId: 'co-1', title: 'Bad', content: bad },
    ]);
    expect(manifest.skills).toHaveLength(0);
    expect(manifest.diagnostics).toHaveLength(1);
    expect(manifest.diagnostics[0].docId).toBe('bad-1');
  });
});
