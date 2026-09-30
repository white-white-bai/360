import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { DOMAINS_DIR, PERSONAS_DIR, PROFESSIONS_FILE, STYLES_DIR } from "../catalog.ts";
import type { Domain, Persona, Style } from "../experts/types.ts";
import { loadDomain, loadPersona, loadStyle } from "../experts/load.ts";
import { findPassage } from "../grounding/corpus.ts";
import { loadProfessions, type ProfessionIndex } from "../professions/load.ts";
import { unusableSourceReason } from "../build/fetch.ts";
import type { Finding, Severity, ValidationReport } from "./types.ts";

/**
 * Anything that looks like an unfilled field rather than a decision. Kept in one
 * place so a placeholder cannot be recognised in one rule and missed in another.
 */
const PLACEHOLDER = /REPLACE|TODO|TBD|UNASSIGNED|CHANGEME|FIXME|XXX/i;

function placeholder(value: string | undefined): boolean {
  return value === undefined || value.trim() === "" || PLACEHOLDER.test(value);
}

function finding(
  severity: Severity,
  code: string,
  where: string,
  message: string,
  fix?: string,
): Finding {
  return fix === undefined ? { severity, code, where, message } : { severity, code, where, message, fix };
}

/**
 * Load an asset, turning a parse failure into a finding.
 *
 * A validator that throws a stack trace on the first broken asset stops being a
 * report: it hides every other finding behind whichever file happened to be
 * looked at first, and it tells the reader nothing about what the rules would
 * have said. The loaders stay strict — they must refuse to hand a session a
 * malformed Domain — so the catching belongs here, at the layer whose whole job
 * is to describe what is wrong.
 */
function safely<T>(what: string, load: () => T): { value?: T; problem?: Finding } {
  try {
    return { value: load() };
  } catch (error) {
    return {
      problem: finding(
        "error",
        "asset.unloadable",
        what,
        `could not be parsed: ${(error as Error).message}`,
        "fix this asset; nothing else about it can be checked until it loads",
      ),
    };
  }
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name))
    .sort();
}

function domainDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .sort();
}

// ---------------------------------------------------------------- corpus rules

/**
 * Provenance, checked at two strengths, plus the sign-off.
 *
 * Note what is NOT here: a rule for "this passage has no source at all". The
 * parser already refuses to load such a corpus, so that rule could never fire —
 * it would be dead code that reads like a safeguard. A genuinely missing source
 * surfaces as `asset.unloadable` instead, naming the passage and the field.
 *
 * What remains is the case the parser cannot see: a source that is present but
 * unfilled. `source: TODO` loads perfectly and would otherwise sail through.
 */
