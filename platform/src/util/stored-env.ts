import { execFileSync } from "node:child_process";

/**
 * Why a configured machine still looks unconfigured.
 *
 * `setx` writes to Windows' stored user environment, and it only reaches processes started
 * AFTERWARDS — not the terminal that ran it, and not anything already open. That mismatch has
 * cost this project more debugging time than any provider outage: the person sets the key,
 * the next command says "not set", and the machine looks broken when it is being literal.
 *
 * The hint names the variables and the key's LENGTH only. The stored value itself is a
 * credential and never leaves this module.
 */

/** The pure half: what should be said, given what is stored and what this process has. */
export function staleEnvHint(
  stored: Record<string, string>,
  env: Record<string, string | undefined>,
): string | null {
  const envHas = (name: string): boolean => {
    if (name === "ATP_API_KEY") return ((env["ATP_API_KEY"] ?? env["OPENAI_API_KEY"]) ?? "").trim() !== "";
    return (env[name] ?? "").trim() !== "";
  };

  const missing = ["ATP_API_KEY", "ATP_MODEL"].filter(
    (name) => (stored[name] ?? "") !== "" && !envHas(name),
  );
  if (missing.length === 0) return null;

  const shape = missing
    .map((name) => (name === "ATP_API_KEY" ? `ATP_API_KEY (${(stored[name] ?? "").length} chars)` : name))
    .join(" and ");
  return (
    `This process has none of them, but Windows' stored environment has ${shape} — ` +
    "`setx` only affects terminals opened AFTER it ran. Open a new terminal and try again."
  );
}

/** The impure half: what Windows stores for this user (HKCU\Environment), via `reg query`. */
export function storedUserEnv(names: readonly string[]): Record<string, string> {
  if (process.platform !== "win32") return {};

  const stored: Record<string, string> = {};
  for (const name of names) {
    try {
      const output = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = /REG_(?:EXPAND_)?SZ\s+([\s\S]*)/.exec(output);
      if (match !== null && match[1] !== undefined) stored[name] = match[1].trim();
    } catch {
      // Not stored, or `reg` is unavailable. Either way there is nothing to hint about.
    }
  }
  return stored;
}
