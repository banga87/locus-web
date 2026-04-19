// Unit tests for the tool-name humanisation helpers. Pure functions —
// no JSX, no jsdom needed.

import { describe, expect, it } from 'vitest';

import {
  displayToolName,
  pillToolName,
} from '@/components/chat/tool-display-names';

describe('displayToolName', () => {
  it('uses a verb-form sentence for search_documents', () => {
    expect(displayToolName('search_documents', { query: 'voice' })).toBe(
      'Searching brain',
    );
  });

  it('extracts a friendly label from get_document path arg', () => {
    expect(displayToolName('get_document', { path: 'brand/voice' })).toBe(
      'Reading Brand Voice',
    );
    expect(
      displayToolName('get_document', { path: 'products/launch-plan' }),
    ).toBe('Reading Products Launch Plan');
  });

  it('falls back to a generic label when get_document has no path', () => {
    expect(displayToolName('get_document', { id: 'uuid-here' })).toBe(
      'Reading document',
    );
  });

  it('handles get_document_diff and get_diff_history', () => {
    expect(displayToolName('get_document_diff', {})).toBe(
      'Comparing document versions',
    );
    expect(displayToolName('get_diff_history', {})).toBe(
      'Checking edit history',
    );
  });

  it('strips the ext_<hex>_ prefix from external MCP tools', () => {
    expect(
      displayToolName('ext_abc123def456_send_email', { to: 'a@b.com' }),
    ).toBe('Using Send Email');
  });

  it('falls back to a humanised raw name for anything else', () => {
    expect(displayToolName('mystery_tool', {})).toBe('Using Mystery Tool');
  });

  it('tolerates null/undefined args without crashing', () => {
    expect(displayToolName('get_document', null)).toBe('Reading document');
    expect(displayToolName('search_documents', undefined)).toBe(
      'Searching brain',
    );
  });

  it('renders a truncated skill_id fallback for load_skill', () => {
    const result = displayToolName('load_skill', { skill_id: 'abc12345-1234-1234-1234-123456789abc' });
    expect(result).toBe('Loading skill (abc12345…)');
  });

  it('renders generic fallback for load_skill with no skill_id', () => {
    expect(displayToolName('load_skill', {})).toBe('Loading skill (skill)');
  });

  it('renders a truncated skill_id + path fallback for read_skill_file', () => {
    const result = displayToolName('read_skill_file', {
      skill_id: 'abc12345-1234-1234-1234-123456789abc',
      relative_path: 'references/foo.md',
    });
    expect(result).toBe('Reading skill file (abc12345…) › references/foo.md');
  });

  it('renders generic fallback for read_skill_file with no args', () => {
    expect(displayToolName('read_skill_file', {})).toBe(
      'Reading skill file (skill) › file',
    );
  });
});

describe('pillToolName', () => {
  it('returns short labels for the brain tools', () => {
    expect(pillToolName('search_documents', {})).toBe('Search');
    expect(pillToolName('get_document', { path: 'brand/voice' })).toBe(
      'Brand Voice',
    );
    expect(pillToolName('get_document', {})).toBe('Document');
    expect(pillToolName('get_document_diff', {})).toBe('Diff');
    expect(pillToolName('get_diff_history', {})).toBe('Edit history');
  });

  it('strips ext_<hex>_ for MCP external tools', () => {
    expect(pillToolName('ext_001122334455_create_issue', {})).toBe(
      'Create Issue',
    );
  });

  it('humanises unknown internal tools', () => {
    expect(pillToolName('do_thing', {})).toBe('Do Thing');
  });

  it('returns truncated skill_id label for load_skill', () => {
    expect(
      pillToolName('load_skill', { skill_id: 'abc12345-1234-1234-1234-123456789abc' }),
    ).toBe('Skill (abc12345…)');
  });

  it('returns generic pill label for load_skill with no skill_id', () => {
    expect(pillToolName('load_skill', {})).toBe('Skill (skill)');
  });

  it('returns path-based label for read_skill_file', () => {
    expect(
      pillToolName('read_skill_file', {
        skill_id: 'abc12345-1234-1234-1234-123456789abc',
        relative_path: 'references/foo.md',
      }),
    ).toBe('Skill file: references/foo.md');
  });

  it('returns generic label for read_skill_file with no path', () => {
    expect(pillToolName('read_skill_file', { skill_id: 'abc12345' })).toBe(
      'Skill file: file',
    );
  });
});
