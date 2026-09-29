import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DomainPlan, Pedagogy, SelectedPassage } from "./contracts.ts";
import type { FetchedDocument } from "./fetch.ts";

/**
 * Rendering the draft's files (ADR 0010).
 *
 * The grammar is not invented here: `meta.md`, `corpus.md`, `misconceptions.md`, `glossary.md`
 * and `checks.md` are written in exactly the shapes `util/frontmatter.ts`, `util/sections.ts`
 * and the loaders parse — so a draft that looks right also LOADS right, and the validator's
 * opinion of it is about content rather than about formatting.
 */

/** Every quoted line carries the marker, so a passage containing `## ` cannot open a section. */
function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line.trim()}`))
    .join("\n");
}

/**
 * The two findings a draft is EXPECTED to have: the signature has not happened yet (ADR 0010).
 *
 * `writeDraftFiles` is what places the `TODO`s these codes point at, so the meaning of "pending"
 * lives next to the thing that creates it. Anything ELSE reported as an error means the draft
 * is broken rather than unsigned.
 */
export const PENDING_CODES: readonly string[] = ["corpus.review-missing", "domain.owner-missing"];

export function renderMeta(plan: DomainPlan, urls: readonly string[]): string {
  return [
    "---",
    `id: ${plan.id}`,
    `name: ${plan.name}`,
    // The pending signature (ADR 0010). `TODO` is a placeholder the validator already knows
    // how to flag, so the draft's expected failure mode is exactly "nobody has signed this".
    "owner: TODO",
    "corpusReviewedBy: TODO",
    "corpusReviewedOn: TODO",
    "deliveryLanguage: zh",
    "sources:",
    ...urls.map((url) => `  - ${url}`),
    "---",
    "",
    `边界：${plan.boundary}`,
    "",
  ].join("\n");
}

export function renderCorpus(passages: readonly SelectedPassage[], documents: readonly FetchedDocument[]): string {
  return passages
    .map((passage) => {
      const document = documents[passage.sourceIndex] as FetchedDocument;
      return [
        `## ${passage.id}`,
        `source: ${passage.citation} — ${document.url}`,
        blockquote(passage.quote),
        "",
      ].join("\n");
    })
    .join("\n");
}

export function renderMisconceptions(pedagogy: Pedagogy): string {
  return pedagogy.misconceptions
    .map((entry) =>
      [
        `## ${entry.id}`,
        `name: ${entry.name}`,
        `wrongModel: ${entry.wrongModel}`,
        `refutation: ${entry.refutation}`,
        "",
      ].join("\n"),
    )
    .join("\n");
}

export function renderGlossary(pedagogy: Pedagogy): string {
  const header =
    pedagogy.glossary.neverTranslate.length === 0
      ? ["---", "---"]
      : ["---", "neverTranslate:", ...pedagogy.glossary.neverTranslate.map((id) => `  - ${id}`), "---"];
  const body = pedagogy.glossary.terms.map((entry) => [`## ${entry.term}`, `rendering: ${entry.rendering}`, ""].join("\n"));
  return [...header, "", ...body].join("\n");
}

export function renderChecks(pedagogy: Pedagogy): string {
  return pedagogy.checks
    .map((check) =>
      [
        `## ${check.id}`,
        `prompt: ${check.prompt}`,
        `expected: ${check.expected}`,
        "grounding:",
        ...check.grounding.map((id) => `  - ${id}`),
        "diagnoses:",
        ...check.diagnoses.map((entry) => `  - ${entry.phrase} => ${entry.misconceptionId}`),
        "",
      ].join("\n"),
    )
    .join("\n");
}

/** A file name a person can read, from a URL. */
function sourceSlug(url: string, index: number): string {
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${String(index).padStart(2, "0")}-${slug === "" ? "source" : slug}.txt`;
}

export interface DraftFiles {
  plan: DomainPlan;
  documents: readonly FetchedDocument[];
  passages: readonly SelectedPassage[];
  pedagogy: Pedagogy;
}

/**
 * Write the whole draft, including the fetched sources themselves.
 *
 * The raw texts stay on disk so the review is offline-checkable: a reviewer can compare every
 * quote against exactly the bytes the kernel checked it against, rather than against whatever
 * the URL serves on the day of the review.
 */
export function writeDraftFiles(dir: string, files: DraftFiles): void {
  const sourcesDir = join(dir, "sources");
  mkdirSync(sourcesDir, { recursive: true });

  writeFileSync(join(dir, "meta.md"), renderMeta(files.plan, files.documents.map((document) => document.url)), "utf8");
  writeFileSync(join(dir, "corpus.md"), renderCorpus(files.passages, files.documents), "utf8");
  writeFileSync(join(dir, "misconceptions.md"), renderMisconceptions(files.pedagogy), "utf8");
  writeFileSync(join(dir, "glossary.md"), renderGlossary(files.pedagogy), "utf8");
  writeFileSync(join(dir, "checks.md"), renderChecks(files.pedagogy), "utf8");

  const manifest = files.documents.map((document, index) => {
    const name = sourceSlug(document.url, index);
    writeFileSync(join(sourcesDir, name), document.text, "utf8");
    return {
      index,
      requested: document.requested,
      url: document.url,
      fetchedAt: document.fetchedAt,
      mediaType: document.mediaType,
      sha256: document.sha256,
      bytes: document.bytes,
      text: `sources/${name}`,
    };
  });
  writeFileSync(join(dir, "sources.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
