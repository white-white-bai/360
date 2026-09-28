import test from "node:test";
import assert from "node:assert/strict";

import { gradeObjectively, normaliseAnswer } from "../src/checks/grade.ts";
import type { UnderstandingCheck } from "../src/checks/types.ts";
import { offsetSteps, parseExplanation } from "../src/session/explanation.ts";

const check: UnderstandingCheck = {
  id: "C-one",
  prompt: "prompt",
  expected: "这个本地时间不存在",
  grounding: [],
  diagnoses: [{ marker: "正常存在", misconceptionId: "M-dst" }],
};

test("an exact answer passes", () => {
  assert.equal(gradeObjectively(check, "这个本地时间不存在").verdict, "pass");
});

test("normalisation folds width, whitespace and ASCII case — and nothing else", () => {
  assert.equal(normaliseAnswer("  Hello   World "), "hello world");
  assert.equal(normaliseAnswer("２０２６"), "2026", "full-width digits from a Chinese IME fold to ASCII");
});

test("a near-miss is still a failure: no stemming, no synonyms", () => {
  // The point is that an objective check does not quietly become a judgement
  // call. "不存在" vs "不存在了" is a difference the learner can see.
  assert.equal(gradeObjectively(check, "这个本地时间不存在了").verdict, "fail");
});

test("a failure matching a catalogue marker is diagnosed", () => {
  const verdict = gradeObjectively(check, "这个本地时间正常存在，只是偏移量不同");
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.diagnosis?.misconceptionId, "M-dst");
});

test("an unanticipated failure is still a failure, with no invented diagnosis", () => {
  const verdict = gradeObjectively(check, "我猜是下午两点半");
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.diagnosis?.misconceptionId, null);
  assert.match(verdict.diagnosis?.reason ?? "", /应先问学习者为什么这样回答/);
});

test("an empty answer fails without being treated as a misconception", () => {
  const verdict = gradeObjectively(check, "   ");
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.diagnosis?.reason, "没有作答");
});

test("a correct answer is never diagnosed as a misconception", () => {
  // The marker "正常存在" is not in the expected answer, but a sloppier
  // implementation that checked markers before the expected value would still
  // get this wrong if the two ever overlapped. Order matters, so pin it.
  const overlapping: UnderstandingCheck = {
    ...check,
    expected: "正常存在是不可能的",
    diagnoses: [{ marker: "正常存在", misconceptionId: "M-dst" }],
  };
  assert.equal(gradeObjectively(overlapping, "正常存在是不可能的").verdict, "pass");
});

test("explanations interleave narration and events", () => {
  const explanation = parseExplanation(
    JSON.stringify({
      steps: [{ say: "先说结论" }, { event: { kind: "text", id: "a", body: "结论" } }, { say: "为什么" }],
    }),
  );
  assert.equal(explanation.steps.length, 3);
  assert.equal(explanation.steps[1]?.event?.at, 1, "position comes from step order, not the model");
});

test("an unknown event kind is refused at the boundary", () => {
  assert.throws(
    () => parseExplanation(JSON.stringify({ steps: [{ event: { kind: "screenshot", id: "a" } }] })),
    /vocabulary is closed/,
  );
});

test("a step must carry exactly one of `say` or `event`", () => {
  assert.throws(
    () => parseExplanation(JSON.stringify({ steps: [{ say: "x", event: { kind: "text", id: "a", body: "b" } }] })),
    /exactly one of/,
  );
  assert.throws(() => parseExplanation(JSON.stringify({ steps: [{}] })), /exactly one of/);
});

test("an empty `say` is refused", () => {
  assert.throws(() => parseExplanation(JSON.stringify({ steps: [{ say: "   " }] })), /empty `say`/);
});

test("non-JSON output is refused with the parse error attached", () => {
  assert.throws(() => parseExplanation("I would be happy to help!"), /not valid JSON/);
});

test("offsetting shifts events onto the log timeline without disturbing narration", () => {
  const explanation = parseExplanation(
    JSON.stringify({ steps: [{ say: "a" }, { event: { kind: "text", id: "x", body: "b" } }] }),
  );
  const shifted = offsetSteps(explanation, 10);
  assert.equal(shifted.steps[0]?.event, undefined);
  assert.equal(shifted.steps[1]?.event?.at, 11);
});
