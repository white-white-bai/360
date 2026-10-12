import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { COMPETENCIES_FILE, DOMAINS_DIR, PERSONAS_DIR, PROFESSIONS_FILE, STYLES_DIR } from "../catalog.ts";
import { type Domain, type Persona, type Style } from "../experts/types.ts";
import { loadDomain, loadPersona, loadStyle } from "../experts/load.ts";
import { findPassage } from "../grounding/corpus.ts";
import {
  loadCompetencies,
  loadProfessions,
  professionStatus,
  type Competency,
  type CompetencyIndex,
  type ProfessionIndex,
  type ProfessionStatus,
} from "../professions/load.ts";
import { coSignedDomainIds } from "../professions/coverage.ts";
import { reviewLedger, todayISO, type ReviewEntry } from "../professions/review.ts";
import { isPlaceholder } from "../util/placeholder.ts";
import { isLocalSource, localFileName, normaliseProvidedText, unusableSourceReason } from "../build/fetch.ts";
import type { Finding, Severity, ValidationReport } from "./types.ts";

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
 * The second reviewer's pair, when there is one (ADR 0017).
 *
 * Three states are legitimate — no second reviewer at all (the single-reviewed
 * Domains that predate the second signature), and a pair of two different,
 * filled names — so this rule fires only on the shapes in between. Each of them
 * is a Domain that reads as co-signed without being it, which is the one failure
 * mode a second signature must not have: the whole point of recording it is that
 * a reader can trust the file, and a half-written pair is exactly the thing that
 * would let a high-risk line open on a signature nobody gave.
 *
 * It says nothing about whether the two names are two PEOPLE. Nothing in a file
 * can, and a rule whose name promised it would be the first lie in an ADR built
 * to avoid one (ADR 0017 decision 2) — the check is named for what it does.
 */
