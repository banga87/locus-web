// Single entry point for resolving an ApprovedModelId to an AI SDK
// LanguageModel handle. All model calls in the subagent layer go
// through here. Auth is BYOK: our Anthropic + Google provider API keys
// live in Vercel's Gateway BYOK configuration (managed via Vercel
// dashboard / CLI), not in application env or code. Zero Gateway markup
// on tokens — our existing provider billing relationships are preserved.
// The Gateway layers unified auth, cost tracking, failover, and routing
// on top.
//
// The existing Platform Agent in src/lib/agent/ still calls Anthropic
// directly today; migrating that to the Gateway is a separate follow-up
// and is NOT in pilot scope. The two paths coexist during the
// migration window.

import { gateway } from '@ai-sdk/gateway';
import type { ApprovedModelId } from './approved-models';

export function getModel(id: ApprovedModelId) {
  return gateway(id);
}
