// src/lib/frontmatter/schemas/types.ts

export type FrontmatterField =
  | { kind: 'string'; name: string; label: string; required?: boolean; placeholder?: string }
  | { kind: 'nullable-string'; name: string; label: string; placeholder?: string }
  | {
      kind: 'enum';
      name: string;
      label: string;
      options: readonly string[];
      required?: boolean;
    }
  | { kind: 'string-array'; name: string; label: string; itemLabel?: string };

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

export interface FrontmatterSchema {
  /** Exact value of the `type` field; uniquely identifies the schema. */
  type: string;
  /** Display name shown in the panel header. */
  label: string;
  /** Ordered field list — drives rendering and emission order. */
  fields: readonly FrontmatterField[];
  /** Default value for a brand-new document of this type. */
  defaults: () => Record<string, unknown>;
  /** Full-shape validator used client + server. */
  validate: (input: unknown) => ValidateResult;
}
