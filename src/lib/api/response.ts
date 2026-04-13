// Canonical API response envelopes. See design doc 13-api-design.md §2.1.
//
// Every route handler should return one of success/created/error/paginated
// rather than building NextResponse.json directly, so the envelope shape
// stays consistent across the product.

import { NextResponse } from 'next/server';

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T) {
  return success(data, 201);
}

export function error(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status },
  );
}

export function paginated<T>(
  data: T[],
  nextCursor: string | null,
  total?: number,
) {
  return NextResponse.json({
    success: true,
    data,
    pagination: { nextCursor, total },
  });
}