function validateCorpus(domain: Domain, dir: string): Finding[] {
  const findings: Finding[] = [];

  // A review is a FIELD, not the absence of a warning banner.
  //
  // The first version of this rule looked for a "NOT YET HUMAN-VERIFIED" comment,
  // which meant the error could be cleared by deleting a line. A check that passes
  // when you remove the evidence is not a check, and "the banner is gone" is a
  // different claim from "someone vouched for this".
  //
  // A key that is ABSENT never reaches here: the loader requires both and refuses
  // the Domain, which surfaces as `asset.unloadable`. What this rule adds is the
  // case the loader cannot see — a key that is present and unfilled, such as
  // `corpusReviewedBy: TODO`. Same division of labour as provenance above.
  if (placeholder(domain.corpusReviewedBy) || placeholder(domain.corpusReviewedOn)) {
    findings.push(
      finding(
        "error",
        "corpus.review-missing",
        `domains/${domain.id}/meta.md`,
        `the corpus review is not recorded: corpusReviewedBy=${JSON.stringify(domain.corpusReviewedBy)}, corpusReviewedOn=${JSON.stringify(domain.corpusReviewedOn)}`,
        "name the person who accepted the provenance check, and the date — a machine comparison is not a sign-off",
      ),
    );
  }

  for (const passage of domain.corpus.passages) {
    const where = `domains/${domain.id}/corpus.md#${passage.id}`;
    if (placeholder(passage.source)) {
      findings.push(
        finding(
          "error",
          "corpus.provenance-placeholder",
          where,
          `source is unfilled: ${JSON.stringify(passage.source)}`,
          "cite something a reader can open, e.g. `RFC 3339 §4.2 — https://...`",
        ),
      );
      continue;
    }
    const looksCitable =
      /https?:\/\//.test(passage.source) || /\b(RFC|ISO|IEEE|ITU|IANA)\b/.test(passage.source);
    if (!looksCitable) {
      findings.push(
        finding(
          "warning",
          "corpus.provenance-vague",
          where,
          `source ${JSON.stringify(passage.source)} names no URL and no document identifier`,
          "cite something a reader can open, e.g. `RFC 3339 §4.2 — https://...`",
        ),
      );
    }
  }

  // The banner is a promise that review has NOT happened. Leaving it in place
  // while also declaring a review would make the two contradict each other.
  const raw = readFileSync(join(dir, "corpus.md"), "utf8");
  if (/NOT YET HUMAN-VERIFIED/i.test(raw)) {
    findings.push(
      finding(
        "error",
        "corpus.review-outstanding",
        `domains/${domain.id}/corpus.md`,
        "the corpus still declares itself unverified",
        "verify each passage against its cited source, then replace the banner with the record",
      ),
    );
  }

  findings.push(...validateSourceManifest(dir, domain));

  return findings;
}

/**
 * The sources a Domain recorded, re-checked after the fact (ADR 0012).
 *
 * The fetcher refuses an error page at build time, but a Domain can also be
 * hand-curated — and two signed Domains once carried a region-block page as
 * a source, because nobody re-read the manifest. So the validator does what
 * the fetcher would have done: any URL that names an error page is an error,
 * and a fetch that resolved to a different host than it asked for is a
 * warning the reviewer should have seen.
 */
function validateSourceManifest(dir: string, domain: Domain): Finding[] {
  const findings: Finding[] = [];

  for (const source of domain.sources) {
    for (const url of source.match(/https?:\/\/[^\s]+/g) ?? []) {
      const reason = unusableSourceReason(url);
      if (reason !== undefined) {
        findings.push(
          finding(
            "error",
            "corpus.source-unusable",
            `domains/${domain.id}/meta.md`,
            `source ${url}: ${reason}`,
            "remove it — a passage that traced here was never backed by a document",
          ),
        );
      }
    }
  }

  const manifestPath = join(dir, "sources.json");
  if (!existsSync(manifestPath)) return findings;

  let manifest: Array<{ requested?: unknown; url?: unknown }>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch (error) {
    findings.push(
      finding(
        "error",
        "corpus.source-manifest-broken",
        `domains/${domain.id}/sources.json`,
        `could not be read: ${(error as Error).message}`,
        "rebuild the Domain so the manifest records what was actually fetched",
      ),
    );
    return findings;
  }

  for (const entry of manifest) {
    if (typeof entry.url !== "string" || typeof entry.requested !== "string") continue;
    const reason = unusableSourceReason(entry.url);
    if (reason !== undefined) {
      findings.push(
        finding(
          "error",
          "corpus.source-unusable",
          `domains/${domain.id}/sources.json`,
          `fetched ${entry.url}: ${reason}`,
          "refetch the intended document, or drop the source if no passage traces to it",
        ),
      );
      continue;
    }
    let requested: URL;
    let resolved: URL;
    try {
      requested = new URL(entry.requested);
      resolved = new URL(entry.url);
    } catch {
      continue;
    }
    if (requested.host !== resolved.host) {
      findings.push(
        finding(
          "warning",
          "corpus.source-redirected",
          `domains/${domain.id}/sources.json`,
          `${entry.requested} resolved to ${entry.url} — a different host than the one asked for`,
          "cite the document actually used, or explain the redirect in the review",
        ),
      );
    }
  }

  return findings;
}

