// Tool-call indicator state-transition tests. We render under jsdom
// (configured globally in vitest.setup.ts) and assert on the rendered
// output for each indicator state — pending / complete / error.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ToolCallIndicator } from '@/components/chat/tool-call-indicator';

describe('ToolCallIndicator', () => {
  it('renders a pending row with the verb-form name', () => {
    render(
      <ToolCallIndicator
        toolName="get_document"
        args={{ path: 'brand/voice' }}
        state="pending"
      />,
    );
    // The trailing ellipsis lives in the same span as the label, so we
    // assert by partial text rather than exact match.
    expect(screen.getByText(/Reading Brand Voice/)).toBeInTheDocument();
  });

  it('renders a "Used:" pill on complete', () => {
    render(
      <ToolCallIndicator
        toolName="search_documents"
        args={{ query: 'voice' }}
        state="complete"
      />,
    );
    expect(screen.getByText(/Used:/)).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('renders a muted "Couldn\'t access" pill on error', () => {
    render(
      <ToolCallIndicator
        toolName="get_document"
        args={{ path: 'missing/path' }}
        state="error"
        errorText="document_not_found"
      />,
    );
    expect(
      screen.getByText(/Couldn't access Missing Path/),
    ).toBeInTheDocument();
  });

  it('humanises external MCP tool names from ext_<hex>_<name>', () => {
    render(
      <ToolCallIndicator
        toolName="ext_001122334455_send_email"
        args={{ to: 'a@b.com' }}
        state="pending"
      />,
    );
    expect(screen.getByText(/Using Send Email/)).toBeInTheDocument();
  });
});
