// /chat/[sessionId] — Server Component.
//
// Loads the session row + ordered turns via Drizzle (NOT through the
// HTTP API — we're on the server, no point in the round trip). Hands
// initial messages off to <ChatRoot>, which composes the session
// sidebar + the streaming <ChatInterface>.
//
// Auth: ownership-scoped. A session that belongs to a different user
// returns 404 (not 403) so cross-tenant id guesses can't leak existence.

import { and, asc, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db';
import { sessions, sessionTurns } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { hydrateUIMessages } from '@/lib/sessions/hydrate-ui-messages';

import { ChatRoot } from './chat-root';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function ChatSessionPage({ params }: PageProps) {
  const { sessionId } = await params;

  let auth;
  try {
    auth = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError && err.statusCode === 401) {
      redirect('/login');
    }
    throw err;
  }

  if (!auth.companyId) {
    redirect('/setup');
  }

  const [session] = await db
    .select({
      id: sessions.id,
      status: sessions.status,
    })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)),
    )
    .limit(1);

  if (!session) {
    notFound();
  }

  // Hard cap matches the API route's limit. Long sessions get the
  // tail; chat history pagination is a Phase 2 concern (compaction).
  const turns = await db
    .select({
      turnNumber: sessionTurns.turnNumber,
      userMessage: sessionTurns.userMessage,
      assistantMessages: sessionTurns.assistantMessages,
    })
    .from(sessionTurns)
    .where(eq(sessionTurns.sessionId, sessionId))
    .orderBy(asc(sessionTurns.turnNumber))
    .limit(200);

  const initialMessages = hydrateUIMessages(turns);

  return (
    <ChatRoot sessionId={session.id} initialMessages={initialMessages} />
  );
}
