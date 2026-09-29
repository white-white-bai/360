import test from "node:test";
import assert from "node:assert/strict";

import { gradeObjectively } from "../src/checks/grade.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { catalogue } from "../src/experts/catalogue.ts";

/**
 * Invariants that must hold for EVERY Domain, not just the one that was here first.
 *
 * A Domain is a piece of authored content, and content has failure modes code review does
 * not catch: a check whose own expected answer fails its own grader, or a diagnosis
 * phrase that also matches the correct answer. Both are silent — the assets load, the
 * session runs, and the measurement is quietly wrong.
 */
const library = loadLibrary();
const domains = [...library.domains.values()];

test("there is more than one Domain, so the platform is not a single-lesson program", () => {
  // Not a style preference. With one Domain, everything that looks general — the entry
  // flow, the check format, the blackboard vocabulary — could be shaped around one
  // lesson without anything noticing. The second Domain is the cheapest test of that.
  assert.ok(domains.length >= 2, `domains loaded: ${domains.map((d) => d.id).join(", ")}`);
});

test("every Domain is reachable from the entry flow", () => {
  const offered = catalogue(library).domains.map((option) => option.id);
  for (const domain of domains) {
    assert.ok(offered.includes(domain.id), `${domain.id} cannot be chosen`);
  }
});

test("every check passes its own expected answer", () => {
  // The check that fails its own answer is broken in the one way the author cannot see:
  // they know what they meant, and the grader disagrees. This runs on every Domain so a
  // new one cannot be added without being gradeable.
  for (const domain of domains) {
    for (const check of domain.checks) {
      const verdict = gradeObjectively(check, check.expected);
      assert.equal(
        verdict.verdict,
        "pass",
        `${domain.id}/${check.id}: the expected answer does not pass the grader — expected ${JSON.stringify(check.expected)}`,
      );
    }
  }
});

test("no diagnosis phrase appears in its own expected answer", () => {
  // A phrase matching both the right answer and the wrong one diagnoses nothing, and it
  // does so silently: the entry still looks reachable to the validator while firing on
  // learners who were correct. Every diagnosis must therefore be absent from `expected`.
  for (const domain of domains) {
    for (const check of domain.checks) {
      for (const diagnosis of check.diagnoses) {
        assert.ok(
          !check.expected.includes(diagnosis.marker),
          `${domain.id}/${check.id}: the diagnosis marker ${JSON.stringify(diagnosis.marker)} also appears in the ` +
            "expected answer, so a correct learner would be diagnosed",
        );
      }
    }
  }
});

test("every misconception is reachable from some check in its own Domain", () => {
  // The validator has this rule too; this is the same requirement stated where a reader
  // of the tests will meet it. An entry nothing can diagnose implies coverage that does
  // not exist.
  for (const domain of domains) {
    const diagnosed = new Set(domain.checks.flatMap((check) => check.diagnoses.map((d) => d.misconceptionId)));
    for (const misconception of domain.misconceptions) {
      assert.ok(diagnosed.has(misconception.id), `${domain.id}: ${misconception.id} cannot be diagnosed`);
    }
  }
});

test("a Domain's terminal and transfer assets are different questions", () => {
  // If transfer used the terminal check it would be retention wearing its name: asking
  // the question they were just taught the answer to measures recall.
  for (const domain of domains) {
    const transfer = domain.checks.filter((check) => check.id.startsWith("T-"));
    const terminal = domain.checks.filter((check) => !check.id.startsWith("T-"));
    assert.ok(terminal.length >= 1, `${domain.id} has no terminal check`);
    for (const check of transfer) {
      assert.ok(!terminal.includes(check), `${domain.id}/${check.id} is both`);
    }
  }
});

test("the second Domain composes into a working expert", () => {
  const domain = domains.find((candidate) => candidate.id === "utf8-and-length");
  assert.ok(domain !== undefined, "the utf8 Domain must load");

  const persona = [...library.personas.values()][0];
  const style = [...library.styles.values()][0];
  assert.ok(persona !== undefined && style !== undefined);

  const expert = composeExpert(library, persona.id, style.id, "utf8-and-length");
  assert.equal(expert.domain.id, "utf8-and-length");
  assert.ok(expert.domain.corpus.passages.length >= 5, "the corpus must be substantive");
  assert.ok(expert.domain.glossary.neverTranslate.length >= 3, "and it must pin its identifiers");
});