// --------------------------------------------------------------- glossary rules

/**
 * Narrow normalisation for term matching: lowercase, hyphens treated as spaces,
 * whitespace collapsed.
 *
 * Only hyphenation and spacing, because those are typography. `wall-clock` and
 * `wall clock` are the same term, and failing on the difference would be
 * pedantry — a validator that cries wolf gets switched off. Anything looser
 * (stemming, synonyms, fuzzy distance) would stop this check from noticing the
 * drift it exists to catch, which is a glossary written from memory rather than
 * extracted from the material.
 */
function normaliseTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateGlossary(domain: Domain): Finding[] {
  const findings: Finding[] = [];
  const where = `domains/${domain.id}/glossary.md`;
  const { terms, neverTranslate } = domain.glossary;
  const corpusText = normaliseTerm(domain.corpus.passages.map((p) => `${p.text} ${p.source}`).join("\n"));

  // A rendering nobody uses is not neutral: it is a term the material never
  // teaches, occupying the glossary and implying coverage that is not there.
  for (const [term, rendering] of Object.entries(terms)) {
    if (!corpusText.includes(normaliseTerm(term))) {
      findings.push(
        finding("warning", "glossary.term-unused", where, `term ${JSON.stringify(term)} never appears in the corpus`),
      );
    }
    if (placeholder(rendering)) {
      findings.push(
        finding("error", "glossary.rendering-missing", where, `term ${JSON.stringify(term)} has no rendering`),
      );
    }
  }

  for (const identifier of neverTranslate) {
    if (!corpusText.includes(normaliseTerm(identifier))) {
      findings.push(
        finding(
          "warning",
          "glossary.identifier-unused",
          where,
          `neverTranslate entry ${JSON.stringify(identifier)} never appears in the corpus`,
        ),
      );
    }
  }

  // Two terms sharing one rendering makes the delivery language ambiguous, which
  // is the single thing the glossary exists to prevent. An identifier rendered
  // into a translated word is worse: it stops being a citation.
  const byRendering = new Map<string, string[]>();
  for (const [term, rendering] of Object.entries(terms)) {
    const key = rendering.trim();
    byRendering.set(key, [...(byRendering.get(key) ?? []), term]);
  }
  for (const [rendering, owners] of byRendering) {
    if (owners.length > 1) {
      findings.push(
        finding(
          "error",
          "glossary.rendering-conflict",
          where,
          `terms ${owners.map((o) => JSON.stringify(o)).join(" and ")} both render to ${JSON.stringify(rendering)}`,
          "give them distinct renderings, or merge them if they are the same concept",
        ),
      );
    }
    if (neverTranslate.includes(rendering)) {
      findings.push(
        finding(
          "error",
          "glossary.rendering-is-identifier",
          where,
          `${JSON.stringify(rendering)} is a never-translate identifier, so it cannot also be a rendering`,
        ),
      );
    }
  }

  return findings;
}

// ----------------------------------------------------------------- check rules

/**
 * At this stage "every assertion traces to a passage" can only be checked where
 * assertions are written down — and the only place they are written down is the
 * checks' `grounding`. Per-session Assertion Lists arrive with the apparatus
 * (Phase 4); until then this is the honest extent of the rule, not the whole of it.
 */
