'use client';

// FrontmatterPanel — schema-aware editor for a document's YAML frontmatter.
//
// Two modes:
//   - 'fields': typed form controls from schema.fields
//   - 'raw': plain YAML textarea (escape hatch; also used when ingress
//     parsing fails or the doc type has no registered schema)
//
// Stateless. Caller (useFrontmatterEditor) owns mode + value + rawYaml
// and wires onFieldsChange/onRawChange/onModeChange to scheduled saves.

import { Icon } from '@/components/tatara';
import type { FrontmatterSchema, FrontmatterField } from '@/lib/frontmatter/schemas/types';

interface Props {
  schema: FrontmatterSchema | null;
  value: Record<string, unknown>;
  rawYaml: string | null;
  mode: 'fields' | 'raw';
  canEdit: boolean;
  /** Partial merge into `value`. */
  onFieldsChange: (patch: Record<string, unknown>) => void;
  onRawChange: (yaml: string) => void;
  onModeChange: (mode: 'fields' | 'raw') => void;
  error: string | null;
}

export function FrontmatterPanel({
  schema,
  value,
  rawYaml,
  mode,
  canEdit,
  onFieldsChange,
  onRawChange,
  onModeChange,
  error,
}: Props) {
  const effectiveMode: 'fields' | 'raw' = schema ? mode : 'raw';

  return (
    <aside className="w-full space-y-4 rounded-lg border border-border bg-card p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {schema?.label ?? 'Frontmatter'}
        </h2>
        {schema && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => onModeChange(effectiveMode === 'fields' ? 'raw' : 'fields')}
            disabled={!canEdit}
          >
            {effectiveMode === 'fields' ? 'View raw YAML' : 'View fields'}
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {effectiveMode === 'fields' && schema ? (
        <FieldsForm schema={schema} value={value} canEdit={canEdit} onChange={onFieldsChange} />
      ) : (
        <RawEditor rawYaml={rawYaml ?? ''} canEdit={canEdit} onChange={onRawChange} />
      )}
    </aside>
  );
}

function FieldsForm({
  schema,
  value,
  canEdit,
  onChange,
}: {
  schema: FrontmatterSchema;
  value: Record<string, unknown>;
  canEdit: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {schema.fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={value[field.name]}
          canEdit={canEdit}
          onChange={(v) => onChange({ [field.name]: v })}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  canEdit,
  onChange,
}: {
  field: FrontmatterField;
  value: unknown;
  canEdit: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `fm-${field.name}`;
  const label = (
    <label htmlFor={id} className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
      {field.label}
    </label>
  );

  switch (field.kind) {
    case 'enum': {
      return (
        <div>
          {label}
          <select
            id={id}
            value={(value as string) ?? ''}
            disabled={!canEdit}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case 'string':
    case 'nullable-string': {
      const str = value == null ? '' : String(value);
      return (
        <div>
          {label}
          <input
            id={id}
            type="text"
            value={str}
            disabled={!canEdit}
            placeholder={field.placeholder ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              const trimmed = next.trim();
              onChange(field.kind === 'nullable-string' && trimmed === '' ? null : next);
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
      );
    }
    case 'string-array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const labelId = `${id}-label`;
      return (
        <div>
          <span
            id={labelId}
            className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground"
          >
            {field.label}
          </span>
          <div role="group" aria-labelledby={labelId}>
            <StringArrayEditor
              id={id}
              items={arr}
              canEdit={canEdit}
              itemLabel={field.itemLabel ?? 'item'}
              onChange={onChange}
            />
          </div>
        </div>
      );
    }
  }
}

function StringArrayEditor({
  id,
  items,
  canEdit,
  itemLabel,
  onChange,
}: {
  id: string;
  items: string[];
  canEdit: boolean;
  itemLabel: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div id={id} className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            aria-label={`${itemLabel} ${i + 1}`}
            value={item}
            disabled={!canEdit}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="px-2 text-xs text-muted-foreground hover:text-ink"
            aria-label="Remove"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onChange([...items, ''])}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        + Add {itemLabel}
      </button>
    </div>
  );
}

function RawEditor({
  rawYaml,
  canEdit,
  onChange,
}: {
  rawYaml: string;
  canEdit: boolean;
  onChange: (yaml: string) => void;
}) {
  return (
    <textarea
      aria-label="Raw YAML"
      value={rawYaml}
      disabled={!canEdit}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={Math.max(6, rawYaml.split('\n').length)}
      className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
    />
  );
}
