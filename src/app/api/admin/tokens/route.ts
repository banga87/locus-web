// Admin Agent Access Token endpoints — list + create.
//
// Auth: `requireOwner()` is stubbed inline pending Task 3 (real requireAuth).
// Pre-MVP: only Owner role may manage tokens. Scopes are hardcoded to
// `['read']` at creation time; the raw token is returned exactly once in
// the POST response and never again.

import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agentAccessTokens, users } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';
import { logAuthEvent } from '@/lib/audit/helpers';
import { createToken } from '@/lib/auth/tokens';

// ---------- auth stub (replace with @/lib/auth/requireAuth in Task 3) ----

type OwnerContext = {
  userId: string;
  companyId: string;
  role: 'owner';
  actorName: string | null;
};

async function requireOwner(): Promise<OwnerContext | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const [profile] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (
    !profile ||
    profile.role !== 'owner' ||
    profile.status !== 'active' ||
    !profile.companyId
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  return {
    userId: user.id,
    companyId: profile.companyId,
    role: 'owner',
    actorName: profile.fullName ?? null,
  };
}

function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

// ---------- GET /api/admin/tokens ---------------------------------------

export async function GET() {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  const rows = await db
    .select({
      id: agentAccessTokens.id,
      name: agentAccessTokens.name,
      prefix: agentAccessTokens.tokenPrefix,
      scopes: agentAccessTokens.scopes,
      status: agentAccessTokens.status,
      createdAt: agentAccessTokens.createdAt,
      revokedAt: agentAccessTokens.revokedAt,
      lastUsedAt: agentAccessTokens.lastUsedAt,
    })
    .from(agentAccessTokens)
    .where(eq(agentAccessTokens.companyId, ctx.companyId))
    .orderBy(desc(agentAccessTokens.createdAt));

  return NextResponse.json({ tokens: rows });
}

// ---------- POST /api/admin/tokens --------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be JSON.' },
      { status: 400 }
    );
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'name is required (1–100 chars).',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const { token, record } = await createToken({
    companyId: ctx.companyId,
    name: parsed.data.name,
    createdBy: ctx.userId,
  });

  logAuthEvent({
    companyId: ctx.companyId,
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.actorName ?? undefined,
    eventType: 'token.created',
    tokenId: record.id,
    details: {
      tokenPrefix: record.tokenPrefix,
      name: record.name,
      scopes: record.scopes,
    },
  });

  // The raw token is returned exactly once here. Clients must capture it
  // now — there is no endpoint to retrieve it later.
  return NextResponse.json(
    {
      token,
      tokenId: record.id,
      prefix: record.tokenPrefix,
      name: record.name,
      scopes: record.scopes,
      createdAt: record.createdAt,
    },
    { status: 201 }
  );
}
