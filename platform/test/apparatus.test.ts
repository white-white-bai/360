import test from "node:test";
import assert from "node:assert/strict";

import { findCheck } from "../src/checks/load.ts";
import { deserializeLog, serializeLog } from "../src/events/log.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { CANNOT_ANSWER, runApparatusSession } from "../src/session/apparatus.ts";
import {
  ANSWER_DECLINE,
  ANSWER_NARRATION,
  ANSWER_PLAN,
  ANSWER_VERDICTS_UNSUPPORTED,
  APPARATUS_LIST,
  APPARATUS_NARRATION,
  APPARATUS_PROBES,
  APPARATUS_RETRY,
  APPARATUS_VERDICTS_OK,
  answeredQuestionScript,
  cleanScript,
  misconceptionScript,
} from "../src/session/fixtures-apparatus.ts";

const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const check = findCheck(expert.domain.checks, "C-gap");

const PROBE_ANSWERS = ["时区是规则，偏移量是某一瞬间的结果", "我会说那段时间在这台机器上根本不存在"];

function run(script: Record<string, string | string[]>, terminalAnswer: string, probeAnswers = PROBE_ANSWERS) {
  return runApparatusSession(new ScriptedProvider(script), {
    expert,
    check,
    probeAnswers,
    terminalAnswer,
    sessionId: "t",
  });
}

test("the clean run walks the whole apparatus in order", async () => {
  const result = await run(cleanScript(), check.expected);

  assert.deepEqual(result.phases, [
    "assertion-list",
    "structural-verify",
    "semantic-verify",
    "probe-author",
    "narration",
    "terminal-check",
    "probe-evaluation",
  ]);
  assert.equal(result.stoppedBefore, null);
  assert.equal(result.structural.ok, true);
  assert.equal(result.semantic.every((verdict) => verdict.ok), true);
  assert.equal(result.probes.length, 2);
  assert.equal(result.outcomes.length, 2);
  assert.equal(result.challenge.fired, false, "no trigger means no Challenger");
  assert.equal(result.verdict?.verdict, "pass");
  assert.ok(result.surface.elements.length > 0, "the board should not be empty");
});

test("probes are spoken by the explainer but written by someone else", async () => {
  const result = await run(cleanScript(), check.expected);

  const authored = (JSON.parse(APPARATUS_PROBES).probes as Array<{ prompt: string }>)[0].prompt;
  const said = result.log.narration.map((chunk) => chunk.text);
  assert.ok(said.includes(authored), "the probe's own wording must reach the learner");
});

test("the narration may not place a probe that was never authored", async () => {
  // Otherwise the explainer could invent its own questions and quietly take back
  // the authorship of its own assessment.
  const rogue = JSON.stringify({ steps: [{ say: "好，问题来了。" }, { probe: "Q-invented" }] });
  const script = { ...cleanScript(), "lead-explainer": [APPARATUS_LIST, rogue] };

  await assert.rejects(
    () =>
      runApparatusSession(new ScriptedProvider(script), {
        expert,
        check,
        probeAnswers: [],
        terminalAnswer: check.expected,
      }),
    /never authored/,
  );
});

test("an unsupported claim stops the session before anything is said", async () => {
  const script = cleanScript();
  script["grounding-verifier"] = JSON.stringify({
    verdicts: [
      { id: "A1", ok: true, reason: "" },
      { id: "A2", ok: true, reason: "" },
      { id: "A3", ok: false, reason: "the passage does not say this" },
      { id: "A4", ok: true, reason: "scaffold" },
    ],
  });

  const result = await run(script, check.expected);
  assert.equal(result.stoppedBefore, "semantic");
  assert.equal(result.verdict, null);
  assert.equal(result.log.narration.length, 0, "nothing may be said on an unverified list");
  assert.equal(result.log.events.length, 0);
  assert.deepEqual(result.phases.slice(-2), ["semantic-verify", "stopped-before-teaching"]);
});

test("a citation the Domain does not have fails before the verifier is even asked", async () => {
  const script = {
    ...cleanScript(),
    "lead-explainer": [
      JSON.stringify({ assertions: [{ id: "A1", kind: "grounded", statement: "x", sources: ["P-ghost"] }] }),
      APPARATUS_NARRATION,
      APPARATUS_RETRY,
    ],
  };

  await assert.rejects(() => run(script, check.expected), /failed structural verification/);
});

