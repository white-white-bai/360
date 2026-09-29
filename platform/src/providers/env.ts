/**
 * Reading configuration out of the environment, shared by the adapters.
 *
 * Two adapters now read the same variables in the same way, and a second copy of this
 * would eventually disagree about whitespace, about which of two names wins, or about
 * what an unparseable number means — three small differences that all show up as a
 * session behaving oddly for no visible reason.
 */
export function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function envNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = envValue(env, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}
