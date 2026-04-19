import type { OutputContract } from './types';

export function validateOutputContract(
  text: string,
  contract: OutputContract,
): { ok: true } | { ok: false; reason: string } {
  if (!contract.validator) return { ok: true };
  return contract.validator(text);
}
