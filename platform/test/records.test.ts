import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { incompleteTrial } from "../src/experiment/harness.ts";
import type { RecordedTrial } from "../src/experiment/records.ts";
import { ExperimentStore } from "../src/experiment/records.ts";

function freshDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "atp-experiments-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function record(sessionId: string, learner = "alice"): RecordedTrial {
  return {
    sessionId,
    learner,
    recordedAt: "2026-01-02T03:04:05.000Z",
    domainId: "time-zones",
    // Built by the harness's own builder, not a hand-written literal: a second copy of
    // the trial shape here would be a second thing to keep in step with the harness.
    trial: incompleteTrial("apparatus", "person", undefined, 0, "written by the test", 0.5),
  };
}

test("a recorded trial survives a save/load round trip", (t) => {
  const store = new ExperimentStore(freshDir(t));
  const written = record("lesson-1");
  store.save(written);
  // Compared against the same JSON normalisation rather than the in-memory object: a
  // field that is `undefined` is simply absent on the way back, and asserting otherwise
  // would be a claim about JSON that JSON does not make.
  assert.deepEqual(store.load("lesson-1"), JSON.parse(JSON.stringify(written)));
});

test("a revised record is what a later read gets, not what was written first", (t) => {
  // The follow-up's shape (ADR 0019): the retention and transfer measurements arrive
  // in a LATER process, so the record has to be read again from disk, changed, and
  // written back — and the second read is the one that has to see the change.
  const store = new ExperimentStore(freshDir(t));
  store.save(record("lesson-1"));

  store.revise("lesson-1", (existing) => ({
    ...existing,
    trial: {
      ...existing.trial,
      retention: { passed: true, elapsedHours: 25.4, meaningful: true },
    },
  }));

  assert.equal(store.load("lesson-1").trial.retention?.elapsedHours, 25.4);
});

test("a missing store is empty and stays that way: reading creates nothing", (t) => {
  // A report must be able to read an empty store and print an honest empty state
  // without the read leaving a trace on disk.
  const dir = join(freshDir(t), "never-written");
  const store = new ExperimentStore(dir);
  assert.deepEqual(store.list(), []);
  assert.equal(existsSync(dir), false, "listing an empty store must not create one");
  assert.equal(store.has("lesson-1"), false);
});

test("records are listed in the order they were taken", (t) => {
  const store = new ExperimentStore(freshDir(t));
  const later = { ...record("lesson-2"), recordedAt: "2026-01-03T00:00:00.000Z" };
  store.save(later);
  store.save(record("lesson-1"));
  assert.deepEqual(
    store.list().map((saved) => saved.sessionId),
    ["lesson-1", "lesson-2"],
  );
});

test("session ids are a boundary here too: a path separator or a dot-hop is refused", (t) => {
  // The id check is the session store's own (`storeFilePath`), reused rather than
  // re-implemented — a second copy of a security check is a second place for it to
  // be wrong (ADR 0002).
  const store = new ExperimentStore(freshDir(t));
  for (const bad of ["../escape", "a/b", "a\\b", ".."]) {
    assert.throws(() => store.save(record(bad)), /unsafe session id/);
  }
});

test("a simulation cannot be filed as a real learner's trial", (t) => {
  // The one field the whole ADR turns on. A script was written to contain a
  // difference and a person was not, so a simulated trial written here would be a
  // script wearing a person's name (ADR 0019).
  const store = new ExperimentStore(freshDir(t));
  const simulated = {
    ...record("lesson-1"),
    trial: incompleteTrial("apparatus", "simulation", undefined, 0, "written by the test", 0.5),
  };
  assert.throws(() => store.save(simulated), /refusing to record a "simulation"/);
});

test("a record must name the learner it was filed under", (t) => {
  const store = new ExperimentStore(freshDir(t));
  assert.throws(() => store.save(record("lesson-1", "   ")), /must name the learner/);
});

test("a corrupt record is rejected on read, not cast into the report", (t) => {
  // A file on disk is data, not a trusted input. The source is the field the report
  // would pool a person with a script over, so a record that got it wrong has to
  // fail loudly at the boundary rather than reach a panel (ADR 0019).
  const dir = freshDir(t);
  const store = new ExperimentStore(dir);
  writeFileSync(
    join(dir, "lesson-1.json"),
    JSON.stringify({ ...record("lesson-1"), trial: { source: "script" } }),
    "utf8",
  );
  assert.throws(() => store.load("lesson-1"), /`source` must be "person" or "simulation"/);
});

test("a record with no learner on disk is rejected, not read as an empty label", (t) => {
  const dir = freshDir(t);
  const store = new ExperimentStore(dir);
  writeFileSync(join(dir, "lesson-1.json"), JSON.stringify({ ...record("lesson-1"), learner: "" }), "utf8");
  assert.throws(() => store.load("lesson-1"), /non-empty `learner`/);
});

test("loading a trial that was never recorded is an error, not an empty record", (t) => {
  const store = new ExperimentStore(freshDir(t));
  assert.throws(() => store.load("ghost"), /no recorded trial/);
  assert.equal(store.has("ghost"), false);
});

test("one unreadable file is named and skipped, not fatal to the whole shelf", (t) => {
  // ADR 0020: reading a directory is not reading a record. A scan that threw would let one
  // bad file destroy a report produced after every trial had already been run and paid for.
  // The good record is still returned; the bad one is named, not dropped.
  const dir = freshDir(t);
  const store = new ExperimentStore(dir);
  store.save(record("lesson-1"));

  // A truncated write: valid prefix, no closing brace. This is what a killed `writeFileSync`
  // used to leave, and it is the most common corruption a shelf sees.
  writeFileSync(join(dir, "broken.json"), '{"sessionId": "broken", "learner": "bob",', "utf8");

  const scan = store.scan();
  assert.deepEqual(scan.records.map((saved) => saved.sessionId), ["lesson-1"]);
  assert.equal(scan.unreadable.length, 1);
  assert.equal(scan.unreadable[0]?.file, "broken.json");
  // The reason describes the problem and does NOT repeat the path: `file` already carries the
  // name, so a caller prints `${file} — ${reason}` and the path does not appear twice.
  assert.match(scan.unreadable[0]?.reason ?? "", /^not JSON \(\d+ bytes\)$/);
  assert.doesNotMatch(scan.unreadable[0]?.reason ?? "", /broken\.json/);
  // `list` returns the readable shelf, and a caller that NAMED the broken record still hears
  // about it — the strictness moved, it did not disappear.
  assert.deepEqual(store.list().map((saved) => saved.sessionId), ["lesson-1"]);
  assert.throws(() => store.load("broken"), /not JSON/);
});

test("a crashed write leaves debris the scan ignores, never a half record", (t) => {
  // `save` writes beside the target and renames into place (ADR 0020), and the temporary name
  // deliberately does not end in `.json`. A process killed mid-write therefore leaves a `.tmp`
  // file that is not a sitting: it is neither listed nor reported as unreadable.
  const dir = freshDir(t);
  const store = new ExperimentStore(dir);

  // Exactly what a killed save would leave behind.
  writeFileSync(join(dir, "lesson-1.json.tmp"), '{"sessionId": "lesson-1", "lear', "utf8");
  const scan = store.scan();
  assert.deepEqual(scan.records, []);
  assert.deepEqual(scan.unreadable, []);

  // And a save over it lands whole, clearing its own temporary rather than adding to the debris.
  store.save(record("lesson-1"));
  assert.equal(existsSync(join(dir, "lesson-1.json.tmp")), false);
  assert.equal(store.load("lesson-1").sessionId, "lesson-1");
});
