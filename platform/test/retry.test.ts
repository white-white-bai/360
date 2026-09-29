import test from "node:test";
import assert from "node:assert/strict";

import { findCheck } from "../src/checks/load.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { runTrial, summarise } from "../src/experiment/harness.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { PROBE_NO_CONCERN, cleanScript } from "../src/session/fixtures-apparatus.ts";

/**
 * (a)+(c): retry once, count every retry, and report a trial that still fails as INCOMPLETE.
 *
 * Three live runs each died on a different model slip — a copied placeholder, malformed
 * JSON — and each death destroyed everything measured up to that point. That measured the
 * model's typing rather than the teaching.
 */
const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const check = findCheck(expert.domain.checks, "C-gap");

const TRIAL = {
  expert,
  check,
  probeAnswers: ["时区是规则，偏移量是某一瞬间的结果", "我会说那段时间在这台机器上不存在"],
  terminalAnswer: check.expected,
};

/** The evaluator's replies, in order. The first ones are unusable on purpose. */
function withEvaluatorReplies(replies: string[]): ScriptedProvider {
  const script = cleanScript();
  script["probe-evaluator"] = replies;
  return new ScriptedProvider(script);
}

test("one unusable reply is retried, and the retry is counted", async () => {
  // The first evaluator call returns something no parser can read; the retry gets a good
  // one. Without the retry this trial would have died with the whole run.
  const result = await runTrial(
    "apparatus",
    withEvaluatorReplies(["{ this is not json", PROBE_NO_CONCERN, PROBE_NO_CONCERN]),
    TRIAL,
  );

  assert.equal(result.completed, true);
  assert.equal(result.retries, 1, "the extra call must be visible, not absorbed");
  assert.equal(result.incompleteReason, null);
});

test("a clean trial reports no retries at all", async () => {
  const result = await runTrial("apparatus", new ScriptedProvider(cleanScript()), TRIAL);
  assert.equal(result.completed, true);
  assert.equal(result.retries, 0);
});

test("two unusable replies in a row make the trial INCOMPLETE, not failed", async () => {
  const result = await runTrial(
    "apparatus",
    withEvaluatorReplies(["{ still not json", "also not json", PROBE_NO_CONCERN]),
    TRIAL,
  );

  assert.equal(result.completed, false);
  assert.equal(result.passed, false, "incomplete is not a pass");
  assert.match(result.incompleteReason ?? "", /twice/, "and it says what happened");
  assert.equal(result.retries, 1, "one retry was spent before giving up");
});

test("an incomplete trial is kept OUT of the pass rate, and still counted", async () => {
  // The whole point of reporting it separately: a condition that cannot run its trials is a
  // worse condition, and that has to be visible without being confused with teaching badly.
  const good = await runTrial("apparatus", new ScriptedProvider(cleanScript()), TRIAL);
  const broken = await runTrial(
    "apparatus",
    withEvaluatorReplies(["{ nope", "still nope", PROBE_NO_CONCERN]),
    TRIAL,
  );

  const summary = summarise("apparatus", [good, broken]);
  assert.equal(summary.trials, 2, "both are reported");
  assert.equal(summary.incomplete, 1, "one could not be run");
  assert.equal(summary.completed, 1, "and only one is a measurement");
  assert.equal(summary.passRate, 1, "the rate is over the trial that ran, not over both");
  assert.equal(summary.retries, 1);
});

test("a failure that is NOT an unusable reply still aborts the run", async () => {
  // Deliberately no script for the verifier, so the provider throws a plain Error. Folding
  // that into "incomplete" would hide a fault behind a category that looks like bad luck.
  const script = cleanScript();
  delete script["grounding-verifier"];

  await assert.rejects(
    () => runTrial("apparatus", new ScriptedProvider(script), TRIAL),
    /no scripted response/,
  );
});
