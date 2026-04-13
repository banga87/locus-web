// Thin helper for route handlers. Wraps the standard
// requireAuth-then-handle pattern so every route doesn't have to repeat
// the try/catch boilerplate.
//
// Usage:
//   export const GET = () => withAuth(async (ctx) => { ... });
//
// ApiAuthError (thrown by requireAuth / requireRole) is translated to the
// envelope. Anything else is logged and returned as 500. Validation errors
// should be raised via `error()` return values, not thrown.

import { requireAuth, type AuthContext } from './auth';
import { ApiAuthError } from './errors';
import { error } from './response';

export async function withAuth(
  handler: (ctx: AuthContext) => Promise<Response>,
): Promise<Response> {
  try {
    const ctx = await requireAuth();
    return await handler(ctx);
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return error(e.code, e.message, e.statusCode);
    }
    console.error('[api] unhandled error:', e);
    return error('internal_error', 'An unexpected error occurred.', 500);
  }
}

// Helper: every brain route needs a companyId. Centralise the 403.
export function requireCompany(ctx: AuthContext): string | Response {
  if (!ctx.companyId) {
    return error('no_company', 'Complete setup first.', 403);
  }
  return ctx.companyId;
}
