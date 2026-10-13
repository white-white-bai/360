import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import { EXPERIMENTS_DIR } from "../catalog.ts";
import { storeFilePath } from "../session/store.ts";
import type { TrialResult, TrialSource } from "./harness.ts";

/**
 * A trial a real learner sat (ADR 0019).
 *
 * SENSITIVE. This holds MORE than a session record does (ADR 0002): not only the
 * learner's answers and their misconceptions, but what they said they thought they
 * understood, and the label they were filed under. So it lives in a gitignored
 * directory, and it is never a place the platform reads from when teaching.
 *
 * It is not a second copy of the session — it is the row the report needs, which the
 * session log cannot be, because a log has no idea it was part of an experiment. The
 * session id is the key back to the log; `learner` and `recordedAt` are the two facts
 * a row needs in order to name itself; `domainId` is which experiment the row belongs
 * to, so a follow-up can find the checks the fixture was written for.
 */
export interface RecordedTrial {
  /** The session this trial came from. The follow-up finds the record by this. */
  sessionId: string;
  /** The label the learner was filed under. Fact one of naming a row. */
  learner: string;
  /** ISO 8601, when the trial was written. Fact two of naming a row. */
  recordedAt: string;
  domainId: string;
  trial: TrialResult;
}

function assertSource(value: unknown, where: string): asserts value is TrialSource {
  if (value !== "person" && value !== "simulation") {
    throw new Error(`${where}: \`source\` must be "person" or "simulation", got ${JSON.stringify(value)}`);
  }
}

/**
 * A record read off disk is data, not a trusted input, so it is re-validated rather
 * than cast. The validation is deliberately about the fields the report actually
 * reads and the store actually keys on — a full `TrialResult` schema would be a second
 * definition of a shape that already has one, and the two would drift.
 */
function assertRecordedTrial(value: unknown, path: string): asserts value is RecordedTrial {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path}: a recorded trial must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.trim() === "") {
    throw new Error(`${path}: a recorded trial needs a non-empty \`sessionId\``);
  }
  if (typeof record.learner !== "string" || record.learner.trim() === "") {
    throw new Error(`${path}: a recorded trial needs a non-empty \`learner\``);
  }
  if (typeof record.recordedAt !== "string" || record.recordedAt.trim() === "") {
    throw new Error(`${path}: a recorded trial needs a \`recordedAt\` date`);
  }
  const trial = record.trial;
  if (typeof trial !== "object" || trial === null) {
    throw new Error(`${path}: a recorded trial needs a \`trial\` object`);
  }
  // The one field the whole ADR turns on. A record whose source is missing or wrong
  // would be a row `compare` might pool with a script's, which is the thing ADR 0019
  // exists to make impossible.
  assertSource((trial as Record<string, unknown>).source, path);
}

/**
 * Real learners' trials on disk, one JSON file each, keyed by session id (ADR 0019).
 *
 * The id boundary is the session store's own (`storeFilePath`), reused rather than
 * re-implemented: a second copy of a security check is a second place for it to be
 * wrong. And `list` does NOT create the directory — a report must be able to read an
 * empty store and print an honest empty state without a read leaving a trace on disk.
 */
export class ExperimentStore {
  #dir: string;

  constructor(dir: string = EXPERIMENTS_DIR) {
    this.#dir = dir;
  }

  get dir(): string {
    return this.#dir;
  }

  #path(sessionId: string): string {
    return storeFilePath(this.#dir, sessionId);
  }

  save(record: RecordedTrial): void {
    if (record.learner.trim() === "") {
      throw new Error("a recorded trial must name the learner it was filed under");
    }
    if (record.trial.source !== "person") {
      throw new Error(
        `refusing to record a ${JSON.stringify(record.trial.source)} trial as a real learner's: ` +
          "this store holds people, and a simulated trial written here would be a script wearing a person's name",
      );
    }
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.#path(record.sessionId), JSON.stringify(record, null, 2), "utf8");
  }

  has(sessionId: string): boolean {
    return existsSync(this.#path(sessionId));
  }

  load(sessionId: string): RecordedTrial {
    const path = this.#path(sessionId);
    if (!existsSync(path)) {
      throw new Error(`no recorded trial \`${sessionId}\` in ${this.#dir}`);
    }
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    assertRecordedTrial(parsed, path);
    return parsed;
  }

  /**
   * Load, change, write back — the follow-up's shape.
   *
   * A follow-up measurement arrives in a LATER process (ADR 0019), so the record it
   * completes has to be read again from disk; a read-modify-write expressed here keeps
   * the path and the validation in one place rather than at every call site.
   */
  revise(sessionId: string, change: (record: RecordedTrial) => RecordedTrial): RecordedTrial {
    const revised = change(this.load(sessionId));
    this.save(revised);
    return revised;
  }

  /** Records in the order they were taken. Missing directory is an empty store, not an error. */
  list(): RecordedTrial[] {
    if (!existsSync(this.#dir)) return [];
    const records = readdirSync(this.#dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.load(name.slice(0, -".json".length)));
    return records.sort((a, b) =>
      a.recordedAt === b.recordedAt
        ? a.sessionId.localeCompare(b.sessionId)
        : a.recordedAt.localeCompare(b.recordedAt),
    );
  }
}