test("a failing probe summons the Challenger, and the retry adds to the board", async () => {
  const result = await run(misconceptionScript(), check.expected);

  assert.equal(result.challenge.fired, true);
  assert.deepEqual(result.challenge.triggers, ["probe:Q1"]);
  assert.ok(result.phases.includes("challenger"));
  assert.ok(result.phases.includes("re-teach"));

  const words = result.log.narration.map((chunk) => chunk.text);
  assert.ok(
    words.some((text) => text.includes("打住")),
    "the Challenger's refutation must reach the learner",
  );

  // The retry re-realises the same claims with different words, so the board only
  // grows. A retry that rearranged what was already there would leave the learner
  // looking at a board they no longer recognise.
  const retryIds = (JSON.parse(APPARATUS_RETRY).steps as Array<{ event?: { id: string } }>).flatMap((step) =>
    step.event === undefined ? [] : [step.event.id],
  );
  for (const id of retryIds) {
    assert.ok(
      result.surface.elements.some((element) => element.id === id),
      `the retry's element ${id} is missing from the board`,
    );
  }
});

test("a failed check is a Challenger trigger too, with no probe involved", async () => {
  const result = await run(cleanScript(), "不知道，随便猜一个", []);

  assert.equal(result.verdict?.verdict, "fail");
  assert.deepEqual(result.challenge.triggers, [`check:${check.id}`]);
  assert.equal(result.challenge.fired, true);
});

// ------------------------------------------------------- fixture discipline --

test("running past the end of a scripted sequence is an error, not a silent repeat", async () => {
  // A fixture that quietly repeated would let a runaway loop look like a pass.
  const provider = new ScriptedProvider({ actor: ["one"] });
  await provider.complete({ actor: "actor", model: "m", input: "x" });
  await assert.rejects(() => provider.complete({ actor: "actor", model: "m", input: "x" }), /only 1 response/);
});

test("an actor with no script at all is an error", async () => {
  const provider = new ScriptedProvider({ someone: "x" });
  await assert.rejects(() => provider.complete({ actor: "nobody", model: "m", input: "x" }), /no scripted response/);
});

// ------------------------------------------------- the retake, and the record --

test("a failed check is retaken after the retry, so the retry can actually matter", async () => {
  const retake = findCheck(expert.domain.checks, "C-overlap");
  const result = await runApparatusSession(new ScriptedProvider(cleanScript()), {
    expert,
    check,
    retakeCheck: retake,
    probeAnswers: [],
    terminalAnswer: "不知道，随便猜一个",
    retryAnswer: retake.expected,
    sessionId: "retake",
  });

  assert.equal(result.verdict?.verdict, "fail", "the first sitting still failed");
  assert.equal(result.verdictAfterRetry?.verdict, "pass", "the second sitting is the one that counts");
  assert.equal(
    result.verdictAfterRetry?.checkId,
    retake.id,
    "and it was decided by the retake's asset, not by the one they already failed",
  );
  assert.ok(result.phases.includes("retake"));
});

test("answering the FIRST question again does not pass the retake", async () => {
  // The whole point of a distinct retake asset. Re-asking the same question right
  // after showing the learner the answer measures recall of it, and recall must not
  // read as understanding.
  const retake = findCheck(expert.domain.checks, "C-overlap");
  const result = await runApparatusSession(new ScriptedProvider(cleanScript()), {
    expert,
    check,
    retakeCheck: retake,
    probeAnswers: [],
    terminalAnswer: "不知道，随便猜一个",
    retryAnswer: check.expected,
    sessionId: "recall",
  });

  assert.notEqual(retake.expected, check.expected, "the two assets must not agree by accident");
  assert.equal(
    result.verdictAfterRetry?.verdict,
    "fail",
    "the first question's answer is not the retake's answer",
  );
});

