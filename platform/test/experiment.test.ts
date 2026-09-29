import test from "node:test";
import assert from "node:assert/strict";

import { findCheck } from "../src/checks/load.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { parseAssertionList } from "../src/assertions/parse.ts";
import type { TrialResult } from "../src/experiment/harness.ts";
import { compare, runTrial, summarise } from "../src/experiment/harness.ts";
import {
  apparatusTrialScript,
  baselineTrialScript,
  EXPERIMENT_LIST,
  PROFILES,
} from "../src/experiment/fixtures-experiment.ts";

const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const check = findCheck(expert.domain.checks, "C-gap");
// The second sitting gets a DIFFERENT asset, so a pass after remediation cannot be
// recall of the question the learner just failed.
const retakeCheck = findCheck(expert.domain.checks, "C-overlap");
const list = parseAssertionList(EXPERIMENT_LIST, "time-zones");

async function trial(condition: "baseline" | "apparatus", profileIndex: number): Promise<TrialResult> {
  const profile = PROFILES[profileIndex] as (typeof PROFILES)[number];
  const provider = new ScriptedProvider(
    condition === "baseline" ? baselineTrialScript() : apparatusTrialScript(profile),
  );
  return runTrial(condition, provider, {
    expert,
    check,
    retakeCheck,
    list,
    probeAnswers: profile.probeAnswers,
    terminalAnswer: profile.terminalAnswer,
    retryAnswer: profile.retryAnswer,
    selfAssessment: profile.selfAssessment,
  });
}

test("the baseline is the apparatus with every piece switched off", async () => {
  const baseline = await trial("baseline", 0);
  const apparatus = await trial("apparatus", 0);

  assert.deepEqual(baseline.disabled, ["semanticVerify", "probes", "challenger"]);
  assert.deepEqual(apparatus.disabled, []);
  assert.equal(apparatus.probeConcerns >= 0, true);
});

test("both conditions are taught the SAME claims, or the comparison means nothing", async () => {
  const baseline = await trial("baseline", 0);
  const apparatus = await trial("apparatus", 0);

  // This is why the harness injects the list rather than letting each condition
  // generate one: a difference in outcome would otherwise be explainable as the
  // two conditions having taught different lessons.
  assert.equal(baseline.listInjected, true);
  assert.equal(apparatus.listInjected, true);
  assert.deepEqual(baseline.disabled.length > 0, true);
});

test("the baseline costs fewer calls, because it does fewer things", async () => {
  const baseline = await trial("baseline", 1);
  const apparatus = await trial("apparatus", 1);
  assert.ok(
    apparatus.calls >= baseline.calls,
    `apparatus ${apparatus.calls} calls vs baseline ${baseline.calls}`,
  );
});

test("a probe concern summons the Challenger in the apparatus and nowhere in the baseline", async () => {
  const baseline = await trial("baseline", 1);
  const apparatus = await trial("apparatus", 1);

  assert.equal(baseline.challengeFired, false, "the baseline has no Challenger to summon");
  assert.equal(apparatus.challengeFired, true, "the catalogued misconception should trigger one");
  assert.equal(apparatus.probeConcerns, 1);
});

test("the illusion gap is self-assessment minus the measured result", async () => {
  const passedFirstTime = await trial("apparatus", 0);
  assert.equal(passedFirstTime.passed, true);
  assert.equal(passedFirstTime.illusionGap, 0.9 - 1, "felt 90%, did 100% — under-confident");

  // Profile 2 stops after failing, so no retake carries them.
  const writtenOff = await trial("apparatus", 2);
  assert.equal(writtenOff.passed, false);
  assert.equal(writtenOff.illusionGap, 0.4 - 0, "felt 40%, did 0%");

  // Profile 1 gets there only on the second sitting — and the gap is still computed
  // against the measured result, not against how the first attempt went.
  const recovered = await trial("apparatus", 1);
  assert.equal(recovered.passed, true);
  assert.equal(recovered.retaken, true);
  assert.equal(recovered.illusionGap, 0.8 - 1, "felt 80%, did 100%");
});

test("summarise aggregates per condition, not across them", async () => {
  const trials = [await trial("baseline", 0), await trial("apparatus", 0)];
  const summary = summarise("apparatus", trials);
  assert.equal(summary.trials, 1);
  assert.equal(summary.passed, 1);
  assert.equal(summary.passRate, 1);
  assert.equal(summarise("baseline", trials).trials, 1);
});

test("too few trials is inconclusive rather than a conclusion", async () => {
  const trials = [await trial("baseline", 0), await trial("apparatus", 0)];
  const result = compare(trials);
  assert.equal(result.verdict, "inconclusive");
  assert.match(result.reason, /not enough to say anything/);
});

test("the retake lets the apparatus recover a learner the baseline writes off", async () => {
  // This replaces a test named KNOWN GAP, which asserted that the retry could not
  // move the measured outcome at all. It could not: the terminal check was graded
  // before the Challenger ran. ADR 0002 makes passing the end condition, so there is
  // now a second sitting, and it is the one that counts.
  const trials: TrialResult[] = [];
  for (let index = 0; index < PROFILES.length; index += 1) {
    trials.push(await trial("baseline", index));
    trials.push(await trial("apparatus", index));
  }

  const result = compare(trials, 3);
  assert.equal(result.verdict, "apparatus-better", result.reason);
  assert.equal(
    result.baseline.passRate,
    1 / 3,
    "only the learner who got it first time passes unaided — the baseline never re-teaches",
  );
  assert.ok(result.apparatus.passRate > result.baseline.passRate);
});

test("a learner who stops after failing is not carried by the retake", async () => {
  const profile = PROFILES[2] as (typeof PROFILES)[number];
  assert.equal(profile.retryAnswer, undefined, "this profile is meant to stop");

  const result = await trial("apparatus", 2);
  assert.equal(result.retaken, false);
  assert.equal(result.passed, false, "leaving no second answer must not read as passing");
});

test("the baseline does not retake, because it never re-teaches", async () => {
  const result = await trial("baseline", 1);
  assert.equal(result.retaken, false);
  assert.equal(result.passed, false);
});
