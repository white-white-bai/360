import test from "node:test";
import assert from "node:assert/strict";

import { findCheck } from "../src/checks/load.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { runApparatusSession } from "../src/session/apparatus.ts";
import {
  APPARATUS_LIST,
  APPARATUS_NARRATION,
  APPARATUS_PROBES,
  APPARATUS_RETRY,
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
