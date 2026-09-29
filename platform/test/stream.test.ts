import test from "node:test";
import assert from "node:assert/strict";

import { StepScanner, parseExplanation } from "../src/session/explanation.ts";
import { runTurn } from "../src/session/stream.ts";
import { applySteps } from "../src/session/turn.ts";
import { SpendMeter } from "../src/providers/meter.ts";
import { ScriptedProvider, cutAtStepBoundaries } from "../src/providers/scripted.ts";
import type { ModelProvider } from "../src/providers/types.ts";
import { emptyLog } from "../src/events/log.ts";
import { APPARATUS_NARRATION } from "../src/session/fixtures-apparatus.ts";

const REQUEST = { actor: "lead-explainer", model: "m", input: "teach" };
const ACTOR = "lead-explainer" as const;

/** A provider that can only answer in one piece — the fallback path. */
function bufferedProvider(text: string): ModelProvider {
  return {
    complete: async () => ({ text, usage: { calls: 1, inputTokens: 10, outputTokens: 10 } }),
  };
}

/** Hides `stream`, so the same provider can be metered down the other path. */
function withoutStream(inner: ModelProvider): ModelProvider {
  return { complete: (req) => inner.complete(req) };
}

test("a step may contain arrays of its own without ending the capture", () => {
  // An axis carries `marks`, and an overlap carries two of them. Reading a step's
  // own `]` as the end of `steps` silently truncates the turn: the board shows the
  // first few steps and then stops, with no error anywhere. Regression test for a
  // bug this file found by refusing the turn.
  const scanner = new StepScanner();
  const found = scanner.push(APPARATUS_NARRATION);
  assert.equal(
    found.length,
    parseExplanation(APPARATUS_NARRATION).steps.length,
    "the scan must find every step the parser does",
  );
});

test("a delta split inside a string does not emit a broken step", () => {
  const text = '{"steps":[{"say":"a } brace in a string"},{"say":"second"}]}';
  const scanner = new StepScanner();
  const emitted: string[] = [];
  for (const character of text) emitted.push(...scanner.push(character));

  assert.equal(emitted.length, 2, "fed one character at a time, the scan must still be exact");
  assert.equal(JSON.parse(emitted[0] as string).say, "a } brace in a string");
  assert.equal(scanner.boundaries.length, 2);
});

test("a bracket that is not the steps array does not start a capture", () => {
  const scanner = new StepScanner();
  const found = scanner.push('{"note":"see [1] and [2]","steps":[{"say":"only"}]}');
  assert.equal(found.length, 1);
});

test("cutting a fixture at step boundaries reassembles it exactly", () => {
  const chunks = cutAtStepBoundaries(APPARATUS_NARRATION);
  assert.ok(chunks.length > 1, "one chunk would mean nothing was streamed");
  assert.equal(chunks.join(""), APPARATUS_NARRATION, "the pieces must reassemble the turn exactly");
});

test("a streamed turn and a buffered turn produce the same log", async () => {
  const streamed = await runTurn(
    new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }),
    REQUEST,
    emptyLog("s"),
    ACTOR,
  );
  const buffered = await runTurn(bufferedProvider(APPARATUS_NARRATION), REQUEST, emptyLog("s"), ACTOR);

  assert.equal(streamed.streamed, true, "the fixture provider streams, so this path must be taken");
  assert.equal(buffered.streamed, false);
  // The whole point of the incremental path: it must not be a second way of
  // teaching, only a second way of delivering the same turn.
  assert.deepEqual(streamed.log.narration, buffered.log.narration);
  assert.deepEqual(streamed.log.events, buffered.log.events);
});

test("every step is reported as it lands, in order", async () => {
  const seen: number[] = [];
  const turn = await runTurn(
    new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }),
    REQUEST,
    emptyLog("s"),
    ACTOR,
    { onStep: (log) => { seen.push(log.narration.length + log.events.length); } },
  );

  assert.equal(seen.length, turn.steps.length, "one report per step");
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), "and the board only ever grows");
  assert.equal(seen[seen.length - 1], turn.log.narration.length + turn.log.events.length);
});

test("the hook is told which step arrived, before any rewriting", async () => {
  // The probe id exists in exactly one place by the time a step lands: the step as it ARRIVED.
  // `prepare` replaces it with the authored question text, which is what belongs on the board
  // and not what identifies the probe — so without this second argument there is no way to know
  // which probe a line on the board was, and nowhere to put the question to the learner.
  const sources: Array<string | undefined> = [];
  await runTurn(
    new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }),
    REQUEST,
    emptyLog("s"),
    ACTOR,
    {
      prepare: (step) => (step.probe === undefined ? step : { say: "REWRITTEN" }),
      onStep: (_log, step, source) => {
        assert.equal(step.say === "REWRITTEN", source.probe !== undefined, "the rewrite is visible and paired");
        sources.push(source.probe);
      },
    },
  );

  // Whatever the fixture places, every probe step must have had a source, and the ids must have
  // reached the hook. Asserting the exact list would be asserting the fixture, not the contract.
  assert.ok(sources.includes("Q1"), `the probe id survives to the hook; saw ${JSON.stringify(sources)}`);
});

