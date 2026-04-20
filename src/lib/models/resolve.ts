// Per-agent model resolution with env-var override.
//
// Env key format: TATARA_MODEL_OVERRIDE_<SLUG_IN_SCREAMING_SNAKE>
// Env value format: ApprovedModelId verbatim (e.g. 'google/gemini-2.5-flash-lite').
//
// Invalid overrides (not in APPROVED_MODELS) log a warning and fall back
// to the agent's default. Never throws.

import { getModel } from './registry';
import {
  isApprovedModelId,
  type ApprovedModelId,
} from './approved-models';

export function slugToEnv(slug: string): string {
  // Two passes handle both simple PascalCase and acronym-prefixed names:
  //   Pass 1 splits an acronym run from a following word (DCPVerifier -> DCP_Verifier).
  //   Pass 2 splits the typical lower-then-upper boundary (BrainExplore -> Brain_Explore).
  return slug
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

export function resolveModel(
  agentSlug: string,
  defaultModel: ApprovedModelId,
) {
  const envKey = `TATARA_MODEL_OVERRIDE_${slugToEnv(agentSlug)}`;
  const override = process.env[envKey];
  let modelId: ApprovedModelId = defaultModel;
  if (override) {
    if (isApprovedModelId(override)) {
      modelId = override;
    } else {
      console.warn(
        `[models] Invalid override for ${agentSlug} via ${envKey}: ${override}; using default ${defaultModel}`,
      );
    }
  }
  return getModel(modelId);
}
