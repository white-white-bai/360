import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { findCheck } from "../src/checks/load.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { CANDIDATES_DIR, recordCandidates } from "../src/grounding/candidates.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { runApparatusSession } from "../src/session/apparatus.ts";
import { cleanScript, misconceptionScript } from "../src/session/fixtures-apparatus.ts";

const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const check = findCheck(expert.domain.checks, "C-gap");

/** An id no real run uses, so a test never collides with the user's own queue. */
const DOMAIN = "test-domain-candidates";
const QUEUE = join(CANDIDATES_DIR, `${DOMAIN}.md`);

test("a concern with no matching entry survives the session", async () => {
  // The evaluator's prompt says a vague or wrong-but-unlisted answer is still a concern
  // with `misconceptionId: null`. Until now that value was produced and thrown away.
  const script = cleanScript();
  script["probe-evaluator"] = [
    JSON.stringify({ concern: true, reason: "答案里没有偏移量与时区的区分", misconceptionId: null }),
    JSON.stringify({ concern: false, reason: "", misconceptionId: null }),
  ];

  const result = await runApparatusSession(new ScriptedProvider(script), {
    expert,
    check,
    probeAnswers: ["感觉就是时间不一样"],
    terminalAnswer: check.expected,
    sessionId: "unlisted",
  });

  assert.equal(result.unlistedConcerns.length, 1);
  assert.equal(result.unlistedConcerns[0]?.answer, "感觉就是时间不一样", "the learner's words are the raw material");
  assert.match(result.unlistedConcerns[0]?.reason ?? "", /偏移量/);
});

test("a concern that DOES match an entry is not a candidate", async () => {
  // Only the unlisted ones. A catalogued misconception is already in the catalogue, and
  // queuing it would make the queue grow without ever telling anyone anything.
  const result = await runApparatusSession(new ScriptedProvider(misconceptionScript()), {
    expert,
    check,
    probeAnswers: ["夏令时就是把偏移量改一下"],
    terminalAnswer: check.expected,
    sessionId: "listed",
  });

  assert.deepEqual(result.unlistedConcerns, []);
});

test("the queue is written where it cannot be committed, and deduplicated", () => {
  rmSync(QUEUE, { force: true });
  try {
    const concerns = [{ probeId: "Q1", answer: "感觉就是时间不一样", reason: "没有区分偏移量与时区" }];

    assert.equal(recordCandidates(DOMAIN, concerns), 1, "first time is new");
    assert.equal(recordCandidates(DOMAIN, concerns), 0, "the same answer is not queued twice");
    assert.equal(recordCandidates(DOMAIN, []), 0, "nothing to say writes nothing");

    const body = readFileSync(QUEUE, "utf8");
    assert.equal((body.match(/^## Q1/gm) ?? []).length, 1, "one entry, not three");
    assert.match(body, /感觉就是时间不一样/, "the evidence is kept");
    assert.match(body, /no check can reach/, "and promoting it is authoring, not bookkeeping");
    assert.match(body, /must stay uncommitted/);
  } finally {
    rmSync(QUEUE, { force: true });
  }
});

test("the queue cannot be pointed at the Domain folder", () => {
  // The path is not a parameter, and that is the safeguard: a `domains/*/candidates.md`
  // would be swept up by the next `git add -A`, and it holds the learner's own words.
  assert.match(CANDIDATES_DIR, /\.sessions/);
  assert.doesNotMatch(CANDIDATES_DIR, /domains/);
});

test("two different phrasings are two candidates", () => {
  // Collapsing them would be a judgement about the Domain, and this function does not
  // make those — two learners wording the same wrong idea differently may still be two
  // different wrong ideas.
  rmSync(QUEUE, { force: true });
  try {
    assert.equal(
      recordCandidates(DOMAIN, [
        { probeId: "Q1", answer: "感觉就是时间不一样", reason: "r" },
        { probeId: "Q1", answer: "大概就是时间不一样", reason: "r" },
      ]),
      2,
    );
    assert.equal(existsSync(QUEUE), true);
  } finally {
    rmSync(QUEUE, { force: true });
  }
});