test("a streamed call is metered exactly like a buffered one", async () => {
  // The same recorded usage on both sides: the question is whether the DELIVERY path
  // changes the bill, not whether two different providers cost the same.
  const script = { "lead-explainer": APPARATUS_NARRATION };
  const streamed = new SpendMeter(new ScriptedProvider(script));
  const buffered = new SpendMeter(withoutStream(new ScriptedProvider(script)));

  await runTurn(streamed, REQUEST, emptyLog("s"), ACTOR);
  await runTurn(buffered, REQUEST, emptyLog("s"), ACTOR);

  assert.equal(streamed.total().calls, 1, "a streamed turn must not be billed twice");
  assert.equal(streamed.total().calls, buffered.total().calls);
  assert.equal(streamed.total().outputTokens, buffered.total().outputTokens);
  assert.equal(streamed.total().costUsd, buffered.total().costUsd);
});

// ------------------------------------------------------------- the interjection --

test("an interjection lands mid-turn, and the end-of-turn check sees through it", async () => {
  // ADR 0008: the learner asks while the lesson is being delivered, and the answer is a detour
  // INSIDE the turn. The turn's own steps are still exactly what the parse says — the aside is
  // not one of them — and the check must not read the aside as the scanner diverging.
  let boundary = 0;
  const turn = await runTurn(
    new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }),
    REQUEST,
    emptyLog("s"),
    ACTOR,
    {
      interlude: (log) => {
        boundary += 1;
        return boundary === 2 ? applySteps(log, [{ say: "（插问）" }], "lead-explainer") : undefined;
      },
    },
  );

  const texts = turn.log.narration.map((chunk) => chunk.text);
  const at = texts.indexOf("（插问）");
  assert.ok(at > 0, "the interjection must sit inside the turn, not after it");
  assert.ok(at < texts.length - 1, "and the turn must carry on past it");
  assert.equal(
    texts.length,
    turn.steps.filter((step) => step.say !== undefined).length + 1,
    "the aside is on the board, but it is not one of the turn's steps",
  );
});

test("every pause is a chance to be interrupted, and nothing more", async () => {
  let polls = 0;
  const turn = await runTurn(
    new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }),
    REQUEST,
    emptyLog("s"),
    ACTOR,
    { interlude: () => { polls += 1; return undefined; } },
  );
  assert.equal(polls, turn.steps.length, "one poll per step boundary, no matter how it answers");
});

test("a buffered turn takes the same interjection point", async () => {
  // A provider that cannot stream is still a valid provider, and a question asked mid-lesson
  // must not require one.
  let polls = 0;
  const turn = await runTurn(bufferedProvider(APPARATUS_NARRATION), REQUEST, emptyLog("s"), ACTOR, {
    interlude: (log) => {
      polls += 1;
      return polls === 2 ? applySteps(log, [{ say: "（插问）" }], "lead-explainer") : undefined;
    },
  });

  assert.equal(turn.streamed, false);
  assert.ok(turn.log.narration.some((chunk) => chunk.text === "（插问）"));
});

test("an interjection must extend the log, not rewrite it", async () => {
  await assert.rejects(
    () =>
      runTurn(new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }), REQUEST, emptyLog("s"), ACTOR, {
        interlude: () => emptyLog("s"),
      }),
    /extend the log/,
  );
});

test("an interjection does not blunt the check: a divergent rewrite is still refused", async () => {
  // `prepare` is supposed to be pure; this one is not, which is how a scanner/parse
  // disagreement is forced without a bug in the scanner. Under an interjection the comparison
  // drops positions but keeps content and order — so this must still fail.
  let seen = 0;
  await assert.rejects(
    () =>
      runTurn(new ScriptedProvider({ "lead-explainer": APPARATUS_NARRATION }), REQUEST, emptyLog("s"), ACTOR, {
        prepare: (step) => {
          if (step.say === undefined) return step;
          seen += 1;
          return { say: `${step.say} #${seen}` };
        },
        interlude: (log) => applySteps(log, [{ say: "（插问）" }], "lead-explainer"),
      }),
    /do not describe the same board/,
  );
});