test("with no retake asset supplied, the retake falls back to the same check", async () => {
  // A visible degradation rather than a silent one: the fallback still works, but the
  // verdict says which asset produced it, so a pass re-reading the same question
  // cannot be mistaken for a pass on new material.
  const result = await runApparatusSession(new ScriptedProvider(cleanScript()), {
    expert,
    check,
    probeAnswers: [],
    terminalAnswer: "不知道，随便猜一个",
    retryAnswer: check.expected,
    sessionId: "no-retake-asset",
  });

  assert.equal(result.verdictAfterRetry?.verdict, "pass");
  assert.equal(result.verdictAfterRetry?.checkId, check.id);
});

test("without a second answer there is no retake, and the failure stands", async () => {
  const result = await run(cleanScript(), "不知道，随便猜一个", []);
  assert.equal(result.verdictAfterRetry, null);
  assert.ok(!result.phases.includes("retake"), "a learner who stops has not earned a second sitting");
});

test("learner answers are recorded in the log, beside the blackboard", async () => {
  const result = await run(cleanScript(), check.expected);

  assert.equal(result.log.answers.length, 2, "one answer per probe that was answered");
  assert.deepEqual(
    result.log.answers.map((answer) => answer.probeId),
    ["Q1", "Q2"],
  );
  assert.ok(result.log.answers.every((answer) => answer.text.trim() !== ""));
});

test("an answer can never be orphaned: it names a probe that was actually asked", async () => {
  const result = await run(cleanScript(), check.expected);
  const asked = new Set(result.probes.map((probe) => probe.id));
  for (const answer of result.log.answers) {
    assert.ok(asked.has(answer.probeId), `${answer.probeId} is not a probe that was asked`);
  }
});

test("the answers survive a storage round trip, like the rest of the record", async () => {
  const result = await run(cleanScript(), check.expected);
  const restored = deserializeLog(serializeLog(result.log));
  assert.deepEqual(restored.answers, result.log.answers);
});

test("a log written before answers were recorded still loads", async () => {
  // The field is additive and defaults to empty, because the alternative is a
  // session that cannot be resumed — losing a learner's history to a field rename
  // is exactly the quiet breakage this file avoids.
  const legacy = JSON.stringify({ sessionId: "old", narration: [], events: [] });
  assert.deepEqual(deserializeLog(legacy).answers, []);
});

test("a probe is put to the learner where the lesson asks it, not at the end", async () => {
  // Asking somebody about a question they saw two minutes ago, after the lesson has moved on,
  // is a quiz on recall of the lesson's SHAPE. The fixture places Q1 partway through the
  // narration, so the answer must be asked for before the narration is finished.
  let sizeSoFar = 0;
  const askedAt: number[] = [];

  const result = await runApparatusSession(new ScriptedProvider(misconceptionScript()), {
    expert,
    check,
    probeAnswers: [],
    terminalAnswer: check.expected,
    askProbe: async () => {
      askedAt.push(sizeSoFar);
      return "夏令时就是把偏移量改一下";
    },
    onStep: (log) => {
      sizeSoFar = log.narration.length + log.events.length;
    },
  });

  const total = result.log.narration.length + result.log.events.length;
  assert.ok(askedAt.length >= 1, "the probes the narration placed were put to the learner");
  // The property, not a count: every ask happened while the lesson was still going. A count
  // would be asserting how many probes the fixture places, which is not what this is about.
  for (const at of askedAt) {
    assert.ok(at < total, `a probe was asked after step ${at} of ${total} — it has to come mid-lesson`);
  }
  assert.equal(result.outcomes.length, askedAt.length, "and every answer still reaches a probe outcome");
});

test("no probe is put to the learner twice", async () => {
  // Inline and fallback are two paths to the same question. If both fired for the same probe,
  // the learner would answer it twice, the evaluator would grade it twice, and the ledger would
  // be billed for both — a duplication that looks like a thorough assessment.
  const ids: string[] = [];
  const result = await runApparatusSession(new ScriptedProvider(misconceptionScript()), {
    expert,
    check,
    probeAnswers: [],
    terminalAnswer: check.expected,
    askProbe: async (probe) => {
      ids.push(probe.id);
      return "夏令时就是把偏移量改一下";
    },
  });

  assert.equal(new Set(ids).size, ids.length, `asked twice: ${JSON.stringify(ids)}`);
  assert.equal(result.log.answers.length, ids.length, "and each answer is recorded once");
});

