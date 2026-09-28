import test from "node:test";
import assert from "node:assert/strict";

import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { describeExpert } from "../src/experts/types.ts";

/**
 * Integration invariants over the REAL assets.
 *
 * Most of this is the Phase 3 validator's job, done here in miniature so that
 * Phase 1's assets cannot drift into a state the session would happily run on.
 * The distinction matters for ADR 0001: if the material is mis-configured, the
 * ablation experiment becomes uninterpretable, so these are not style checks.
 */
const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const domain = expert.domain;

test("the library loads and composes the three axes independently", () => {
  assert.ok(library.personas.size >= 2, "personas are cheap, so there should be more than one");
  assert.ok(library.styles.size >= 2, "styles are separable, so there should be more than one");
  assert.equal(describeExpert(expert), "耐心的讲解者 / 时间戳、时区与夏令时 / 类比密集");
});

test("every corpus passage carries provenance", () => {
  for (const passage of domain.corpus.passages) {
    assert.ok(passage.source.trim().length > 0, `${passage.id} has an empty source`);
  }
});

test("the corpus is in the source language, the delivery is not", () => {
  // ADR 0004/0018: grounding traces to source-language passages. If the corpus
  // were a translation, tracing to it would verify the wrong artefact.
  const ascii = domain.corpus.passages.map((p) => p.text).join(" ");
  assert.match(ascii, /[A-Za-z]{4,}/, "corpus text should be English");
  assert.equal(domain.deliveryLanguage, "zh");
});

test("every check grounding id resolves to a real passage", () => {
  for (const check of domain.checks) {
    for (const id of check.grounding) {
      assert.ok(
        domain.corpus.passages.some((p) => p.id === id),
        `check ${check.id} grounds on unknown passage ${id}`,
      );
    }
  }
});

test("every diagnosed misconception exists", () => {
  for (const check of domain.checks) {
    for (const diagnosis of check.diagnoses) {
      assert.ok(
        domain.misconceptions.some((m) => m.id === diagnosis.misconceptionId),
        `check ${check.id} diagnoses unknown misconception ${diagnosis.misconceptionId}`,
      );
    }
  }
});

test("every misconception is reachable by at least one diagnosis", () => {
  // ADR 0009: a catalogued misconception nothing can detect is a catalogue entry
  // that will never be refuted. This is the check the Phase 3 validator formalises.
  const reachable = new Set(domain.checks.flatMap((c) => c.diagnoses.map((d) => d.misconceptionId)));
  for (const misconception of domain.misconceptions) {
    assert.ok(reachable.has(misconception.id), `${misconception.id} is unreachable`);
  }
});

test("the glossary pins renderings and separates identifiers", () => {
  assert.ok(Object.keys(domain.glossary.terms).length >= 5);
  assert.ok(domain.glossary.neverTranslate.includes("UTC"));
  for (const [term, rendering] of Object.entries(domain.glossary.terms)) {
    assert.ok(rendering.trim().length > 0, `${term} has an empty rendering`);
    assert.ok(
      !domain.glossary.neverTranslate.includes(rendering),
      `${term} renders to ${rendering}, which is in neverTranslate`,
    );
  }
});

test("the domain owner is still a placeholder, and that is recorded rather than hidden", () => {
  // ADR 0006 requires a named person. Until one is assigned this asset is not
  // usable for the acceptance experiment, so the test asserts the placeholder
  // explicitly — it will fail the day someone assigns a real name, which is the
  // reminder to replace this assertion with a real one.
  assert.equal(domain.owner, "REPLACE_WITH_A_NAMED_PERSON");
});
