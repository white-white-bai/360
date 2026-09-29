import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { DOMAINS_DIR, DOMAIN_DRAFTS_DIR } from "../catalog.ts";
import type { Domain } from "../experts/types.ts";
import { loadDomain } from "../experts/load.ts";
import { validateDraft } from "../validate/rules.ts";
import type { Finding } from "../validate/types.ts";
import { parseFrontmatter } from "../util/frontmatter.ts";
import { PENDING_CODES } from "./write-domain.ts";

/**
 * The signature gate (ADR 0010).
 *
 * A draft becomes a Domain in exactly one way: a person looks at what it will teach, and puts
 * their name on it. This module is that one way — the builder cannot sign, the validator cannot
 * sign, and nothing moves across the directory line without a name.
 */

export interface ReviewPaths {
  draftsDir?: string;
  domainsDir?: string;
}

interface SourceManifest {
  index: number;
  requested: string;
  url: string;
  fetchedAt: string;
  sha256: string;
  bytes: number;
  text: string;
}

export interface DraftReport {
  id: string;
  dir: string;
  domain: Domain;
  boundary: string;
  sources: SourceManifest[];
  findings: Finding[];
  /** Errors other than the pending signature: a broken draft has nothing to sign. */
  unexpected: Finding[];
}

function draftDirOf(id: string, paths: ReviewPaths): string {
  // The id comes from a request or from a directory name, and it becomes a path. `..` and
  // separators are not ids; refusing them here keeps every caller out of the rest of the disk.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..")) {
    throw new Error(`unsafe draft id ${JSON.stringify(id)}`);
  }
  return join(paths.draftsDir ?? DOMAIN_DRAFTS_DIR, id);
}

/**
 * What is waiting for a signature, by name.
 *
 * Read from `meta.md` alone rather than by loading the draft: a listing must survive a draft
 * that does not fully load, and the entry page needs this to be cheap. A draft whose meta does
 * not parse is still listed — under its directory name — because the review command, not the
 * listing, is where its problem gets named.
 */
export function listDrafts(draftsDir: string = DOMAIN_DRAFTS_DIR): Array<{ id: string; name: string }> {
  if (!existsSync(draftsDir)) return [];

  const drafts: Array<{ id: string; name: string }> = [];
  for (const entry of readdirSync(draftsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(draftsDir, entry.name, "meta.md");
    if (!existsSync(metaPath)) continue;
    try {
      const { data } = parseFrontmatter(readFileSync(metaPath, "utf8"));
      const id = typeof data.id === "string" && data.id.trim() !== "" ? data.id : entry.name;
      const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name : entry.name;
      drafts.push({ id, name });
    } catch {
      drafts.push({ id: entry.name, name: entry.name });
    }
  }
  return drafts.sort((a, b) => a.id.localeCompare(b.id));
}

function readSources(dir: string): SourceManifest[] {
  return JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")) as SourceManifest[];
}

export interface DraftSibling {
  id: string;
  name: string;
  /** How many source URLs this draft shares with the one being reviewed. */
  shared: number;
}

/** The source URLs a draft recorded, or nothing when its manifest cannot be read. */
function draftSourceUrls(dir: string): string[] {
  const path = join(dir, "sources.json");
  if (!existsSync(path)) return [];
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Array<{ url?: unknown }>;
    return manifest.flatMap((entry) => (typeof entry.url === "string" ? [entry.url] : []));
  } catch {
    // An unreadable manifest cannot make a draft a sibling — and it must never make one a
    // candidate for deletion.
    return [];
  }
}

/**
 * The other drafts on the shelf that are near-duplicates of this one — the same sources, mostly.
 *
 * This is what a signature may sweep, so the rule errs toward not matching: at least two shared
 * sources AND 60% of the smaller source set. Two drafts on different subjects fetch different
 * documents; heavy overlap is what "this is the same build, again" looks like from the outside.
 * This function only NAMES what a person may agree to remove — it deletes nothing.
 */
export function listDraftSiblings(id: string, draftsDir: string = DOMAIN_DRAFTS_DIR): DraftSibling[] {
  const mine = new Set(draftSourceUrls(draftDirOf(id, { draftsDir })));
  if (mine.size === 0) return [];

  const siblings: DraftSibling[] = [];
  for (const entry of listDrafts(draftsDir)) {
    if (entry.id === id) continue;
    const theirs = new Set(draftSourceUrls(join(draftsDir, entry.id)));
    const shared = [...mine].filter((url) => theirs.has(url)).length;
    const smaller = Math.min(mine.size, theirs.size);
    if (shared >= 2 && shared / smaller >= 0.6) {
      siblings.push({ id: entry.id, name: entry.name, shared });
    }
  }
  return siblings.sort((a, b) => b.shared - a.shared);
}

/** Everything a signer is being asked to accept, loaded and validated. */
export function inspectDraft(id: string, paths: ReviewPaths = {}): DraftReport {
  const dir = draftDirOf(id, paths);
  if (!existsSync(dir)) {
    throw new Error(`no draft \`${id}\` to review (looked in ${dir})`);
  }

  const domain = loadDomain(dir);
  const findings = validateDraft(dir).findings;
  return {
    id,
    dir,
    domain,
    boundary: parseFrontmatter(readFileSync(join(dir, "meta.md"), "utf8")).body.trim(),
    sources: readSources(dir),
    findings,
    unexpected: findings.filter((finding) => finding.severity === "error" && !PENDING_CODES.includes(finding.code)),
  };
}

