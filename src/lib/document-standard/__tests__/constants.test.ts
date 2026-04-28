import { describe, expect, it } from 'vitest';
import {
  FOLDERS,
  FOLDER_DESCRIPTIONS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_DESCRIPTIONS,
  RESERVED_TYPES,
  isStandardType,
  isReservedType,
  SOURCE_PREFIXES,
} from '../constants';

describe('document-standard constants', () => {
  it('lists exactly the seven spec folders', () => {
    expect(FOLDERS).toEqual([
      'company',
      'customers',
      'market',
      'product',
      'marketing',
      'operations',
      'signals',
    ]);
  });

  it('every folder has a description', () => {
    for (const f of FOLDERS) {
      expect(FOLDER_DESCRIPTIONS[f].length).toBeGreaterThan(0);
    }
  });

  it('lists exactly the seven spec document types', () => {
    expect(DOCUMENT_TYPES).toEqual([
      'canonical',
      'decision',
      'note',
      'fact',
      'procedure',
      'entity',
      'artifact',
    ]);
  });

  it('every type has a description', () => {
    for (const t of DOCUMENT_TYPES) {
      expect(DOCUMENT_TYPE_DESCRIPTIONS[t].length).toBeGreaterThan(0);
    }
  });

  it('reserves the existing system types', () => {
    expect(RESERVED_TYPES).toEqual([
      'agent-scaffolding',
      'agent-definition',
      'skill',
    ]);
  });

  it('classifies types correctly', () => {
    expect(isStandardType('canonical')).toBe(true);
    expect(isStandardType('skill')).toBe(false);
    expect(isStandardType('unknown')).toBe(false);
    expect(isReservedType('skill')).toBe(true);
    expect(isReservedType('canonical')).toBe(false);
  });

  it('exposes the two source prefixes', () => {
    expect(SOURCE_PREFIXES).toEqual(['agent:', 'human:']);
  });
});
