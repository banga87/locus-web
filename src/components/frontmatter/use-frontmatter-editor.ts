'use client';

// useFrontmatterEditor — React hook that owns the split/join/save lifecycle
// for a typed document. Lifts the ad-hoc debounce blocks out of
// document-editor.tsx and the (now-folded) skill-detail pages into one module.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import yaml from 'js-yaml';

import {
  splitFrontmatter,
  joinFrontmatter,
  emitSchemaYaml,
} from '@/lib/frontmatter/markdown';
import { getSchema } from '@/lib/frontmatter/schemas';
import type { FrontmatterSchema } from '@/lib/frontmatter/schemas/types';

const DEBOUNCE_MS = 500;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface PanelState {
  schema: FrontmatterSchema | null;
  /** Validated value when mode='fields'. May be empty object when mode='raw'. */
  value: Record<string, unknown>;
  rawYaml: string | null;
  mode: 'fields' | 'raw';
  error: string | null;
}

interface Params {
  documentId: string;
  initialContent: string;
  docType: string | null;
  canEdit: boolean;
}

export function useFrontmatterEditor(params: Params) {
  const { documentId, initialContent, docType, canEdit } = params;
  const schema = useMemo(() => getSchema(docType), [docType]);

  const split = useMemo(() => splitFrontmatter(initialContent), [initialContent]);

  const initialPanel = useMemo<PanelState>(
    () => initialPanelState(split.frontmatterText, schema),
    [split.frontmatterText, schema],
  );

  const [panelState, setPanelState] = useState<PanelState>(initialPanel);
  const panelRef = useRef(panelState);
  panelRef.current = panelState;

  const initialHtml = useMemo(
    () => marked.parse(split.body, { async: false }) as string,
    [split.body],
  );
  const latestBodyHtml = useRef(initialHtml);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pending = useRef<Record<string, unknown>>({});
  const dirtyContent = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const body = { ...pending.current };
    pending.current = {};
    timer.current = null;

    if (dirtyContent.current) {
      const bodyMd = turndown.turndown(latestBodyHtml.current);
      const panel = panelRef.current;
      const content = buildContent(panel, bodyMd);
      body.content = content;
      dirtyContent.current = false;
    }

    if (Object.keys(body).length === 0) return;

    setSaveState('saving');
    try {
      const res = await fetch(`/api/brain/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState('saved');
    } catch (err) {
      console.error('[useFrontmatterEditor] save failed', err);
      setSaveState('error');
    }
  }, [documentId]);

  const schedule = useCallback(
    (patch: Record<string, unknown>, touchContent: boolean) => {
      pending.current = { ...pending.current, ...patch };
      if (touchContent) dirtyContent.current = true;
      setSaveState('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  const onPanelChange = useCallback(
    (patch: Record<string, unknown>) => {
      setPanelState((prev) => {
        const next = { ...prev, value: { ...prev.value, ...patch } };
        // Keep panelRef in lock-step with the setState updater so flush-on-unmount
        // (which fires before React's next render) always sees the patched state.
        panelRef.current = next;
        return next;
      });
      schedule({}, /* touchContent */ true);
    },
    [schedule],
  );

  const onRawChange = useCallback(
    (rawYaml: string) => {
      // Attempt to re-parse back into fields silently; leave mode as-is.
      let parsed: Record<string, unknown> = panelRef.current.value;
      let error: string | null = null;
      try {
        const y = yaml.load(rawYaml) as unknown;
        if (schema) {
          const r = schema.validate(y);
          if (r.ok) parsed = r.value;
          else error = r.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
        } else if (y && typeof y === 'object') {
          parsed = y as Record<string, unknown>;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      setPanelState((prev) => {
        const next = { ...prev, rawYaml, value: parsed, error };
        panelRef.current = next;
        return next;
      });
      schedule({}, /* touchContent */ true);
    },
    [schedule, schema],
  );

  /**
   * Switch between fields and raw mode. Calling with mode='raw' while already
   * in raw mode is idempotent for the mode itself, but re-serialises the
   * current `value` into `rawYaml` — callers should not invoke this while the
   * user has unsaved raw-YAML edits.
   */
  const onModeChange = useCallback((mode: 'fields' | 'raw') => {
    setPanelState((prev) => {
      // Moving to raw: serialise current value to YAML so the textarea starts from a clean state.
      const next =
        mode === 'raw' && prev.schema
          ? { ...prev, mode, rawYaml: emitSchemaYaml(prev.value, prev.schema) }
          : { ...prev, mode };
      panelRef.current = next;
      return next;
    });
  }, []);

  const onBodyHtmlChange = useCallback(
    (html: string) => {
      latestBodyHtml.current = html;
      schedule({}, /* touchContent */ true);
    },
    [schedule],
  );

  /** For non-frontmatter fields (title, status, …). */
  const onFieldPatch = useCallback(
    (patch: Record<string, unknown>) => {
      schedule(patch, /* touchContent */ false);
    },
    [schedule],
  );

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    };
  }, [flush]);

  return {
    initialHtml,
    panelState,
    canEdit,
    saveState,
    onPanelChange,
    onRawChange,
    onModeChange,
    onBodyHtmlChange,
    onFieldPatch,
  };
}

// --- helpers -------------------------------------------------------------

function initialPanelState(
  frontmatterText: string | null,
  schema: FrontmatterSchema | null,
): PanelState {
  if (!schema) {
    // `rawYaml: string | null` — preserve null when there was no frontmatter
    // so consumers can distinguish "no frontmatter" from "has raw frontmatter"
    // without a trim() check. `buildContent` guards on trim().length > 0.
    return { schema, value: {}, rawYaml: frontmatterText, mode: 'raw', error: null };
  }

  if (frontmatterText == null) {
    return { schema, value: schema.defaults(), rawYaml: null, mode: 'fields', error: null };
  }

  try {
    const parsed = yaml.load(frontmatterText) as unknown;
    const r = schema.validate(parsed);
    if (r.ok) {
      return { schema, value: r.value, rawYaml: null, mode: 'fields', error: null };
    }
    return {
      schema,
      value: schema.defaults(),
      rawYaml: frontmatterText,
      mode: 'raw',
      error: r.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    };
  } catch (e) {
    return {
      schema,
      value: schema.defaults(),
      rawYaml: frontmatterText,
      mode: 'raw',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildContent(panel: PanelState, bodyMd: string): string {
  if (!panel.schema) {
    // No schema → emit whatever the user typed in raw mode verbatim (if any).
    if (panel.rawYaml && panel.rawYaml.trim().length > 0) {
      return `---\n${panel.rawYaml}\n---\n\n${bodyMd}`;
    }
    return bodyMd;
  }
  if (panel.mode === 'raw' && panel.rawYaml != null) {
    // Raw mode: preserve exact bytes the user typed.
    return `---\n${panel.rawYaml}\n---\n\n${bodyMd}`;
  }
  return joinFrontmatter(panel.value, bodyMd, panel.schema);
}
