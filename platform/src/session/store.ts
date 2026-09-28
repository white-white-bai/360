import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSIONS_DIR } from "../catalog.ts";
import type { SessionLog } from "../events/log.ts";
import { deserializeLog, serializeLog } from "../events/log.ts";

export interface DeleteOutcome {
  existed: boolean;
  removed: boolean;
  /** Re-checked against the filesystem after removal, not inferred from the unlink. */
  verified: boolean;
}

export interface SessionStore {
  save(log: SessionLog): void;
  load(sessionId: string): SessionLog;
  has(sessionId: string): boolean;
  delete(sessionId: string): DeleteOutcome;
  list(): string[];
}

/**
 * Sessions on disk, one JSON file each.
 *
 * ADR 0002 chose resumability and, in the same breath, accepted that the record
 * is sensitive: it holds the learner's misconceptions and their own words. That
 * gives this store two obligations, not one — keep the log, and be able to prove
 * it is gone. So `delete` re-checks the filesystem rather than trusting that the
 * unlink call succeeded, because "we asked it to delete" and "it is deleted" are
 * different claims and only the second one is worth anything.
 */
export class FileSessionStore implements SessionStore {
  #dir: string;

  constructor(dir: string = SESSIONS_DIR) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  get dir(): string {
    return this.#dir;
  }

  /**
   * Session ids reach the filesystem, so they are a boundary. `/` and `\` are
   * refused outright; a bare `.` or `..` is refused too, not because the
   * `.json` suffix makes traversal work, but because nothing legitimate needs
   * an id that looks like a directory hop.
   */
  #path(sessionId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || /^\.+$/.test(sessionId)) {
      throw new Error(
        `unsafe session id ${JSON.stringify(sessionId)}: use letters, digits, dot, dash or underscore`,
      );
    }
    return join(this.#dir, `${sessionId}.json`);
  }

  save(log: SessionLog): void {
    writeFileSync(this.#path(log.sessionId), serializeLog(log), "utf8");
  }

  load(sessionId: string): SessionLog {
    const path = this.#path(sessionId);
    if (!existsSync(path)) {
      throw new Error(`no saved session \`${sessionId}\` in ${this.#dir}`);
    }
    // Deserialisation re-validates every event: a log read off disk is data, not
    // a trusted input.
    return deserializeLog(readFileSync(path, "utf8"));
  }

  has(sessionId: string): boolean {
    return existsSync(this.#path(sessionId));
  }

  delete(sessionId: string): DeleteOutcome {
    const path = this.#path(sessionId);
    const existed = existsSync(path);
    if (existed) rmSync(path, { force: true });
    return { existed, removed: existed, verified: !existsSync(path) };
  }

  list(): string[] {
    return readdirSync(this.#dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
  }
}
