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
});
