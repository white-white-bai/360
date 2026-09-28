import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Where the platform's own pieces live, derived from this module's location so
 * nothing depends on the process's working directory.
 *
 *   <repo>/platform/src/catalog.ts  ->  <repo>/
 *
 * The skills collection (`.commandcode/skills/`) is deliberately NOT referenced
 * here. ADR 0001 settled that it is an asset library for expert roles, not part
 * of the delivery vehicle; the platform's own config assets live under
 * `library/` and `domains/` instead.
 */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LIBRARY_DIR = join(REPO_ROOT, "library");
export const PERSONAS_DIR = join(LIBRARY_DIR, "personas");
export const STYLES_DIR = join(LIBRARY_DIR, "styles");
export const DOMAINS_DIR = join(REPO_ROOT, "domains");

/**
 * Session records. SENSITIVE (ADR 0002): a log holds the learner's
 * misconceptions and their own words, so this directory is gitignored and the
 * store can prove a deletion rather than merely attempt one.
 */
export const SESSIONS_DIR = join(REPO_ROOT, "platform", ".sessions");
