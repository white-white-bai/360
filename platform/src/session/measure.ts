import type { FollowUpRecord, SessionLog } from "../events/log.ts";
import { appendFollowUp, nextAt } from "../events/log.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { UnderstandingCheck } from "../checks/types.ts";

/**
 * Hours below which a "retention" measurement is the terminal check wearing a
 * different name.
 *
 * ADR 0001 asks for a day. This is not that threshold — it is the point below which
 * CALLING the result retention would be false, and the report says so rather than
 * printing a number that looks like retention and is not. The elapsed time is
 * recorded with every measurement for exactly this reason.
 */
export const MEANINGFUL_RETENTION_HOURS = 12;

export interface FollowUp {
  record: FollowUpRecord;
  /** The log with the measurement appended, ready to be saved. */
  log: SessionLog;
  /** False when too little time has passed for the number to mean what it says. */
  meaningful: boolean;
}

/**
 * Take a measurement after the session (ADR 0001).
 *
 * Retention and transfer differ in which ASSET they use, not in how they are graded —
 * the same hand-authored checks, judged the same objective way, so the three measures
 * cannot drift apart from each other. Whether the answer came from a person hours
 * later or from a fixture is the caller's business; what this insists on is that the
 * elapsed time is real and recorded, because that is the only thing separating a
 * retention claim from a second opinion.
 */
export function measureFollowUp(
  log: SessionLog,
  check: UnderstandingCheck,
  kind: "retention" | "transfer",
  answer: string,
  now: Date = new Date(),
): FollowUp {
  if (log.startedAt === null) {
    throw new Error(
      `session \`${log.sessionId}\` has no start time, so a ${kind} measurement has nothing to measure ` +
        "against. Retention is a claim about elapsed time; without one this is just another check.",
    );
  }

  const started = Date.parse(log.startedAt);
  if (Number.isNaN(started)) {
    throw new Error(`session \`${log.sessionId}\` has an unparseable start time: ${log.startedAt}`);
  }

  const elapsedHours = Math.max(0, (now.getTime() - started) / 3_600_000);
  const record: FollowUpRecord = {
    at: nextAt(log),
    kind,
    checkId: check.id,
    answer,
    verdict: gradeObjectively(check, answer).verdict,
    elapsedHours,
  };

  return {
    record,
    log: appendFollowUp(log, record),
    meaningful: elapsedHours >= MEANINGFUL_RETENTION_HOURS,
  };
}
