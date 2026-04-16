// Access-control helper for workflow run routes.
//
// Three rules, applied in order:
//   1. Tenant isolation  — the caller's companyId must match the run's
//      companyId. An owner/admin from Company A cannot see Company B's
//      runs even if they guess the run UUID.
//   2. Triggered-by match — the user who started the run can always see
//      it.
//   3. Owner/Admin role  — any owner or admin within the same tenant
//      can see every run.
//
// The shared helper keeps the three read/cancel routes (status, events,
// cancel) aligned. On denial, routes return 404 — mirrors the trigger
// route's tenant-mismatch handling and avoids leaking which UUIDs exist
// across tenants.
//
// Pure function (no DB, no platform imports) — trivial to unit-test and
// to reuse from non-route contexts (e.g. a future server component).

import type { Role } from '@/lib/api/auth';

/** Minimum fields from `getWorkflowRunById()` the helper needs. */
export interface AccessRun {
  triggeredBy: string;
  companyId: string;
}

/** Minimum fields from `AuthContext` the helper needs. */
export interface AccessAuth {
  userId: string;
  companyId: string | null;
  role: Role;
}

/**
 * Return true if the caller is allowed to read or cancel the given run.
 * See file-header for the rule order.
 */
export function canAccessRun(run: AccessRun, auth: AccessAuth): boolean {
  // Rule 1: tenant isolation. A null auth.companyId (user without a
  // company yet) can never match a run's non-null companyId.
  if (auth.companyId !== run.companyId) return false;

  // Rule 2: the run's trigger user always has access within their tenant.
  if (run.triggeredBy === auth.userId) return true;

  // Rule 3: owner/admin within the same tenant.
  return auth.role === 'owner' || auth.role === 'admin';
}
