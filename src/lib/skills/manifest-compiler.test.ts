// Unit tests for the skill manifest compiler. Pure logic — no DB.
//
// Cases per the Phase 1.5 plan:
//   1. Happy path — a well-formed skill doc compiles to a single manifest
//      entry with all trigger fields parsed.
//   2. Diagnostic path — a skill doc missing the `triggers` block (or with
//      otherwise unusable frontmatter) is rejected without throwing, and a
//      diagnostic is appended to the manifest.
//   3. YAML-throw path — a skill doc whose frontmatter is malformed enough
//      to make `yaml.load` throw is caught, skipped, and folded into the
//      same "missing or invalid frontmatter" diagnostic bucket as case 2.

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

  it('skips skill docs whose frontmatter YAML fails to parse and logs diagnostic', () => {
    // Unterminated double-quoted scalar — `yaml.load` throws on this
    // (verified manually via js-yaml REPL). The compiler must catch the
    // throw, drop the skill, and emit the same diagnostic reason as the
    // no-frontmatter case so the dashboard can bucket them together.
    const malformed = `---\ntype: skill\ntriggers:\n  phrases: ["unterminated\n---\nbody`;
    const manifest = compileSkillDocs([
      { id: 'yaml-throw-1', companyId: 'co-1', title: 'Malformed', content: malformed },
    ]);
    expect(manifest.skills).toHaveLength(0);
    expect(manifest.diagnostics).toHaveLength(1);
    expect(manifest.diagnostics[0].docId).toBe('yaml-throw-1');
    expect(manifest.diagnostics[0].reason).toBe('missing or invalid frontmatter');
  });
});
