import test from "node:test";
import assert from "node:assert/strict";

import type { BlackboardEvent } from "../src/events/types.ts";
import { assertBlackboardEvent } from "../src/events/types.ts";
import {
  appendEvent,
  appendNarration,
  deserializeLog,
  emptyLog,
  eventsInOrder,
  nextAt,
  serializeLog,
} from "../src/events/log.ts";
import { render } from "../src/render/render.ts";

const events: BlackboardEvent[] = [
  { at: 0, kind: "text", id: "title", body: "时间戳不是时间" },
  { at: 1, kind: "text", id: "t1", body: "UTC 是一个偏移量为 0 的时区" },
  { at: 2, kind: "shape", id: "arrow1", shape: "arrow", from: "title", to: "t1" },
  { at: 3, kind: "highlight", target: "t1" },
  { at: 4, kind: "point", target: "t1" },
  { at: 5, kind: "text", id: "t2", body: "GMT 是另一个东西" },
  { at: 6, kind: "erase", target: "t2" },
  { at: 7, kind: "rich", id: "tz", format: "mermaid", body: "timeline ...", declared: true },
];

test("render is a pure function of the event list", () => {
  const a = render(events);
  const b = render(structuredClone(events));
  assert.deepEqual(a, b, "same events must give the same surface");
});

test("render does not mutate its input", () => {
  const before = JSON.stringify(events);
  render(events);
  assert.equal(JSON.stringify(events), before);
});

test("highlight, pointer and erase apply in order", () => {
  const surface = render(events);
  const ids = surface.elements.map((e) => e.id);
  assert.deepEqual(ids, ["title", "t1", "arrow1", "tz"], "t2 was erased");
  assert.equal(surface.elements.find((e) => e.id === "t1")?.highlighted, true);
  assert.equal(surface.elements.find((e) => e.id === "title")?.highlighted, false);
  assert.equal(surface.pointer, "t1");
});

test("a prefix plus the rest equals the whole", () => {
  const prefix = render(events.slice(0, 5));
  assert.deepEqual(prefix.elements.map((e) => e.id), ["title", "t1", "arrow1"]);
  assert.deepEqual(render(events), render(events));
});

test("the vocabulary is closed: an unknown kind is rejected at the boundary", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "draw_whatever_i_like", id: "x" }),
    /vocabulary is closed/,
  );
});

test("the rich escape hatch must be declared", () => {
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "rich", id: "x", format: "svg", body: "<svg/>" }),
    /declared/,
  );
  assert.throws(
    () => assertBlackboardEvent({ at: 0, kind: "rich", id: "x", format: "html", body: "<div/>", declared: true }),
    /format.*must be one of/,
  );
});

test("render orders by the timeline coordinate, not by array position", () => {
  // The distinction is invisible while events are appended in order, and becomes
  // a silently rearranged board the moment a log is read back from disk.
  const outOfOrder: BlackboardEvent[] = [
    { at: 5, kind: "text", id: "later", body: "b" },
    { at: 2, kind: "text", id: "earlier", body: "a" },
  ];
  assert.deepEqual(
    render(outOfOrder).elements.map((e) => e.id),
    ["earlier", "later"],
  );
});

test("events sharing a position keep their array order", () => {
  const tied: BlackboardEvent[] = [
    { at: 1, kind: "text", id: "first", body: "a" },
    { at: 1, kind: "text", id: "second", body: "b" },
  ];
  assert.deepEqual(
    render(tied).elements.map((e) => e.id),
    ["first", "second"],
  );
});

test("narration and events share one timeline but stay separable", () => {
  let log = emptyLog("s1");
  log = appendNarration(log, { at: 0, actor: "lead-explainer", text: "先说结论" });
  log = appendEvent(log, { at: 1, kind: "text", id: "a", body: "结论" });
  log = appendNarration(log, { at: 2, actor: "lead-explainer", text: "为什么" });

  assert.equal(nextAt(log), 3);
  assert.equal(log.narration.length, 2, "narration is its own stream");
  assert.equal(log.events.length, 1, "events are their own stream");

  // Replaying the surface needs only the events, never the narration.
  assert.deepEqual(render(log.events).elements.map((e) => e.id), ["a"]);
});

test("a log survives a serialize/deserialize round trip", () => {
  let log = emptyLog("s2");
  log = appendEvent(log, { at: 0, kind: "text", id: "z", body: "内容" });
  log = appendNarration(log, { at: 1, actor: "challenger", text: "但是……" });

  const restored = deserializeLog(serializeLog(log));
  assert.deepEqual(restored, log);
  assert.deepEqual(render(restored.events), render(log.events));
});

test("a corrupt log is rejected rather than half-read", () => {
  assert.throws(() => deserializeLog('{"sessionId":"s","events":[{"at":0,"kind":"nope"}]}'), /closed/);
  assert.throws(() => deserializeLog('{"nope":1}'), /sessionId/);
});

test("events can be read in timeline order regardless of insertion order", () => {
  let log = emptyLog("s3");
  log = appendEvent(log, { at: 5, kind: "text", id: "later", body: "b" });
  log = appendEvent(log, { at: 2, kind: "text", id: "earlier", body: "a" });
  // Narrow explicitly rather than reaching for `.id`: only the kinds that CREATE
  // an element carry an id. Point, Highlight and Erase carry a `target` instead,
  // because they change focus or remove something rather than adding it — which
  // is exactly the distinction the union is there to enforce.
  const ids = eventsInOrder(log).map((event) => (event.kind === "text" ? event.id : event.kind));
  assert.deepEqual(ids, ["earlier", "later"]);
});
