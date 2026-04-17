import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFrontmatterEditor } from '../use-frontmatter-editor';

const PRISTINE =
  '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody line\n';

describe('useFrontmatterEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('splits content on mount and exposes initial HTML (body-only)', () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );
    expect(result.current.panelState.mode).toBe('fields');
    expect(result.current.panelState.value).toMatchObject({ output: 'document' });
    // Body-only HTML must NOT include the frontmatter text…
    expect(result.current.initialHtml).not.toContain('type: workflow');
    // …and must NOT contain an <hr> (the exact marker of the old-path corruption).
    expect(result.current.initialHtml).not.toMatch(/<hr\b/);
  });

  it('debounces a PATCH with rejoined content on body change', async () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );

    act(() => result.current.onBodyHtmlChange('<p>new body</p>'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/brain/documents/doc-1');
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((init as RequestInit).body as string) as { content: string };
    expect(body.content).toMatch(/^---\ntype: workflow\n[\s\S]+\n---\n\n/);
    expect(body.content).toContain('new body');
  });

  it('coalesces overlapping panel + body changes into one PATCH', async () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );

    act(() => result.current.onPanelChange({ output: 'message' }));
    act(() => result.current.onBodyHtmlChange('<p>hi</p>'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.content).toContain('output: message');
    expect(body.content).toContain('hi');
  });

  it('falls back to raw mode when ingress YAML is invalid', () => {
    const broken = '---\n::: not yaml :::\n---\n\nBody\n';
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: broken,
        docType: 'workflow',
        canEdit: true,
      }),
    );
    expect(result.current.panelState.mode).toBe('raw');
    expect(result.current.panelState.rawYaml).toBe('::: not yaml :::');
    expect(result.current.panelState.error).toBeTruthy();
  });
});
