/**
 * Generate a UUID v4 for pairing an mcp_invocation invoke event with its
 * paired complete/error event. See spec §7 "Pairing invoke + complete events".
 *
 * Centralised so we can swap the UUID source in one place if Node's
 * `crypto.randomUUID()` becomes unavailable on a target runtime. Today
 * both Next.js 16 Node runtime and the edge runtime expose it.
 */
export function generateInvocationId(): string {
  return crypto.randomUUID();
}
