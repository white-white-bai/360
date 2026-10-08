import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The local, gitignored `.env` at the repository root — where an API key lives on this machine.
 *
 * Why a file at all: `setx` only reaches terminals opened AFTERWARDS, and a person who sets a
 * key and then reads "not set" reasonably concludes the machine is broken. That mismatch cost
 * this project more debugging time than any provider outage. The file is read at the entry
 * points, the process environment still wins over it, and it is gitignored — with a key in a
 * tracked SOURCE file being the mistake this exists to make unnecessary.
 *
 * The key's value is never printed by anything here; loadLocalEnv only moves it into the
 * environment a process already keeps private.
 */

/** Parse the tiny format: `NAME=value` lines, `#` comments, optional surrounding quotes. */
export function parseLocalEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const name = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(equals + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    if (value !== "") values[name] = value;
  }
  return values;
}

/** Fill in what the target does not already have. The process environment wins, always. */
export function loadLocalEnv(
  path: string,
  target: Record<string, string | undefined> = process.env,
): void {
  if (!existsSync(path)) return;
  for (const [name, value] of Object.entries(parseLocalEnv(readFileSync(path, "utf8")))) {
    if ((target[name] ?? "") === "") target[name] = value;
  }
}

/** The repository root's `.env`, found from this module's own location, not the current directory. */
export function loadRepoEnv(target: Record<string, string | undefined> = process.env): void {
  loadLocalEnv(fileURLToPath(new URL("../../../.env", import.meta.url)), target);
}