function validateChecks(domain: Domain): Finding[] {
  const findings: Finding[] = [];
  const misconceptionIds = new Set(domain.misconceptions.map((m) => m.id));
  const reachable = new Set<string>();

  for (const check of domain.checks) {
    const where = `domains/${domain.id}/checks.md#${check.id}`;

    if (check.grounding.length === 0) {
      findings.push(
        finding(
          "error",
          "check.ungrounded",
          where,
          "check grounds on no corpus passage",
          "name at least one passage id it is answerable from",
        ),
      );
    }
    for (const id of check.grounding) {
      if (findPassage(domain.corpus, id) === undefined) {
        findings.push(
          finding("error", "check.grounding-unresolved", where, `grounding names unknown passage ${JSON.stringify(id)}`),
        );
      }
    }
    for (const diagnosis of check.diagnoses) {
      if (!misconceptionIds.has(diagnosis.misconceptionId)) {
        findings.push(
          finding(
            "error",
            "check.diagnosis-unknown",
            where,
            `diagnoses unknown misconception ${JSON.stringify(diagnosis.misconceptionId)}`,
          ),
        );
      }
      reachable.add(diagnosis.misconceptionId);
    }
  }

  // A misconception nothing can detect is a catalogue entry nothing will ever
  // refute (ADR 0009). It is worse than absent, because it implies coverage.
  for (const misconception of domain.misconceptions) {
    if (!reachable.has(misconception.id)) {
      findings.push(
        finding(
          "error",
          "misconception.unreachable",
          `domains/${domain.id}/misconceptions.md#${misconception.id}`,
          "no check can diagnose this misconception",
          "add a diagnosing check, or remove the entry — an unrefutable entry implies coverage that does not exist",
        ),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------- domain rules

function validateDomain(
  domain: Domain,
  dir: string,
  listedDomainIds: ReadonlySet<string> | undefined,
): Finding[] {
  const findings: Finding[] = [
    ...validateCorpus(domain, dir),
    ...validateGlossary(domain),
    ...validateChecks(domain),
  ];
  const where = `domains/${domain.id}/meta.md`;

  // ADR 0006: configuration rights and accountability are the same thing. An
  // unowned Domain rots silently, so "nobody in particular" is not an owner.
  if (placeholder(domain.owner)) {
    findings.push(
      finding(
        "error",
        "domain.owner-missing",
        where,
        `owner is ${JSON.stringify(domain.owner)}`,
        "name the person accountable for this material",
      ),
    );
  }

  // ADR 0012: a Domain no Profession lists is coverage the entry page cannot
  // show. A warning, not an error — the Domain still teaches — but coverage
  // that decays quietly is the failure mode the catalogue exists to prevent.
  if (listedDomainIds !== undefined && !listedDomainIds.has(domain.id)) {
    findings.push(
      finding(
        "warning",
        "domain.unlisted",
        where,
        "no Profession lists this Domain, so the entry page cannot offer it",
        "add its id to a Profession's `domains` in professions/professions.md",
      ),
    );
  }

  return findings;
}

/** The source URLs a Domain recorded — its manifest, or the ones in its meta. */
function domainSourceUrls(domain: Domain, dir: string): Set<string> {
  const urls = new Set<string>();
  const manifestPath = join(dir, "sources.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{
        url?: unknown;
      }>;
      for (const entry of manifest) {
        if (typeof entry.url === "string") urls.add(entry.url);
      }
      return urls;
    } catch {
      // An unreadable manifest is reported by its own rule; it must not
      // manufacture an overlap finding on top of it.
      return urls;
    }
  }
  for (const source of domain.sources) {
    for (const url of source.match(/https?:\/\/[^\s]+/g) ?? []) urls.add(url);
  }
  return urls;
}

/**
 * Near-duplicate Domains, named (ADR 0012).
 *
 * The same rule a signature may sweep drafts with (ADR 0010): at least two
 * shared sources AND 60% of the smaller set. This only NAMES the overlap —
 * signed Domains are a person's decision, so the validator refuses to delete
 * anything here and asks the owner to merge or justify.
 */
function validateDomainOverlap(
  domains: Array<{ domain: Domain; dir: string; urls: Set<string> }>,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const mine = domains[i];
      const theirs = domains[j];
      const shared = [...mine.urls].filter((url) => theirs.urls.has(url)).length;
      const smaller = Math.min(mine.urls.size, theirs.urls.size);
      if (smaller === 0 || shared < 2 || shared / smaller < 0.6) continue;
      findings.push(
        finding(
          "warning",
          "domain.overlap",
          `domains/${mine.domain.id}/meta.md`,
          `shares ${shared} of ${smaller} sources with \`${theirs.domain.id}\` — near-duplicate Domains teach the same thing twice`,
          `merge them under one owner, or justify keeping both`,
        ),
      );
    }
  }
  return findings;
}