export interface SignOptions extends ReviewPaths {
  name: string;
  /** ISO date; the caller may fix it for a test. Defaults to today. */
  date?: string;
}

/** Replace the field lines the builder wrote as `TODO`. Fails loudly if the shape drifted. */
function signMeta(markdown: string, signer: string, date: string): string {
  const write = (text: string, key: string, value: string): string => {
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (!pattern.test(text)) {
      throw new Error(`meta.md has no \`${key}\` line to sign — the draft was not written by the builder`);
    }
    return text.replace(pattern, `${key}: ${value}`);
  };

  let signed = write(markdown, "owner", signer);
  signed = write(signed, "corpusReviewedBy", signer);
  signed = write(signed, "corpusReviewedOn", date);
  return signed;
}

/**
 * Sign a draft and move it into the library.
 *
 * The order matters: refuse to sign what does not validate (a signature is not a repair), then
 * record the name, then re-check that the pendings actually cleared, and only then move the
 * directory. A rename that fails leaves a signed draft in place rather than a half-moved Domain.
 */
export function signDraft(id: string, options: SignOptions): string {
  const draftsDir = options.draftsDir ?? DOMAIN_DRAFTS_DIR;
  const domainsDir = options.domainsDir ?? DOMAINS_DIR;
  const dir = draftDirOf(id, { draftsDir });
  const target = join(domainsDir, id);

  if (!existsSync(dir)) throw new Error(`no draft \`${id}\` to sign (looked in ${dir})`);
  if (existsSync(target)) throw new Error(`\`${id}\` is already a Domain — the signature would overwrite it`);
  if (options.name.trim() === "") throw new Error("a signature needs a name — an unowned Domain rots silently (ADR 0006)");

  const before = validateDraft(dir);
  const broken = before.findings.filter((finding) => finding.severity === "error" && !PENDING_CODES.includes(finding.code));
  if (broken.length > 0) {
    throw new Error(
      `the draft does not pass the validator, so there is nothing to sign (${broken.length} error(s)):\n` +
        broken.map((finding) => `  ${finding.code}: ${finding.message}`).join("\n"),
    );
  }

  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const metaPath = join(dir, "meta.md");
  writeFileSync(metaPath, signMeta(readFileSync(metaPath, "utf8"), options.name.trim(), date), "utf8");

  const after = validateDraft(dir);
  if (!after.ok) {
    throw new Error(
      `signing did not clear the pending errors, so the draft stays where it is:\n` +
        after.findings
          .filter((finding) => finding.severity === "error")
          .map((finding) => `  ${finding.code}: ${finding.message}`)
          .join("\n"),
    );
  }

  mkdirSync(domainsDir, { recursive: true });
  renameSync(dir, target);
  return target;
}

// ------------------------------------------------------------------------ CLI --

async function main(): Promise<void> {
  const id = (process.argv[2] ?? "").trim();
  if (id === "") {
    console.error("用法：npm run review-domain -- <draft-id>");
    process.exitCode = 1;
    return;
  }

  let report: DraftReport;
  try {
    report = inspectDraft(id);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n将要教的东西：${report.domain.name}（${id}）`);
  console.log(`  ${report.boundary}`);
  console.log(`\n来源（原文在 sources/ 里，逐条已由内核验过引文）：`);
  for (const source of report.sources) {
    console.log(`  [${source.index}] ${source.url}`);
    console.log(`      抓取于 ${source.fetchedAt} · sha256 ${source.sha256.slice(0, 12)}…`);
  }
  console.log(`\n语料段落（${report.domain.corpus.passages.length}）：`);
  for (const passage of report.domain.corpus.passages) {
    console.log(`  ${passage.id} — ${passage.source}`);
    console.log(`      ${passage.text.replace(/\s+/g, " ").slice(0, 90)}…`);
  }
  console.log(`\n误解（${report.domain.misconceptions.length}）：`);
  for (const entry of report.domain.misconceptions) {
    console.log(`  ${entry.id} — ${entry.name}`);
  }
  console.log(`\n检查（${report.domain.checks.length}）：`);
  for (const check of report.domain.checks) {
    console.log(`  ${check.id} — ${check.prompt}`);
  }

  if (report.unexpected.length > 0) {
    console.log(`\n草稿没有通过校验（${report.unexpected.length} 个错误，与签字无关）——先修，或者重做：`);
    for (const finding of report.unexpected) {
      console.log(`  ${finding.code}\n    at  ${finding.where}\n    why ${finding.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question("\n签字人（写入 owner 与 corpusReviewedBy）> ")).trim();
    if (name === "") {
      console.error("没有名字就不签字——这份材料需要一个具体的人负责。");
      process.exitCode = 1;
      return;
    }
    const target = signDraft(id, { name });
    console.log(`\n已签字并移入 ${target}。目录里现在能教它了：`);
    console.log(`  npm run board  →  「学什么」里会出现 ${id}`);
  } finally {
    rl.close();
  }
}

// Only run when invoked directly; importing this in a test must not prompt anyone.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
