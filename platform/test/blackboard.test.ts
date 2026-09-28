import test from "node:test";
import assert from "node:assert/strict";

import type { BlackboardEvent } from "../src/events/types.ts";
import { assertBlackboardEvent } from "../src/events/types.ts";
import { render } from "../src/render/render.ts";
import { surfaceToText } from "../src/render/text.ts";
import { parseExplanation } from "../src/session/explanation.ts";
import { EXPLAINER_FIXTURE } from "../src/session/fixture-explanation.ts";

const axis: BlackboardEvent = {
  at: 0,
  kind: "axis",
  id: "ax",
  label: "UTC 偏移量（小时）",
  from: -12,
  to: 14,
  marks: [{ value: 5.5, label: "+05:30" }],
};

const band: BlackboardEvent = {
  at: 1,
  kind: "band",
  id: "b",
  axis: "ax",
  from: 2,
  to: 3,
  label: "缺口",
  emphasis: "attention",
};

const table: BlackboardEvent = {
  at: 2,
  kind: "table",
  id: "tbl",
  columns: ["", "缺口", "重叠"],
  rows: [["本地时间", "不存在", "出现两次"]],
};

test("an axis, a band and a table all reach the surface", () => {
  const surface = render([axis, band, table]);
  assert.deepEqual(
    surface.elements.map((e) => e.kind),
    ["axis", "band", "table"],
  );
});

test("an axis keeps fractional ticks, because half-hour offsets are real", () => {
  const element = render([axis]).elements[0];
  assert.equal(element?.kind, "axis");
  if (element?.kind !== "axis") return;
  assert.equal(element.marks[0]?.value, 5.5);
  assert.equal(element.marks[0]?.label, "+05:30");
});

test("bands on the same axis stay distinct, which is how a gap differs from an overlap", () => {
  const overlap: BlackboardEvent = { ...band, id: "b2", from: 1, to: 2, label: "重叠" };
  const surface = render([band, overlap]);
  assert.deepEqual(
    surface.elements.map((e) => e.id),
    ["b", "b2"],
  );
});

test("an axis needs `to` greater than `from`", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "axis", id: "a", label: "l", from: 5, to: 5, marks: [] }),
    /`to` greater than `from`/,
  );
});

test("an axis must declare marks, even an empty list", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "axis", id: "a", label: "l", from: 0, to: 1 }),
    /needs a `marks` array/,
  );
});

test("band emphasis is a closed set", () => {
  assert.throws(
    () => assertBlackboardEvent({ ...band, emphasis: "urgent" }),
    /`emphasis` must be one of/,
  );
});

test("a ragged table is refused rather than drawn crooked", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "table", id: "t", columns: ["a", "b"], rows: [["only one"]] }),
    /but there are 2 columns/,
  );
});

test("a table needs at least one column", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "table", id: "t", columns: [], rows: [] }),
    /non-empty `columns`/,
  );
});

test("highlight and erase work on the new kinds too", () => {
  const highlighted = render([axis, { at: 1, kind: "highlight", target: "ax" }]);
  assert.equal(highlighted.elements[0]?.highlighted, true);

  const erased = render([axis, table, { at: 3, kind: "erase", target: "ax" }]);
  assert.deepEqual(
    erased.elements.map((e) => e.id),
    ["tbl"],
  );
});

test("the rich escape hatch renders — it had never been exercised", () => {
  const rich: BlackboardEvent = {
    at: 0,
    kind: "rich",
    id: "r",
    format: "mermaid",
    body: "timeline\n  title 2026-03-08",
    declared: true,
  };
  const text = surfaceToText(render([rich]));
  assert.match(text, /\[富内容 mermaid\]/);
  assert.match(text, /title 2026-03-08/, "the body must actually reach the board");
});

test("render stays pure with the wider vocabulary", () => {
  const events = [axis, band, table];
  const first = render(events);
  const second = render(structuredClone(events));
  assert.deepEqual(first, second);
  assert.notEqual(first.elements[0], second.elements[0], "the surface must not alias caller data");
});

test("the recorded lesson uses the whole vocabulary and replays", () => {
  const steps = parseExplanation(EXPLAINER_FIXTURE).steps;
  const events = steps.flatMap((step) => (step.event === undefined ? [] : [step.event]));
  const surface = render(events);

  const kinds = new Set(surface.elements.map((e) => e.kind));
  for (const expected of ["text", "shape", "axis", "band", "table", "rich"]) {
    assert.ok(kinds.has(expected as never), `the fixture no longer exercises \`${expected}\``);
  }

  const text = surfaceToText(surface);
  assert.match(text, /\[轴 UTC 偏移量/);
  assert.match(text, /<< 注意/, "attention bands must be distinguishable from neutral ones");
  assert.match(text, /\[表格\]/);
});