/**
 * The industry catalogue's own rules (ADR 0012).
 *
 * Two of them carry the platform's promises. `profession.high-risk-open`
 * extends ADR 0004 — no actor verifies its own output — to signing itself:
 * a high-risk Profession may not list Domains while every Domain records a
 * single reviewer, so the door stays closed until two-reviewer signing exists.
 * And `profession.unknown-domain` keeps the entry honest: a Profession may
 * only claim Domains that are actually signed.
 */
function validateProfessions(
  index: ProfessionIndex,
  domainIds: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const profession of index.professions.values()) {
    const where = `professions/professions.md#${profession.id}`;
    if (profession.boundary.trim() === "") {
      findings.push(
        finding(
          "error",
          "profession.missing-boundary",
          where,
          "no boundary — the learner cannot see what this industry will NOT be taught",
          "write the `boundary` line; it is the honesty the entry page shows",
        ),
      );
    }
    if (!index.categories.has(profession.categoryId)) {
      findings.push(
        finding(
          "error",
          "profession.unknown-category",
          where,
          `category ${JSON.stringify(profession.categoryId)} is not a category in this file`,
          "use a category id declared with kind: category",
        ),
      );
    }
    for (const domainId of profession.domainIds) {
      if (!domainIds.has(domainId)) {
        findings.push(
          finding(
            "error",
            "profession.unknown-domain",
            where,
            `Domain ${JSON.stringify(domainId)} is not signed — a draft is not coverage`,
            "sign the Domain first, or take it off the list",
          ),
        );
      }
    }
    if (profession.risk === "high" && profession.domainIds.length > 0) {
      findings.push(
        finding(
          "error",
          "profession.high-risk-open",
          where,
          "a high-risk Profession lists Domains, but no Domain can yet record the two independent reviewers ADR 0012 requires",
          "empty its `domains` list until two-reviewer signing exists — the door stays closed",
        ),
      );
    }
  }

  return findings;
}

// --------------------------------------------------------------- library rules

function validateAxis<T extends Persona | Style>(kind: string, item: T, path: string): Finding[] {
  const findings: Finding[] = [];
  for (const [field, value] of Object.entries(item)) {
    if (typeof value === "string" && placeholder(value)) {
      findings.push(
        finding(
          "warning",
          `library.${kind}-placeholder`,
          path,
          `${kind} \`${item.id}\` field \`${field}\` looks unfilled`,
        ),
      );
    }
  }
  return findings;
}

// ------------------------------------------------------------------- entrypoint

export interface ValidateOptions {
  personasDir?: string;
  stylesDir?: string;
  domainsDir?: string;
  /** Defaults to the repo's industry catalogue (ADR 0012). */
  professionsFile?: string;
}

/**
 * ADR 0007 has the learner choose a Persona and a Style at entry, which turns
 * the SIZE of each library into a checkable property rather than a product
 * opinion: none is an error, one is a warning, and which particular voices
 * should exist is not something a validator can judge.
 *
 * The warning matters more than it looks. A single entry satisfies every other
 * rule while making the entry screen a formality — the kind of gap that no
 * amount of rule-reading reveals, because nothing is wrong, there is just
 * nothing there.
 */
