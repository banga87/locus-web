import { describe, it, expect } from 'vitest';
import {
  bodiesEquivalent,
  isCorruptedWorkflowDoc,
  extractWorkflowFromVersion1,
  stripCorruptionPreamble,
} from '../lib/repair-frontmatter';

describe('bodiesEquivalent', () => {
  it('treats whitespace-only differences as equal', () => {
    expect(bodiesEquivalent('Hello\n\nworld\n', '  Hello\n  world  \n')).toBe(true);
  });
  it('rejects real content differences', () => {
    expect(bodiesEquivalent('Hello\n', 'Goodbye\n')).toBe(false);
  });
});

describe('isCorruptedWorkflowDoc', () => {
  it('detects the canonical corruption shape', () => {
    expect(
      isCorruptedWorkflowDoc({
        type: null,
        metadata: { requires_mcps: [], output: 'document' },
      }),
    ).toBe(true);
  });
  it('ignores healthy workflow docs', () => {
    expect(
      isCorruptedWorkflowDoc({
        type: 'workflow',
        metadata: { requires_mcps: [], output: 'document' },
      }),
    ).toBe(false);
  });
  it('ignores plain untyped docs', () => {
    expect(isCorruptedWorkflowDoc({ type: null, metadata: {} })).toBe(false);
  });
});

describe('extractWorkflowFromVersion1', () => {
  it('returns the v1 content and parsed frontmatter when valid', () => {
    const v1 =
      '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody.\n';
    const got = extractWorkflowFromVersion1(v1);
    expect(got).not.toBeNull();
    expect(got!.type).toBe('workflow');
    expect(got!.metadata.output).toBe('document');
    expect(got!.body).toBe('Body.\n');
  });
  it('returns null when v1 has no frontmatter', () => {
    expect(extractWorkflowFromVersion1('# heading\n')).toBeNull();
  });
  it('returns null when v1 frontmatter is not a workflow', () => {
    expect(
      extractWorkflowFromVersion1('---\ntype: skill\n---\n\nBody\n'),
    ).toBeNull();
  });
});

describe('stripCorruptionPreamble', () => {
  it('strips the canonical corruption preamble', () => {
    const corrupted =
      '* * *\n\n## type: workflow output: document output\\_category: null requires\\_mcps: \\[\\] schedule: null\n\nReal body.\n';
    expect(stripCorruptionPreamble(corrupted)).toBe('Real body.\n');
  });

  it('returns null when content starts with a clean frontmatter fence', () => {
    expect(
      stripCorruptionPreamble(
        '---\ntype: workflow\noutput: document\n---\n\nBody\n',
      ),
    ).toBeNull();
  });

  it('returns null when content starts with something else entirely', () => {
    expect(stripCorruptionPreamble('# Heading\n\nProse.\n')).toBeNull();
  });

  it('returns null when `## type: workflow` is present but not after `* * *`', () => {
    expect(
      stripCorruptionPreamble('## type: workflow output: document\n\nBody\n'),
    ).toBeNull();
  });
});
