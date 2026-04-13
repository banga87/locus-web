// /chat — entry point. Task 2 will create a real session row here and
// redirect to /chat/[sessionId]. Until Task 2 ships the sessions API,
// we redirect to a local pseudo-id so the streaming round trip can be
// exercised end-to-end. Task 4 replaces this body with the proper
// "create session, redirect, render sidebar" flow.

import { redirect } from 'next/navigation';

export default function ChatIndexPage(): never {
  // Random suffix so refreshing this page doesn't keep landing on the
  // same orphan id. Task 2 swaps this for a real createSession() call.
  const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
  redirect(`/chat/${tempId}`);
}
