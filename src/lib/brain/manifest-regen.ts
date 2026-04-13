// Task 11 will ship `@/lib/brain/manifest` with `regenerateManifest`. Until
// then every write route should still "call" it — this tryRegenerate
// helper dynamic-imports the module and silently no-ops if it is missing,
// so the route wiring can land without coupling to Task 11's schedule.

export async function tryRegenerateManifest(brainId: string): Promise<void> {
  try {
    // Dynamic, untyped import so tsc doesn't complain that the module
    // doesn't exist yet (Task 11). The specifier is a string literal in a
    // variable so the Next/Turbopack resolver doesn't try to eagerly bind
    // it at build-graph time either.
    const specifier = '@/lib/brain/manifest';
    const mod: unknown = await (
      Function('s', 'return import(s)') as (s: string) => Promise<unknown>
    )(specifier).catch(() => null);
    if (
      mod &&
      typeof (mod as { regenerateManifest?: unknown }).regenerateManifest ===
        'function'
    ) {
      await (
        mod as { regenerateManifest: (id: string) => Promise<void> }
      ).regenerateManifest(brainId);
    }
  } catch (e) {
    console.warn('[manifest] regeneration skipped:', e);
  }
}
