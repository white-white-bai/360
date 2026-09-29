import test from "node:test";
import assert from "node:assert/strict";

import { findCheck } from "../src/checks/load.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { deserializeLog, emptyLog, nextAt, serializeLog } from "../src/events/log.ts";
import { MEANINGFUL_RETENTION_HOURS, measureFollowUp } from "../src/session/measure.ts";

const library = loadLibrary();
const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
const terminal = findCheck(expert.domain.checks, "C-gap");
const transfer = findCheck(expert.domain.checks, "T-fixed-offset");

const TAUGHT_AT = new Date("2026-03-08T10:00:00.000Z");
const log = emptyLog("s", TAUGHT_AT.toISOString());

test("a session with no start time cannot be measured for retention", () => {
  // Retention is a claim about elapsed time. Without a start there is nothing to
  // measure against, and defaulting to "now" would silently turn every retention
  // number into zero hours.
  const timeless = { ...log, startedAt: null };
  assert.throws(
    () => measureFollowUp(timeless, terminal, "retention", terminal.expected),
    /no start time/,
  );
});

test("the elapsed time is computed from the log, not asserted by the caller", () => {
  const later = new Date(TAUGHT_AT.getTime() + 26 * 3_600_000);
  const followUp = measureFollowUp(log, terminal, "retention", terminal.expected, later);

  assert.equal(followUp.record.elapsedHours, 26);
  assert.equal(followUp.record.kind, "retention");
  assert.equal(followUp.record.checkId, terminal.id);
  assert.equal(followUp.record.verdict, "pass");
  assert.equal(followUp.meaningful, true);
});

test("a follow-up taken too soon says so rather than calling itself retention", () => {
  const soon = new Date(TAUGHT_AT.getTime() + 0.5 * 3_600_000);
  const followUp = measureFollowUp(log, terminal, "retention", terminal.expected, soon);

  assert.equal(followUp.meaningful, false, `under ${MEANINGFUL_RETENTION_HOURS}h is not retention`);
  assert.equal(followUp.record.elapsedHours, 0.5, "and the number that says so is kept");
});

test("retention and transfer differ by asset, not by grading", () => {
  const later = new Date(TAUGHT_AT.getTime() + 30 * 3_600_000);
  // The right answer to the terminal question is the WRONG answer to the transfer
  // question — which is the whole point of asking a different one.
  const keep = measureFollowUp(log, terminal, "retention", terminal.expected, later);
  const move = measureFollowUp(log, transfer, "transfer", terminal.expected, later);

  assert.equal(keep.record.verdict, "pass");
  assert.equal(move.record.verdict, "fail");
  assert.equal(move.record.kind, "transfer");
  assert.equal(move.record.checkId, transfer.id);
});

test("the measurement lands in the log, and survives a round trip", () => {
  const later = new Date(TAUGHT_AT.getTime() + 24 * 3_600_000);
  const followUp = measureFollowUp(log, transfer, "transfer", transfer.expected, later);

  assert.equal(followUp.log.followUps.length, 1);
  assert.equal(followUp.record.at, nextAt(log), "it takes the next position on the shared timeline");

  const restored = deserializeLog(serializeLog(followUp.log));
  assert.deepEqual(restored.followUps, followUp.log.followUps);
  assert.equal(restored.startedAt, log.startedAt, "the start time is part of the record, not of the reading");
});

test("a log written before any of this still loads", () => {
  const legacy = deserializeLog(JSON.stringify({ sessionId: "old", narration: [], events: [] }));
  assert.equal(legacy.startedAt, null, "null, never a fabricated start time");
  assert.deepEqual(legacy.followUps, []);
});
