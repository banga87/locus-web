import { describe, it, expect } from 'vitest';
import { extractFlags } from '../flags';

describe('extractFlags', () => {
  it('detects flag headers (## DECISION, ## POLICY, ## CORE)', () => {
    const content = '## DECISION\nWe go with GraphQL.\n\n## POLICY\nText.';
    expect(extractFlags(content).sort()).toEqual(['DECISION', 'POLICY'].sort());
  });

  it('detects frontmatter !decision / !core hints (case-insensitive)', () => {
    // Content excludes the frontmatter block; the caller passes raw content.
    // Here we treat the full document body as input.
    const content = '!decision We chose X.\n\nMore text.';
    expect(extractFlags(content)).toEqual(['DECISION']);
  });

  it('deduplicates across heading and hint sources', () => {
    const content = '## DECISION\nWe chose.\n\n!decision also noted';
    expect(extractFlags(content)).toEqual(['DECISION']);
  });

  it('ignores unknown flags', () => {
    expect(extractFlags('## RANDOMFLAG\ntext')).toEqual([]);
  });

  it('returns empty on no match', () => {
    expect(extractFlags('plain text')).toEqual([]);
  });
});
