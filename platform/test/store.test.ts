import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyLog, appendEvent, appendNarration } from "../src/events/log.ts";
import { resumeSession } from "../src/session/resume.ts";
import { FileSessionStore } from "../src/session/store.ts";
import { applySteps } from "../src/session/turn.ts";
import { parseExplanation } from "../src/session/explanation.ts";

function freshStore(t: { after: (fn: () => void) => void }): FileSessionStore {
  const dir = mkdtempSync(join(tmpdir(), "atp-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new FileSessionStore(dir);
}

function sampleLog(sessionId: string) {
  let log = emptyLog(sessionId);
  log = appendNarration(log, { at: 0, actor: "lead-explainer", text: "先说结论" });
  log = appendEvent(log, { at: 1, kind: "text", id: "a", body: "结论" });
  return log;
}

test("a session survives a save/load round trip", (t) => {
  const store = freshStore(t);
  const log = sampleLog("s1");
  store.save(log);
  assert.deepEqual(store.load("s1"), log);
});

test("loading a session that was never saved is an error, not an empty session", (t) => {
  const store = freshStore(t);
  assert.throws(() => store.load("ghost"), /no saved session/);
});

test("session ids are a boundary: path separators and dot-hops are refused", (t) => {
  const store = freshStore(t);
  for (const bad of ["../escape", "a/b", "a\\b", "..", "."]) {
    assert.throws(() => store.has(bad), /unsafe session id/, `${bad} should be refused`);
  }
});

test("deletion is verified against the filesystem, not inferred", (t) => {
  const store = freshStore(t);
  store.save(sampleLog("s2"));

  const first = store.delete("s2");
  assert.deepEqual(first, { existed: true, removed: true, verified: true });
  assert.equal(store.has("s2"), false);

  const second = store.delete("s2");
  assert.deepEqual(second, { existed: false, removed: false, verified: true });
});

test("the store lists what it holds, sorted, and excludes anything else", (t) => {
  const store = freshStore(t);
  store.save(sampleLog("b"));
  store.save(sampleLog("a"));
  assert.deepEqual(store.list(), ["a", "b"]);
});

test("resuming continues the timeline instead of restarting it", (t) => {
  const store = freshStore(t);
  const log = sampleLog("s3");
  store.save(log);

  const resumed = resumeSession(store, "s3");
  assert.equal(resumed.continuesAt, 2, "next free position after at=0 and at=1");
  assert.equal(resumed.log.events.length, 1);
});

test("a resumed turn is added, never woven into history", (t) => {
  const store = freshStore(t);
  store.save(sampleLog("s4"));

  const before = resumeSession(store, "s4");
  const steps = parseExplanation(
    JSON.stringify({ steps: [{ say: "追问" }, { event: { kind: "text", id: "b", body: "回答" } }] }),
  ).steps;

  const extended = applySteps(before.log, steps, "lead-explainer");
  store.save(extended);
  const after = resumeSession(store, "s4");

  assert.equal(after.continuesAt, 4);
  // The board may only grow. If appending rewrote positions, a learner would
  // return to a board that had silently rearranged itself.
  const earlier = before.surface.elements;
  assert.deepEqual(
    after.surface.elements.slice(0, earlier.length),
    earlier,
    "everything already on the board must be untouched",
  );
  assert.deepEqual(
    after.surface.elements.map((e) => e.id),
    ["a", "b"],
  );
});

test("events appended out of order still replay in timeline order", (t) => {
  const store = freshStore(t);
  let log = emptyLog("s5");
  log = appendEvent(log, { at: 5, kind: "text", id: "later", body: "b" });
  log = appendEvent(log, { at: 2, kind: "text", id: "earlier", body: "a" });
  store.save(log);

  const resumed = resumeSession(store, "s5");
  assert.deepEqual(
    resumed.orderedEvents.map((e) => (e.kind === "text" ? e.id : e.kind)),
    ["earlier", "later"],
  );
  assert.deepEqual(
    resumed.surface.elements.map((e) => e.id),
    ["earlier", "later"],
  );
});
