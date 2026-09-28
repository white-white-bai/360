import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DOMAINS_DIR, PERSONAS_DIR, STYLES_DIR } from "../catalog.ts";
import type { Domain, Persona, Style } from "../experts/types.ts";
import { loadDomain, loadPersona, loadStyle } from "../experts/load.ts";
import { findPassage } from "../grounding/corpus.ts";
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
 * Provenance, checked at two strengths.
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

function validateDomain(domain: Domain, dir: string): Finding[] {
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
}

export function validateRepo(options: ValidateOptions = {}): ValidationReport {
  const personasDir = options.personasDir ?? PERSONAS_DIR;
  const stylesDir = options.stylesDir ?? STYLES_DIR;
  const domainsDir = options.domainsDir ?? DOMAINS_DIR;

  const findings: Finding[] = [];

  for (const path of markdownFiles(personasDir)) {
    const loaded = safely(path, () => loadPersona(path));
    if (loaded.value !== undefined) findings.push(...validateAxis("persona", loaded.value, path));
    if (loaded.problem !== undefined) findings.push(loaded.problem);
  }
  for (const path of markdownFiles(stylesDir)) {
    const loaded = safely(path, () => loadStyle(path));
    if (loaded.value !== undefined) findings.push(...validateAxis("style", loaded.value, path));
    if (loaded.problem !== undefined) findings.push(loaded.problem);
  }

  const dirs = domainDirs(domainsDir);
  for (const dir of dirs) {
    const loaded = safely(dir, () => loadDomain(dir));
    if (loaded.value !== undefined) findings.push(...validateDomain(loaded.value, dir));
    if (loaded.problem !== undefined) findings.push(loaded.problem);
  }

  // Composition is not declared anywhere yet, so the validator can report the gap
  // even though it cannot decide what the answer should be. Surfacing it is the
  // point: a session's Persona and Style are currently chosen by whoever writes
  // the call site.
  if (dirs.length > 0) {
    findings.push(
      finding(
        "warning",
        "library.no-default-composition",
        "domains/*/meta.md",
        "no Domain declares which Persona and Style it teaches with by default",
        "add `defaultPersona` and `defaultStyle` to meta.md, or let the learner choose at entry",
      ),
    );
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { findings, errors, warnings, ok: errors === 0 };
}
