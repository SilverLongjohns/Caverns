/** Sandbox and debug messages are dev-only: enabled by CAVERNS_SANDBOX=1 or the --sandbox flag. */
export function isSandboxEnabled(): boolean {
  return process.env.CAVERNS_SANDBOX === '1' || process.argv.includes('--sandbox');
}
