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
 * The industry catalogue (ADR 0012): categories and Professions in one file,
 * in the section grammar every other knowledge asset uses. The file's length
 * is the honest statement of what the platform can say about an industry —
 * categories are seeded in full, Professions only where something can be taught.
 */
export const PROFESSIONS_FILE = join(REPO_ROOT, "professions", "professions.md");

/**
 * The Competency layer (ADR 0015): the must-know units of each Profession,
 * linked by prerequisites, each naming the Domains that teach it and the part
 * this platform does not teach. Same file, same grammar, same rules — the
 * middle layer is an asset like the others, not a second mechanism.
 */
export const COMPETENCIES_FILE = join(REPO_ROOT, "professions", "competencies.md");

/**
 * Domains the builder wrote and nobody has signed yet (ADR 0010).
 *
 * Outside `domains/` on purpose: the library loads everything it finds there, and a draft that
 * could be taught before its signature would make the gate decorative. `review-domain` is the
 * only thing that moves a directory across.
 */
export const DOMAIN_DRAFTS_DIR = join(REPO_ROOT, "domains-draft");

/**
 * Session records. SENSITIVE (ADR 0002): a log holds the learner's
 * misconceptions and their own words, so this directory is gitignored and the
 * store can prove a deletion rather than merely attempt one.
 */
export const SESSIONS_DIR = join(REPO_ROOT, "platform", ".sessions");

/**
 * Trials by real learners (ADR 0019).
 *
 * Sensitive for exactly the reason a session is (ADR 0002), and it holds MORE than a
 * session does: a trial carries the learner's answers, their misconceptions, what they
 * said they thought they understood, and the label they were filed under. So it is
 * gitignored like `.sessions/`, it is keyed by the session id so the follow-up sitting can
 * find and complete it, and it is never a place the platform reads from when teaching.
 */
export const EXPERIMENTS_DIR = join(REPO_ROOT, "platform", ".experiments");
