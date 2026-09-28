import test from "node:test";
import assert from "node:assert/strict";

import { parseAssertionList } from "../src/assertions/parse.ts";
import type { AssertionList } from "../src/assertions/types.ts";
import { citedPassages, verifyAssertionList } from "../src/grounding/verify.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";

const VALID = JSON.stringify({
  assertions: [
    { id: "A1", kind: "grounded", statement: "偏移量是本地时间减 UTC", sources: ["P-offset-is-signed"] },
    { id: "A2", kind: "scaffold", statement: "把它想成两座钟", sources: [] },
    { id: "A3", kind: "grounded", statement: "缺口处的本地时间不存在", sources: ["P-gap-and-overlap"] },
  ],
});

test("a well-formed list parses", () => {
  const list = parseAssertionList(VALID, "d");
  assert.equal(list.domainId, "d");
  assert.deepEqual(list.assertions.map((a) => a.kind), ["grounded", "scaffold", "grounded"]);
});

test("an empty list is refused: a session with nothing to assert cannot teach", () => {
  assert.throws(() => parseAssertionList(JSON.stringify({ assertions: [] }), "d"), /cannot teach/);
});

test("duplicate assertion ids are refused", () => {
  const text = JSON.stringify({
    assertions: [
      { id: "A1", kind: "scaffold", statement: "x", sources: [] },
      { id: "A1", kind: "scaffold", statement: "y", sources: [] },
    ],
  });
  assert.throws(() => parseAssertionList(text, "d"), /duplicate assertion id/);
});

test("`kind` is a closed set", () => {
  const text = JSON.stringify({ assertions: [{ id: "A", kind: "opinion", statement: "x" }] });
  assert.throws(() => parseAssertionList(text, "d"), /`kind` must be one of/);
});

test("a grounded assertion with no sources is refused at the boundary", () => {
  // The escape hatch this closes: label everything `grounded` and cite nothing,
  // which would make the trace look universal while checking nothing.
  const text = JSON.stringify({ assertions: [{ id: "A", kind: "grounded", statement: "x" }] });
  assert.throws(() => parseAssertionList(text, "d"), /if nothing supports it, it is a scaffold/);
});

test("a scaffold that cites sources is refused: it is a grounded claim mislabelled", () => {
  const text = JSON.stringify({
    assertions: [{ id: "A", kind: "scaffold", statement: "x", sources: ["P-one"] }],
  });
  assert.throws(() => parseAssertionList(text, "d"), /grounded assertion wearing the wrong label/);
});

test("non-JSON output is refused with the parse error attached", () => {
  assert.throws(() => parseAssertionList("Sure, here is the list:", "d"), /not valid JSON/);
});

// ------------------------------------------------------------------ verifier --

const library = loadLibrary();
const corpus = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones").domain.corpus;

test("a list whose citations all resolve passes", () => {
  const list = parseAssertionList(VALID, "time-zones");
  const verdict = verifyAssertionList(list, corpus);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.verdicts));
  assert.deepEqual(verdict.failed, []);
});

test("a citation this Domain does not have is reported by name", () => {
  const list = parseAssertionList(
    JSON.stringify({ assertions: [{ id: "A1", kind: "grounded", statement: "x", sources: ["P-ghost"] }] }),
    "time-zones",
  );
  const verdict = verifyAssertionList(list, corpus);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failed, ["A1"]);
  assert.match(verdict.verdicts[0]?.reason ?? "", /P-ghost/);
});

test("both kinds are re-checked on the way in, not assumed from the parser", () => {
  // A list can also arrive from storage or be built by hand, so the verifier does
  // not get to trust the parser having run.
  const handBuilt: AssertionList = {
    domainId: "time-zones",
    assertions: [
      { id: "G", kind: "grounded", statement: "x", sources: [] },
      { id: "S", kind: "scaffold", statement: "y", sources: ["P-offset-is-signed"] },
    ],
  };
  const verdict = verifyAssertionList(handBuilt, corpus);
  assert.deepEqual(verdict.failed, ["G", "S"]);
});

test("THE BOUNDARY: a citation that resolves passes even when it is irrelevant", () => {
  // This is deliberate, and it is the point of the module. Deciding whether a
  // claim FOLLOWS FROM the passage it cites is a semantic judgement, and ADR 0004
  // forbids the actor that made the claim from making it. So the kernel does not
  // pretend to: it checks the trace, and a separate verifier actor does the rest.
  //
  // If this test ever starts failing, someone has quietly moved semantics into
  // the kernel — and the whole apparatus has become self-verification.
  const list = parseAssertionList(
    JSON.stringify({
      assertions: [
        {
          id: "A1",
          kind: "grounded",
          statement: "月球由绿色奶酪构成",
          sources: ["P-offset-is-signed"],
        },
      ],
    }),
    "time-zones",
  );
  const verdict = verifyAssertionList(list, corpus);
  assert.equal(verdict.ok, true, "the structural check must NOT judge relevance");
});

test("cited passages are listed once, in first-use order", () => {
  const list = parseAssertionList(
    JSON.stringify({
      assertions: [
        { id: "A1", kind: "grounded", statement: "x", sources: ["P-b", "P-a"] },
        { id: "A2", kind: "grounded", statement: "y", sources: ["P-a", "P-c"] },
      ],
    }),
    "time-zones",
  );
  assert.deepEqual(citedPassages(list), ["P-b", "P-a", "P-c"]);
});
