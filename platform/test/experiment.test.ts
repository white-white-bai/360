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
const list = parseAssertionList(EXPERIMENT_LIST, "time-zones");

async function trial(condition: "baseline" | "apparatus", profileIndex: number): Promise<TrialResult> {
  const profile = PROFILES[profileIndex] as (typeof PROFILES)[number];
  const provider = new ScriptedProvider(
    condition === "baseline" ? baselineTrialScript() : apparatusTrialScript(profile),
  );
  return runTrial(condition, provider, {
    expert,
    check,
    list,
    probeAnswers: profile.probeAnswers,
    terminalAnswer: profile.terminalAnswer,
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
  const passed = await trial("apparatus", 0);
  assert.equal(passed.passed, true);
  assert.equal(passed.illusionGap, 0.9 - 1);

  const failed = await trial("apparatus", 1);
  assert.equal(failed.passed, false);
  assert.equal(failed.illusionGap, 0.8 - 0);
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

test("KNOWN GAP: the retry cannot yet move the measured outcome", async () => {
  // The terminal check is graded BEFORE the Challenger and the retry, so a learner
  // who fails and is then re-taught is still recorded as having failed. ADR 0002
  // says "class is over when the checks have PASSED", which implies a retake.
  //
  // This test asserts the current behaviour so the gap is visible rather than
  // described in a comment. When the retake is implemented, the four trials below
  // should be able to differ — and this test will fail, which is the reminder to
  // replace it with a real assertion.
  const trials: TrialResult[] = [];
  for (let index = 0; index < PROFILES.length; index += 1) {
    trials.push(await trial("baseline", index));
    trials.push(await trial("apparatus", index));
  }

  const result = compare(trials, 3);
  assert.equal(result.verdict, "no-difference");
  assert.equal(result.baseline.passRate, result.apparatus.passRate);
  assert.match(result.reason, /should be deleted/i);
});
