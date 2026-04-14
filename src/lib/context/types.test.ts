import { describe, it, expect } from 'vitest';
import type { InjectedContext, ContextBlock } from './types';

describe('InjectedContext shape', () => {
  it('carries an ordered list of named content blocks', () => {
    const payload: InjectedContext = {
      blocks: [
        { kind: 'scaffolding', title: 'Company scaffolding', body: 'hello' },
        { kind: 'baseline', title: 'Brand voice', body: 'friendly' },
      ],
    };
    expect(payload.blocks).toHaveLength(2);
    expect(payload.blocks[0].kind).toBe('scaffolding');
  });

  it('accepts skill and attachment block kinds', () => {
    const block: ContextBlock = { kind: 'skill', title: 'Draft a Landing Page', body: 'x', skillId: 'c9f5e4a6-...' };
    expect(block.kind).toBe('skill');
  });
});