function validateSecondReview(domain: Domain): Finding[] {
  const where = `domains/${domain.id}/meta.md`;
  const second = domain.secondReviewedBy;
  const secondOn = domain.secondReviewedOn;
  const named = second !== undefined;
  const dated = secondOn !== undefined;

  // Neither field: the honest single-reviewed state. Nothing to say.
  if (!named && !dated) return [];

  if (named !== dated) {
    return [
      finding(
        "error",
        "corpus.second-review-invalid",
        where,
        `the second review is half-recorded: secondReviewedBy=${JSON.stringify(second)}, secondReviewedOn=${JSON.stringify(secondOn)} — a signature needs both a name and a date`,
        "fill in the missing half, or remove both lines — a half-filled pair is not a signature",
      ),
    ];
  }

  if (isPlaceholder(second) || isPlaceholder(secondOn)) {
    return [
      finding(
        "error",
        "corpus.second-review-invalid",
        where,
        `the second review is not recorded: secondReviewedBy=${JSON.stringify(second)}, secondReviewedOn=${JSON.stringify(secondOn)}`,
        "name the second person who read the corpus, and the date — or remove both lines and stay single-reviewed",
      ),
    ];
  }

  if (second === domain.corpusReviewedBy) {
    return [
      finding(
        "error",
        "corpus.second-review-invalid",
        where,
        `the second reviewer is the same person as the first (${JSON.stringify(second)}) — two signatures by one person are one signature`,
        "name a different person, or remove both lines and stay single-reviewed",
      ),
    ];
  }

  return [];
}

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
  if (isPlaceholder(domain.corpusReviewedBy) || isPlaceholder(domain.corpusReviewedOn)) {
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

  // The SECOND signature (ADR 0017). A Domain with no second reviewer at all is
  // the honest single-reviewed state, so this rule says nothing about it — the
  // rule that needs two reviewers lives on the Profession, because it is a
  // HIGH-RISK line that needs them, not every Domain. What this catches is a
  // pair that LOOKS like a second signature and is not one, because a file that
  // appears co-signed while nobody signed it is worse than one that plainly is
  // not.
  findings.push(...validateSecondReview(domain));

  for (const passage of domain.corpus.passages) {
    const where = `domains/${domain.id}/corpus.md#${passage.id}`;
    if (isPlaceholder(passage.source)) {
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

  let manifest: Array<{ requested?: unknown; url?: unknown; sha256?: unknown; text?: unknown }>;
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
    if (typeof entry.url !== "string") continue;

    // A PROVIDED source (ADR 0016): the second entrance's check. A file that is not there is
    // the same failure as a URL that names an error page — a passage that traced here was
    // never backed by a document — so it is the same code, at the same place.
    if (isLocalSource(entry.url)) {
      const where = `domains/${domain.id}/sources.json`;
      const named = localFileName(entry.url);
      // The build copied the provided file beside the draft and recorded WHERE it put it in the
      // manifest's `text`. That recorded path is the file to check — reconstructing a name from
      // the `local:` identifier would be a second opinion about where the build stores its work,
      // and the two could drift. The original file name is still used as the human-facing label.
      const label = "name" in named ? named.name : entry.url;
      const stored = typeof entry.text === "string" ? entry.text : "";
      if (!/^sources\/[^/\\]+$/.test(stored) || stored.includes("..")) {
        findings.push(
          finding("error", "corpus.source-unusable", where,
            `provided source ${label}: the manifest does not record a usable \`sources/\` path (got ${JSON.stringify(stored)})`,
            "rebuild the Domain so the manifest records where the provided file was copied"),
        );
        continue;
      }
      const file = join(dir, stored);
      if (!existsSync(file)) {
        findings.push(
          finding("error", "corpus.source-unusable", where,
            `provided source ${label} is not at domains/${domain.id}/${stored}`,
            "put the file back — a passage that quoted it was never backed by a document"),
        );
        continue;
      }
      const text = normaliseProvidedText(readFileSync(file, "utf8"));
      const sha = createHash("sha256").update(text).digest("hex");
      if (typeof entry.sha256 === "string" && entry.sha256 !== sha) {
        // Drift, not disproof: the file changed after it was quoted from. A warning, because
        // what it means is "look at this", which is an owner's job rather than an error.
        findings.push(
          finding("warning", "corpus.source-changed", where,
            `provided source ${label} no longer hashes to what the build recorded (${entry.sha256.slice(0, 12)}… → ${sha.slice(0, 12)}…)`,
            "re-read the file — the corpus was quoted from a different version of it"),
        );
      }
      continue;
    }

    if (typeof entry.requested !== "string") continue;
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
      // Neither http(s) nor `local:` — a scheme this platform has no entrance for.
      findings.push(
        finding("error", "corpus.source-unusable", `domains/${domain.id}/sources.json`,
          `source ${JSON.stringify(entry.url)} is neither an http(s) URL nor a \`local:\` provided source`,
          "a source is a fetched document or a file the Owner supplied (ADR 0010/0016)"),
      );
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
    if (isPlaceholder(rendering)) {
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
  review?: ReviewEntry,
): Finding[] {
  const findings: Finding[] = [
    ...validateCorpus(domain, dir),
    ...validateGlossary(domain),
    ...validateChecks(domain),
  ];
  const where = `domains/${domain.id}/meta.md`;

  // ADR 0006: configuration rights and accountability are the same thing. An
  // unowned Domain rots silently, so "nobody in particular" is not an owner.
  if (isPlaceholder(domain.owner)) {
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

  // ADR 0018: a signature is a statement about a corpus at a date, and the
  // documents underneath it are not frozen. A WARNING and never an error, and it
  // closes nothing: a validator that failed the build because nobody had re-read
  // a Domain since last spring would be switched off inside a week, and would
  // then stop reporting the errors it shares a run with. `review` is absent when
  // there is no clock to read against — a draft (`validateDraft`), or a
  // catalogue that would not load and so cannot set anyone's pace.
  if (review !== undefined && review.overdue) {
    findings.push(
      finding(
        "warning",
        "corpus.review-overdue",
        where,
        `the corpus is ${review.daysOverdue} day(s) past review: last read ${review.anchor}, due ${review.dueOn} on a ${review.intervalDays}-day interval`,
        `re-read it against its sources, then update corpusReviewedOn — ${
          review.pace === undefined
            ? "no Profession lists this Domain, so it runs at the base rate"
            : `${review.pace.name} (${review.pace.id}) sets the interval here`
        }; a second reviewer's signature is also a read`,
      ),
    );
  }

  return findings;
}
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
 * The industry catalogue's own rules (ADR 0012, re-cut by ADR 0017).
 *
 * `profession.high-risk-open` extends ADR 0004 — no actor verifies its own
 * output — to signing itself: a high-risk line may not be taught off a single
 * reviewer's word. ADR 0017 is what turned that from a rule about a missing
 * capability into a rule about a missing signature: the Domain CAN record a
 * second reviewer now, so this fires exactly when one it lists does not carry
 * one. `profession.reviewers-insufficient` is the same promise one level up:
 * the Owner's allocation of who may review a line is written in the asset, and
 * a high-risk line that lists Domains must name two different people to review
 * them. And `profession.unknown-domain` keeps the entry honest: a Profession may
 * only claim Domains that are actually signed.
 */
function validateProfessions(
  index: ProfessionIndex,
  domainIds: ReadonlySet<string>,
  coSignedDomainIds: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const profession of index.professions.values()) {
    const where = professionWhere(profession.id);
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
      // The rule reads the STATUS, so the validator and the door cannot disagree
      // about which lines are open: `closed` here means exactly what it means to
      // `highRiskRefusal` — a high-risk line with no two-reviewer backing.
      if (professionStatus(profession, domainIds, coSignedDomainIds) === "closed") {
        const unbacked = profession.domainIds.filter((id) => !coSignedDomainIds.has(id));
        findings.push(
          finding(
            "error",
            "profession.high-risk-open",
            where,
            `this is a high-risk line and ${unbacked.length} of its listed Domains (${unbacked.join(", ")}) do not carry two reviewers`,
            "counter-sign each with a second, different name (`npm run counter-sign -- <domain-id>`), or empty the `domains` list",
          ),
        );
      }

      // Who may review this line is the Owner's allocation, written down rather
      // than remembered (ADR 0017 decision 6). A high-risk line that lists
      // Domains and names fewer than two distinct people is a line nobody has
      // arranged to have read twice.
      const roster = new Set(
        profession.reviewers.map((name) => name.trim()).filter((name) => name !== "" && !isPlaceholder(name)),
      );
      if (roster.size < 2) {
        findings.push(
          finding(
            "error",
            "profession.reviewers-insufficient",
            where,
            `a high-risk Profession that lists Domains must name two different people to review it; \`reviewers\` names ${roster.size}`,
            "add a second reviewer to its `reviewers` roster — two names, not one name twice",
          ),
        );
      }
    }
  }

  return findings;
}

// ------------------------------------------------------------- competency rules

function professionWhere(id: string): string {
  return `professions/professions.md#${id}`;
}

function competencyWhere(id: string): string {
  return `professions/competencies.md#${id}`;
}

/**
 * The first prerequisite cycle in the file, as a path — or nothing.
 *
 * DFS with three colours rather than "does a topological sort succeed":
 * the finding has to name the loop, because "there is a cycle somewhere in
 * forty units" is a message the reader cannot act on. A cycle that a
 * learner walks is also the one defect here that makes the map meaningless
 * rather than merely incomplete, which is why it is worth the extra code.
 */
function findPrerequisiteCycle(index: CompetencyIndex): string[] | undefined {
  const colour = new Map<string, "open" | "done">();
  const path: string[] = [];

  const walk = (id: string, unit: Competency): string[] | undefined => {
    colour.set(id, "open");
    path.push(id);
    for (const prerequisite of unit.requires) {
      const next = index.competencies.get(prerequisite);
      // A missing rung is `competency.unknown-prerequisite`'s finding, not this one's.
      if (next === undefined) continue;
      const state = colour.get(prerequisite);
      if (state === "open") return [...path.slice(path.indexOf(prerequisite)), prerequisite];
      if (state === undefined) {
        const found = walk(prerequisite, next);
        if (found !== undefined) return found;
      }
    }
    path.pop();
    colour.set(id, "done");
    return undefined;
  };

  // Sorted, so two runs over the same file name the same cycle.
  for (const id of [...index.competencies.keys()].sort()) {
    if (colour.has(id)) continue;
    const unit = index.competencies.get(id);
    if (unit === undefined) continue;
    const found = walk(id, unit);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The Competency layer's rules (ADR 0015).
 *
 * These are the rules ADR 0015 called for, and each one is written against a
 * field the loader leaves OPTIONAL, so that it can actually fire. That is the
 * same choice `profession.missing-boundary` documents from the other side: a
 * rule the loader has already made unreachable is not a safeguard, it is a
 * comment that reads like one.
 *
 * Two of them are warnings rather than errors, and deliberately so.
 * `competency.orphan` fires when a Profession's units declare no prerequisites
 * AT ALL — not when some unit is unreferenced, because every route's last step
 * is unreferenced and a rule that fired there would flag correct material.
 * `profession.no-competency` fires only for a Profession that is already OPEN:
 * a `planned` Profession with no map is exactly what the empty half of the
 * ledger is for, and warning about it would be warning about the catalogue's
 * length (ADR 0002/0012).
 */
function validateCompetencies(
  index: CompetencyIndex,
  professions: ProfessionIndex,
  signedDomainIds: ReadonlySet<string>,
  coSignedDomainIds: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const units = [...index.competencies.values()];

  for (const unit of units) {
    const where = competencyWhere(unit.id);

    if (!professions.professions.has(unit.professionId)) {
      findings.push(
        finding(
          "error",
          "competency.unknown-profession",
          where,
          `profession ${JSON.stringify(unit.professionId)} is not in the catalogue`,
          "point it at a Profession declared with kind: profession, or add that Profession first",
        ),
      );
    }

    for (const domainId of unit.domainIds) {
      if (!signedDomainIds.has(domainId)) {
        findings.push(
          finding(
            "error",
            "competency.unknown-domain",
            where,
            `Domain ${JSON.stringify(domainId)} is not signed — a draft is not coverage`,
            "sign the Domain first, or take it off the list",
          ),
        );
      }
    }

    for (const prerequisite of unit.requires) {
      if (!index.competencies.has(prerequisite)) {
        findings.push(
          finding(
            "error",
            "competency.unknown-prerequisite",
            where,
            `prerequisite ${JSON.stringify(prerequisite)} is not a competency in this file`,
            "point it at a declared unit, or drop it — a route cannot run through a missing rung",
          ),
        );
      }
    }

    if (unit.boundary.trim() === "") {
      findings.push(
        finding(
          "error",
          "competency.missing-boundary",
          where,
          "no boundary — the learner cannot see what this unit will NOT be taught",
          "write the `boundary` line; it is the same honesty a Profession's own boundary carries",
        ),
      );
    }

    if (unit.beyond.length === 0) {
      findings.push(
        finding(
          "error",
          "competency.missing-beyond",
          where,
          "no `beyond` — this unit claims to be taught entirely here, which the map must state rather than imply",
          "write what this platform does not teach for this unit and what kind of thing teaches it; " +
            "「无——这一单元完全落在认知层」 is a real answer",
        ),
      );
    }
  }

  const cycle = findPrerequisiteCycle(index);
  if (cycle !== undefined) {
    findings.push(
      finding(
        "error",
        "competency.cycle",
        competencyWhere(cycle[0] ?? ""),
        `prerequisites form a cycle: ${cycle.join(" → ")}`,
        "break it — a learner cannot start a route that comes back to where it began",
      ),
    );
  }

  for (const profession of professions.professions.values()) {
    const own = units.filter((unit) => unit.professionId === profession.id);

    if (own.length === 0) {
      if (professionStatus(profession, signedDomainIds, coSignedDomainIds) === "open") {
        findings.push(
          finding(
            "warning",
            "profession.no-competency",
            professionWhere(profession.id),
            "this Profession is open — a signed Domain teaches it — but nothing says what it can teach",
            "write its competency units; until then the entry panel shows an empty map (ADR 0015)",
          ),
        );
      }
      continue;
    }

    if (!own.some((unit) => unit.requires.length > 0)) {
      findings.push(
        finding(
          "warning",
          "competency.orphan",
          professionWhere(profession.id),
          "these units declare no prerequisites at all, so the map is a list, not a route",
          "state the order with `requires`, or accept a map with no edges between its units",
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
    if (typeof value === "string" && isPlaceholder(value)) {
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
  /** Defaults to the repo's Competency asset (ADR 0015). */
  competenciesFile?: string;
  /**
   * The date the review clock is read against, as `YYYY-MM-DD`. Defaults to
   * today. An argument rather than a call to the clock (ADR 0018 decision 5):
   * a rule whose only test is "freeze the system clock and hope" is a rule that
   * gets tested once and then never again.
   */
  today?: string;
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
  const competenciesFile = options.competenciesFile ?? COMPETENCIES_FILE;

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

  // The co-signed ids, read off the Domains that actually loaded. A Domain that
  // will not load is counted as signed (its directory exists) and NOT co-signed
  // — the failing-closed reading `signaturesOnDisk` takes, so the validator and
  // both doors agree about which lines are open. The read is shared rather than
  // re-derived: one predicate, `hasTwoReviewers`, is the whole of "co-signed".
  const coSigned = coSignedDomainIds(loadedDomains.map(({ domain }) => domain));

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

  // ADR 0018: each Domain's clock, computed once by the same function
  // `npm run coverage` prints — so the warning a person reads here and the
  // 待复审 section there cannot describe one Domain two ways. With no catalogue
  // there is no pace to set, so there is no clock, and the rule stays quiet
  // rather than inventing a deadline (the `listed === undefined` reading above).
  const reviewById = new Map<string, ReviewEntry>(
    (professions.value === undefined
      ? []
      : reviewLedger(professions.value, loadedDomains.map(({ domain }) => domain), options.today ?? todayISO())
    ).map((entry) => [entry.domain.id, entry]),
  );

  for (const { domain, dir } of loadedDomains) {
    findings.push(...validateDomain(domain, dir, listed, reviewById.get(domain.id)));
  }

  if (professions.value !== undefined) {
    findings.push(...validateProfessions(professions.value, domainIds, coSigned));
  }

  // The Competency rules need both halves of the middle layer's contract: the
  // catalogue (does this Profession exist?) and the signature set (is this
  // Domain really signed?). With no catalogue every Profession reference is
  // unknowable, so the rules wait rather than reporting the whole file as
  // unknown — the same reasoning that keeps the Domain rules independent.
  const competencies = safely(competenciesFile, () => loadCompetencies(competenciesFile));
  if (competencies.value === undefined && competencies.problem !== undefined) {
    findings.push(competencies.problem);
  }
  if (competencies.value !== undefined && professions.value !== undefined) {
    findings.push(...validateCompetencies(competencies.value, professions.value, domainIds, coSigned));
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
