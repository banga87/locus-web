// Opaque cursor codec for list endpoints. See design doc 13-api-design.md §2.2.
//
// The cursor contents are an implementation detail of each endpoint — typically
// `{ id, createdAt }` of the last row on the previous page. base64url keeps
// the cursor URL-safe without any percent-encoding.

export function encodeCursor(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
}