function validateChoice(kind: "persona" | "style", count: number, where: string): Finding[] {
  if (count === 0) {
    return [
      finding(
        "error",
        `library.no-${kind}s`,
        where,
        `no ${kind} exists, so no Expert can be composed at all`,
        `add at least two ${kind}s — entry offers a choice (ADR 0007)`,
      ),
    ];
  }
  if (count === 1) {
    return [
      finding(
        "warning",
        `library.no-${kind}-choice`,
        where,
        `only one ${kind} exists, so entry has no choice to offer`,
        `add a second ${kind}, or accept that this library has one voice (ADR 0007)`,
      ),
    ];
  }
  return [];
}

export function validateRepo(options: ValidateOptions = {}): ValidationReport {
  const personasDir = options.personasDir ?? PERSONAS_DIR;
  const stylesDir = options.stylesDir ?? STYLES_DIR;
  const domainsDir = options.domainsDir ?? DOMAINS_DIR;
  const professionsFile = options.professionsFile ?? PROFESSIONS_FILE;

  const findings: Finding[] = [];

  const personaPaths = markdownFiles(personasDir);
  const stylePaths = markdownFiles(stylesDir);

  for (const path of personaPaths) {
    const loaded = safely(path, () => loadPersona(path));
    if (loaded.value !== undefined) findings.push(...validateAxis("persona", loaded.value, path));
    if (loaded.problem !== undefined) findings.push(loaded.problem);
  }
  for (const path of stylePaths) {
    const loaded = safely(path, () => loadStyle(path));
    if (loaded.value !== undefined) findings.push(...validateAxis("style", loaded.value, path));
    if (loaded.problem !== undefined) findings.push(loaded.problem);
  }

  const loadedDomains: Array<{ domain: Domain; dir: string; urls: Set<string> }> = [];
  const domainIds = new Set<string>();
  const domainDirsList = domainDirs(domainsDir);
  for (const dir of domainDirsList) {
    domainIds.add(dir.slice(domainsDir.length + 1));
    const loaded = safely(dir, () => loadDomain(dir));
    if (loaded.value === undefined) {
      if (loaded.problem !== undefined) findings.push(loaded.problem);
      continue;
    }
    loadedDomains.push({ domain: loaded.value, dir, urls: domainSourceUrls(loaded.value, dir) });
  }

  const professions = safely(professionsFile, () => loadProfessions(professionsFile));
  if (professions.value === undefined && professions.problem !== undefined) {
    findings.push(professions.problem);
  }
  // A Domain's rules run whether or not the industry catalogue loads: a
  // broken catalogue must not silence every corpus, glossary and check
  // rule, which is what putting them behind the catalogue's `else`
  // branch would do.
  const listed =
    professions.value === undefined
      ? undefined
      : new Set(
          [...professions.value.professions.values()].flatMap((profession) => profession.domainIds),
        );
  for (const { domain, dir } of loadedDomains) {
    findings.push(...validateDomain(domain, dir, listed));
  }

  if (professions.value !== undefined) {
    findings.push(...validateProfessions(professions.value, domainIds));
  }

  findings.push(...validateDomainOverlap(loadedDomains));

  findings.push(...validateChoice("persona", personaPaths.length, "library/personas/"));
  findings.push(...validateChoice("style", stylePaths.length, "library/styles/"));

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { findings, errors, warnings, ok: errors === 0 };
}

/**
 * Validate ONE Domain directory — the builder's view of a draft (ADR 0010).
 *
 * A draft lives outside every library, so it cannot be reached through `validateRepo` without
 * also validating whatever else happens to be lying around. This runs the same domain rules
 * against the single directory a signature would move.
 */
export function validateDraft(dir: string): ValidationReport {
  const findings: Finding[] = [];
  const loaded = safely(dir, () => loadDomain(dir));
  if (loaded.value !== undefined) findings.push(...validateDomain(loaded.value, dir, undefined));
  if (loaded.problem !== undefined) findings.push(loaded.problem);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { findings, errors, warnings, ok: errors === 0 };
}
