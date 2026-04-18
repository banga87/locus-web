// Short-lived PKCE verifier store. Keyed by signed-state string; values
// auto-expire after 10 minutes. Single-process only — safe for dev, will
// need KV in a multi-instance deploy.

interface Entry {
  verifier: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60_000;

export function savePkceVerifier(signedState: string, verifier: string): void {
  sweep();
  store.set(signedState, { verifier, expiresAt: Date.now() + TTL_MS });
}

export function takePkceVerifier(signedState: string): string | null {
  sweep();
  const entry = store.get(signedState);
  if (!entry) return null;
  store.delete(signedState);
  if (entry.expiresAt < Date.now()) return null;
  return entry.verifier;
}

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

// Testing hook — not for production use.
export function __resetPkceStoreForTests(): void {
  store.clear();
}
