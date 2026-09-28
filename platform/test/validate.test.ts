import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateRepo } from "../src/validate/rules.ts";
import type { Finding } from "../src/validate/types.ts";

/**
 * The validator is tested the way a validator should be: build deliberately
 * broken assets and assert the specific code that comes back.
 *
 * Asserting `ok === false` would be worthless — it passes for any defect
 * anywhere. The point is that each rule fires for its own reason and stays quiet
 * otherwise, which is also what keeps the rules from overlapping into noise.
 */

function persona(id: string): string {
  return `---\nid: ${id}\nname: ${id}\nstance: s\nregister: r\n---\n`;
}

function style(id: string): string {
  return [
    "---",
    `id: ${id}`,
    `name: ${id}`,
    "analogyDensity: low",
    "order: conclusion-first",
    "abstraction: concrete",
    "exampleType: e",
    "---",
  ].join("\n");
}

/** Two of each, so tests are not accidentally measuring the entry-choice rule. */
function seedLibrary(root: string): void {
  for (const id of ["a", "b"]) {
    writeFileSync(join(root, "personas", `${id}.md`), persona(id), "utf8");
    writeFileSync(join(root, "styles", `${id}.md`), style(id), "utf8");
  }
}

function tmpRoot(t: { after: (fn: () => void) => void }, options: { seed?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "atp-validate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "personas"), { recursive: true });
  mkdirSync(join(root, "styles"), { recursive: true });
  mkdirSync(join(root, "domains"), { recursive: true });
  if (options.seed !== false) seedLibrary(root);
  return root;
}

const DEFAULTS = {
  meta: [
    "---",
    "id: d",
    "name: Test domain",
    "owner: A Named Person",
    "deliveryLanguage: zh",
    "sources:",
    "  - RFC 3339 — https://www.rfc-editor.org/rfc/rfc3339",
    "---",
  ].join("\n"),
  corpus: [
    "## P-one",
    "",
    "source: RFC 3339 §4.2 — https://www.rfc-editor.org/rfc/rfc3339#section-4.2",
    "",
    "An offset is signed, and wall-clock readings are stated relative to UTC.",
  ].join("\n"),
  misconceptions: ["## M-one", "", "name: a thing", "wrongModel: they think x", "refutation: it is y"].join("\n"),
  checks: [
    "## C-one",
    "",
    "prompt: p",
    "expected: e",
    "grounding:",
    "  - P-one",
    "diagnoses:",
    "  - wrong => M-one",
  ].join("\n"),
  glossary: [
    "---",
    "neverTranslate:",
    "  - UTC",
    "---",
    "",
    "## offset",
    "rendering: 偏移量",
    "",
    "## wall clock",
    "rendering: 本地墙上时间",
  ].join("\n"),
};

function writeDomain(root: string, files: Partial<typeof DEFAULTS> & { id?: string } = {}): void {
  const dir = join(root, "domains", files.id ?? "d");
  mkdirSync(dir, { recursive: true });
  for (const name of ["meta", "corpus", "misconceptions", "checks", "glossary"] as const) {
    const content =
      files[name] ?? (name === "meta" ? DEFAULTS.meta.replace("id: d", `id: ${files.id ?? "d"}`) : DEFAULTS[name]);
    writeFileSync(join(dir, `${name}.md`), content, "utf8");
  }
}

function run(root: string): { codes: string[]; errors: number; warnings: number } {
  const report = validateRepo({
    personasDir: join(root, "personas"),
    stylesDir: join(root, "styles"),
    domainsDir: join(root, "domains"),
  });
  return {
    codes: report.findings.map((f: Finding) => f.code),
    errors: report.errors,
    warnings: report.warnings,
  };
}

test("a well-formed library and domain produce no errors", (t) => {
  const root = tmpRoot(t);
  writeDomain(root);
  const result = run(root);
  assert.equal(result.errors, 0, `unexpected errors: ${result.codes.join(", ")}`);
});

test("an unfilled owner is an error — rights and accountability are the same thing", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { meta: DEFAULTS.meta.replace("A Named Person", "REPLACE_WITH_A_NAMED_PERSON") });
  assert.ok(run(root).codes.includes("domain.owner-missing"));
});

test("a corpus that declares itself unverified is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { corpus: `<!--\nNOT YET HUMAN-VERIFIED.\n-->\n\n${DEFAULTS.corpus}` });
  assert.ok(run(root).codes.includes("corpus.review-outstanding"));
});

test("an asset that will not parse yields a finding, not a stack trace", (t) => {
  // The loaders are strict on purpose — a session must never be handed a
  // malformed Domain — but the validator's job is to describe what is wrong, and
  // a throw would hide every other finding behind whichever file came first.
  const root = tmpRoot(t);
  writeDomain(root, { corpus: "## P-one\n\n\nAn offset is signed and UTC is the reference." });
  const result = run(root);
  assert.ok(result.codes.includes("asset.unloadable"), `got: ${result.codes.join(", ")}`);
});