// ------------------------------------------- a question asked mid-lesson (ADR 0008) --

/** Run the apparatus with one question offered at the poll numbered `poll`. */
function askOnPoll(script: Record<string, string | string[]>, question: string, poll: number) {
  let polls = 0;
  return runApparatusSession(new ScriptedProvider(script), {
    expert,
    check,
    probeAnswers: PROBE_ANSWERS,
    terminalAnswer: check.expected,
    takeQuestion: () => {
      polls += 1;
      return polls === poll ? question : undefined;
    },
  });
}

test("a question asked mid-lesson is answered where the lesson is, and the lesson goes on", async () => {
  const question = "时区和偏移量到底是什么关系？";
  const result = await askOnPoll(answeredQuestionScript(), question, 3);

  const texts = result.log.narration.map((chunk) => chunk.text);
  const answerAt = texts.indexOf("好问题。偏移量是读数，时区是那本规则手册。");
  assert.ok(answerAt > 0, "the answer must arrive mid-lesson, not before it");
  assert.ok(answerAt < texts.length - 1, "and the lesson must carry on past it");
  assert.ok(
    result.surface.elements.some((element) => element.id === "qa1"),
    "the answer lands on the board like any teaching",
  );

  // The record: the learner's words verbatim, with what came of them.
  assert.equal(result.log.questions.length, 1);
  assert.equal(result.log.questions[0]?.text, question);
  assert.equal(result.log.questions[0]?.outcome, "answered");

  // The detour does not join the lesson: the list, the verdict and the checks are the lesson's.
  assert.equal(result.list.assertions.length, JSON.parse(APPARATUS_LIST).assertions.length);
  assert.equal(result.verdict?.verdict, "pass");
});

test("a question the corpus cannot answer is refused, and the lesson is not destroyed", async () => {
  const script = { ...cleanScript(), "lead-explainer": [APPARATUS_LIST, APPARATUS_NARRATION, ANSWER_DECLINE] };
  const result = await askOnPoll(script, "闰秒是怎么处理的？", 3);

  const texts = result.log.narration.map((chunk) => chunk.text);
  const refusalAt = texts.indexOf(CANNOT_ANSWER);
  assert.ok(refusalAt > 0, "the refusal arrives where the lesson paused");
  assert.ok(refusalAt < texts.length - 1, "and the lesson carries on");
  assert.equal(result.log.questions[0]?.outcome, "refused");
  assert.equal(result.verdict?.verdict, "pass", "a verified lesson is not destroyed by one question");
});

test("an answer the passages do not support is refused too", async () => {
  // The claims parse and the citations resolve — and the independent verifier says the passage
  // does not say this. Nothing unverified may be delivered, so the learner gets the refusal.
  const script = {
    ...cleanScript(),
    "lead-explainer": [APPARATUS_LIST, APPARATUS_NARRATION, ANSWER_PLAN],
    "grounding-verifier": [APPARATUS_VERDICTS_OK, ANSWER_VERDICTS_UNSUPPORTED],
  };
  const result = await askOnPoll(script, "时区和偏移量到底是什么关系？", 3);

  const texts = result.log.narration.map((chunk) => chunk.text);
  assert.ok(texts.includes(CANNOT_ANSWER), "an unsupported answer must not be delivered");
  assert.equal(result.log.questions[0]?.outcome, "refused");
  assert.equal(result.verdict?.verdict, "pass");
});

test("a broken answer reply is retried once, then refused — and the lesson survives", async () => {
  const script = {
    ...cleanScript(),
    "lead-explainer": [APPARATUS_LIST, APPARATUS_NARRATION, "{not json", "{still not json"],
  };
  const result = await askOnPoll(script, "时区和偏移量到底是什么关系？", 3);

  assert.ok(result.log.narration.map((chunk) => chunk.text).includes(CANNOT_ANSWER));
  assert.equal(result.retries, 1, "the unusable reply is retried once and the retry is counted");
  assert.equal(result.log.questions[0]?.outcome, "refused");
  assert.equal(result.verdict?.verdict, "pass");
});

