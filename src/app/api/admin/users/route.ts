// Pre-MVP stub: returns just the calling user so the owner dropdown has
// something to render. Phase 1+ will widen this to all active members of
// the caller's company (with `requireRole(ctx, 'admin')` for write paths).

import { withAuth } from '@/lib/api/handler';
import { success } from '@/lib/api/response';

export function GET() {
  return withAuth(async (ctx) => {
    return success([
      {
        id: ctx.userId,
        email: ctx.email,
        fullName: ctx.fullName,
      },
    ]);
  });
}