test("a source that is present but unfilled is an error", (t) => {
  // This is the case the parser cannot catch: `source: TODO` loads perfectly.
  const root = tmpRoot(t);
  writeDomain(root, { corpus: "## P-one\n\nsource: TODO\n\nAn offset is signed, wall-clock, UTC." });
  assert.ok(run(root).codes.includes("corpus.provenance-placeholder"));
});

test("a source that names no document is a warning, not an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { corpus: "## P-one\n\nsource: somewhere\n\nAn offset is signed, wall-clock readings, UTC." });
  const result = run(root);
  assert.ok(result.codes.includes("corpus.provenance-vague"));
  assert.equal(result.errors, 0, "a vague source is a judgement call, so it must not block");
});

test("hyphens are typography: `wall clock` matches `wall-clock`", (t) => {
  const root = tmpRoot(t);
  writeDomain(root);
  // The glossary says `wall clock`, the corpus writes `wall-clock`. If this were
  // an exact substring match the rule would fire on a non-problem — and a
  // validator that cries wolf gets switched off.
  assert.ok(!run(root).codes.includes("glossary.term-unused"));
});

test("a glossary term the material never uses is reported", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { glossary: DEFAULTS.glossary.replace("offset", "sideways") });
  assert.ok(run(root).codes.includes("glossary.term-unused"));
});

test("an identifier nothing mentions is dead configuration", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { corpus: DEFAULTS.corpus.replace(" relative to UTC", "") });
  assert.ok(run(root).codes.includes("glossary.identifier-unused"));
});

test("two terms sharing one rendering is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { glossary: DEFAULTS.glossary.replace("rendering: 本地墙上时间", "rendering: 偏移量") });
  assert.ok(run(root).codes.includes("glossary.rendering-conflict"));
});

test("a rendering that collides with a never-translate identifier is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { glossary: DEFAULTS.glossary.replace("rendering: 偏移量", "rendering: UTC") });
  assert.ok(run(root).codes.includes("glossary.rendering-is-identifier"));
});

test("a check grounding on a passage that does not exist is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { checks: DEFAULTS.checks.replace("- P-one", "- P-ghost") });
  assert.ok(run(root).codes.includes("check.grounding-unresolved"));
});

test("a check diagnosing a misconception that does not exist is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { checks: DEFAULTS.checks.replace("=> M-one", "=> M-ghost") });
  assert.ok(run(root).codes.includes("check.diagnosis-unknown"));
});

test("a misconception no check can diagnose is an error, not a silent gap", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, {
    misconceptions: `${DEFAULTS.misconceptions}\n\n## M-orphan\n\nname: orphan\nwrongModel: x\nrefutation: y\n`,
  });
  const result = run(root);
  assert.ok(result.codes.includes("misconception.unreachable"));
  assert.ok(result.errors > 0, "an unrefutable catalogue entry must block");
});

test("a check grounded on nothing is an error", (t) => {
  const root = tmpRoot(t);
  writeDomain(root, { checks: DEFAULTS.checks.replace("grounding:\n  - P-one\n", "") });
  assert.ok(run(root).codes.includes("check.ungrounded"));
});

test("ADR 0007: no voice cannot compose an Expert, and one is not a choice", (t) => {
  const root = tmpRoot(t, { seed: false });
  writeDomain(root);

  const empty = run(root);
  assert.ok(empty.codes.includes("library.no-personas"), `got: ${empty.codes.join(", ")}`);
  assert.ok(empty.codes.includes("library.no-styles"));
  assert.ok(empty.errors > 0, "nothing to compose an Expert from must block");

  // One of each is enough to compose an Expert, but entry has nothing to offer.
  writeFileSync(join(root, "personas", "only.md"), persona("only"), "utf8");
  writeFileSync(join(root, "styles", "only.md"), style("only"), "utf8");
  const one = run(root);
  assert.ok(one.codes.includes("library.no-persona-choice"), `got: ${one.codes.join(", ")}`);
  assert.ok(one.codes.includes("library.no-style-choice"));
  assert.equal(one.errors, 0, "one voice is a poor library, not a broken one");
});

test("two voices satisfy entry and raise no library finding", (t) => {
  const root = tmpRoot(t, { seed: false });
  writeDomain(root);
  seedLibrary(root);
  const result = run(root);
  assert.equal(result.errors, 0, `unexpected errors: ${result.codes.join(", ")}`);
  assert.ok(
    !result.codes.some((code) => code.startsWith("library.no-")),
    `unexpected library findings: ${result.codes.join(", ")}`,
  );
});
