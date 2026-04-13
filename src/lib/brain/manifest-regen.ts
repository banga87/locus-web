// Best-effort wrapper around `regenerateManifest`. Write routes call this
// after a successful commit so the manifest catches up; we swallow errors
// here because the authoritative write has already succeeded and the next
// successful regeneration will recover.

import { regenerateManifest } from './manifest';

export async function tryRegenerateManifest(brainId: string): Promise<void> {
  try {
    await regenerateManifest(brainId);
  } catch (e) {
    console.warn('[manifest] regeneration failed:', e);
  }
}
