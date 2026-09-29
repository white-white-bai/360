import test from "node:test";
import assert from "node:assert/strict";

import { loadLibrary } from "../src/experts/load.ts";
import type { Completion, CompletionRequest } from "../src/providers/types.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { SUMMON_CHALLENGER, runClassroomTurn, stripSummon } from "../src/session/classroom.ts";

/**
 * The direct classroom (ADR 0011): two prompt-defined voices, a transcript, and one reserved
 * marker. There is no corpus and no verifier here, so what the tests pin is the PROTOCOL —
 * the marker never reaches the learner, the Challenger is called only when summoned, and the
 * conversation (not a summary of it) is what the model answers from.
 */

const library = loadLibrary();
const pick = <T>(map: Map<string, T>, id: string): T => map.get(id) as T;

const setup = {
  persona: pick(library.personas, "patient-explainer"),
  style: pick(library.styles, "analogy-heavy"),
  challenger: pick(library.personas, "terse-engineer"),
  topic: "时区为什么有缺口",
};

test("the summon marker is recognised only as the last thing said", () => {
  const summoned = stripSummon(`先讲这个点。\n\n${SUMMON_CHALLENGER}`);
  assert.equal(summoned.summon, true);
  assert.equal(summoned.text, "先讲这个点。");

  const mentioned = stripSummon(`${SUMMON_CHALLENGER} 看起来像这样，但我现在不需要它。\n下一句还在。`);
  assert.equal(mentioned.summon, false, "a mention that is not the last line is not a summon");

  assert.deepEqual(stripSummon("就这样。"), { text: "就这样。", summon: false });
});

test("a summon brings the Challenger in, and the marker never reaches the learner", async () => {
  const script = {
    "lead-explainer": `先讲第一点：时区是一套规则。用你自己的话说说？\n${SUMMON_CHALLENGER}`,
    challenger: "你说的其实是「时区就是偏移量」——不是的，规则先于偏移量。",
  };
  const result = await runClassroomTurn({
    provider: new ScriptedProvider(script),
    setup,
    history: [],
    message: "我想学：时区",
  });

  assert.deepEqual(
    result.turns.map((turn) => turn.actor),
    ["lead-explainer", "challenger"],
  );
  assert.ok(
    !result.turns[0].text.includes(SUMMON_CHALLENGER),
    "the marker is stripped before anyone reads the reply",
  );
  assert.match(result.turns[1].text, /规则先于偏移量/);
  assert.equal(result.usage.calls, 2, "one call per voice, both in the ledger");
});

test("without a summon, only the teacher speaks", async () => {
  // No challenger is scripted: a call would be an error, so this also pins that none happens.
  const script = { "lead-explainer": "先讲第一点：时区是一套规则。" };
  const result = await runClassroomTurn({
    provider: new ScriptedProvider(script),
    setup,
    history: [],
    message: "我想学：时区",
  });

  assert.equal(result.turns.length, 1);
  assert.equal(result.usage.calls, 1);
});

test("the model answers from the conversation, and the prompts carry the classroom discipline", async () => {
  const requests: Array<{ actor: string; system: string; input: string }> = [];
  const inner = new ScriptedProvider({
    "lead-explainer": `这一点换个说法。\n${SUMMON_CHALLENGER}`,
    challenger: "驳一下。",
  });
  // A provider with only `complete`: the buffered shape must work exactly as the streamed one.
  const capturing = {
    complete: async (request: CompletionRequest): Promise<Completion> => {
      requests.push({ actor: request.actor, system: request.system ?? "", input: request.input });
      return inner.complete(request);
    },
  };

  await runClassroomTurn({
    provider: capturing,
    setup,
    history: [
      { role: "learner", text: "第一句话" },
      { role: "teacher", actor: "lead-explainer", text: "第一个知识点" },
    ],
    message: "我还是不太懂",
  });

  const explainer = requests[0] as { actor: string; system: string; input: string };
  assert.equal(explainer.actor, "lead-explainer");
  assert.ok(explainer.input.includes("学习者：第一句话"), "the earlier learner line is in context");
  assert.ok(explainer.input.includes("主讲：第一个知识点"), "and so is what the teacher said");
  assert.ok(explainer.input.includes("学习者：我还是不太懂"), "and the new message ends it");
  assert.match(explainer.system, /ONE point per reply/, "the teaching discipline is the prompt");
  assert.ok(explainer.system.includes(setup.persona.name), "the persona still speaks");
  assert.ok(explainer.system.includes(`analogyDensity: ${setup.style.analogyDensity}`), "and the style");

  const challenger = requests[1] as { actor: string; system: string; input: string };
  assert.equal(challenger.actor, "challenger");
  assert.ok(challenger.input.includes("学习者：我还是不太懂"), "the Challenger sees the wrong answer");
  assert.ok(challenger.input.includes("主讲：这一点换个说法。"), "and the teacher's reply it must not repeat");
  assert.ok(challenger.system.includes(setup.challenger.name), "in its own voice");
});
