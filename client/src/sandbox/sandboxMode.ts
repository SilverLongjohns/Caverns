import { parseSandboxQuery, type SandboxOverrides } from '@caverns/shared';

export interface SandboxRequest {
  preset: string;
  overrides: SandboxOverrides;
}

/** Dev builds only: the sandbox fight requested by ?sandbox=..., or null. */
export function getSandboxRequest(): SandboxRequest | null {
  if (!import.meta.env.DEV) return null;
  return parseSandboxQuery(window.location.search);
}
