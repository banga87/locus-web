// Tests for NewWorkflowForm — focused on the "Run as" agent dropdown
// introduced in Task 6 of the workflow-agent-binding plan.
//
// We use SWRConfig with a fresh Map provider per test (same pattern as
// session-sidebar.test.tsx) so cached values never bleed between cases.
//
// TiptapEditor is a Tiptap wrapper that calls useEditor internally;
// in jsdom it renders nothing useful, so we stub it to a plain textarea.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

// scrollIntoView polyfill for Radix overlays lives in vitest.setup.ts.

// ── Router mock ──────────────────────────────────────────────────────────────
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

// ── TiptapEditor stub ────────────────────────────────────────────────────────
vi.mock('@/components/editor/tiptap-editor', () => ({
  TiptapEditor: ({
    placeholder,
    onUpdate,
  }: {
    placeholder?: string;
    onUpdate?: (html: string) => void;
  }) => (
    <textarea
      data-testid="tiptap-stub"
      placeholder={placeholder}
      onChange={(e) => onUpdate?.(e.target.value)}
    />
  ),
}));

import { NewWorkflowForm } from '@/components/workflows/new-workflow-form';
import type { ManifestFolder } from '@/lib/brain/manifest';

// ── Helpers ──────────────────────────────────────────────────────────────────

const FOLDER: ManifestFolder = {
  id: 'folder-1',
  name: 'General',
  slug: 'general',
  description: null,
  folders: [],
  documents: [],
};

function buildAgentsResponse(
  agents: Array<{ id: string; title: string; slug: string }>,
) {
  return {
    ok: true,
    json: async () => ({ data: { agents } }),
  };
}

function buildDocumentPostResponse(slug = 'my-workflow') {
  return {
    ok: true,
    json: async () => ({ data: { id: 'doc-1', slug } }),
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('NewWorkflowForm — Run as dropdown', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerPush.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderForm(folders: ManifestFolder[] = [FOLDER]) {
    return render(
      // Fresh SWR cache per test — no cross-test bleed.
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NewWorkflowForm folders={folders} />
      </SWRConfig>,
    );
  }

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it('renders "Run as" select with Platform agent default when agents list is empty', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents') return buildAgentsResponse([]);
      return buildDocumentPostResponse();
    });

    renderForm();

    // The label should be visible immediately.
    expect(screen.getByText('Run as')).toBeInTheDocument();

    // Wait for the SWR fetch to resolve. The SelectTrigger renders the
    // selected value label in a [data-slot="select-value"] span.
    // "Platform agent (unrestricted)" appears at least once in the trigger.
    await waitFor(() => {
      const matches = screen.getAllByText('Platform agent (unrestricted)');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it('renders one option per agent returned by /api/agents', async () => {
    const agents = [
      { id: 'a1', title: 'Support Agent', slug: 'support-agent' },
      { id: 'a2', title: 'Research Agent', slug: 'research-agent' },
    ];

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents') return buildAgentsResponse(agents);
      return buildDocumentPostResponse();
    });

    renderForm();

    // Open the Run as trigger. The label is wired via htmlFor/id so the
    // combobox's accessible name is "Run as" — role+name scoping avoids
    // positional lookups.
    //
    // fireEvent.click (not pointerDown) because: Radix Select's
    // pointerDown handler only calls handleOpen when
    // event.pointerType === "mouse", but jsdom's synthetic PointerEvent
    // doesn't flip Radix's internal pointerTypeRef. Its click fallback
    // opens when pointerTypeRef !== "mouse", which is the default in
    // jsdom — so click is the pragmatic open trigger here.
    //
    // Wait for the agents fetch to resolve so the trigger is no longer
    // disabled (the component sets disabled={agentsLoading}).
    const runAsTrigger = screen.getByRole('combobox', { name: 'Run as' });
    await waitFor(() => {
      expect(runAsTrigger).not.toBeDisabled();
    });
    fireEvent.click(runAsTrigger);

    // Wait for agent options to appear in the listbox.
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Support Agent' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('option', { name: 'Research Agent' }),
    ).toBeInTheDocument();
    // Platform agent must also be present.
    expect(
      screen.getByRole('option', { name: 'Platform agent (unrestricted)' }),
    ).toBeInTheDocument();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it('omits `agent` from frontmatter when no agent is selected (default)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents') return buildAgentsResponse([]);
      if (url === '/api/brain/documents') return buildDocumentPostResponse();
      throw new Error(`Unmocked fetch: ${url}`);
    });

    renderForm();

    // Fill in a title so the form passes validation.
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'My Workflow' },
    });

    // Submit — no agent selection change, so default (__platform__) applies.
    fireEvent.click(screen.getByRole('button', { name: 'Create & edit' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      const postCall = calls.find(
        ([url, init]) =>
          url === '/api/brain/documents' && init?.method === 'POST',
      );
      expect(postCall).toBeDefined();

      const body = JSON.parse(postCall![1].body as string) as {
        content: string;
      };

      // Schema default emits `agent: null` — the platform agent sentinel
      // maps to no override, so the YAML line must read "agent: null".
      expect(body.content).toMatch(/^agent: null$/m);
    });
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it('includes the selected agent slug in frontmatter when an agent is chosen', async () => {
    const agents = [
      { id: 'a1', title: 'Support Agent', slug: 'support-agent' },
    ];

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents') return buildAgentsResponse(agents);
      if (url === '/api/brain/documents') return buildDocumentPostResponse();
      throw new Error(`Unmocked fetch: ${url}`);
    });

    renderForm();

    // Open the Run as trigger via its accessible name (sourced from the
    // associated <Label htmlFor="wf-run-as">). See test 2 for the
    // rationale on fireEvent.click vs pointerDown in jsdom. Wait for the
    // SWR fetch to resolve so the trigger is no longer disabled.
    const runAsTrigger = screen.getByRole('combobox', { name: 'Run as' });
    await waitFor(() => {
      expect(runAsTrigger).not.toBeDisabled();
    });
    fireEvent.click(runAsTrigger);

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Support Agent' }),
      ).toBeInTheDocument();
    });

    // Click the option to select it.
    fireEvent.click(screen.getByRole('option', { name: 'Support Agent' }));

    // Fill in a title and submit.
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'My Workflow' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create & edit' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      const postCall = calls.find(
        ([url, init]) =>
          url === '/api/brain/documents' && init?.method === 'POST',
      );
      expect(postCall).toBeDefined();

      const body = JSON.parse(postCall![1].body as string) as {
        content: string;
      };

      // The YAML line must carry the chosen slug.
      expect(body.content).toMatch(/^agent: support-agent$/m);
    });
  });
});
