import type { BlackboardEvent, NarrationChunk } from "./types.ts";
import { assertBlackboardEvent } from "./types.ts";

/**
 * The session log: narration and blackboard events as two streams on one
 * timeline (ADR 0005).
 *
 * Kept as the persisted artifact because a session is resumable (ADR 0002) and
 * because the event stream *is* the blackboard's state — replay is what makes
 * headless acceptance possible.
 *
 * NOTE: a log contains the learner's misconceptions and their own words. It is
 * sensitive and must never be committed; `.gitignore` excludes `.sessions/`.
 */
export interface SessionLog {
  sessionId: string;
  narration: NarrationChunk[];
  events: BlackboardEvent[];
}

export function emptyLog(sessionId: string): SessionLog {
  return { sessionId, narration: [], events: [] };
}

/** Next free position on the shared timeline. */
export function nextAt(log: SessionLog): number {
  let max = -1;
  for (const n of log.narration) if (n.at > max) max = n.at;
  for (const e of log.events) if (e.at > max) max = e.at;
  return max + 1;
}

export function appendNarration(log: SessionLog, chunk: NarrationChunk): SessionLog {
  return { ...log, narration: [...log.narration, chunk] };
}

export function appendEvent(log: SessionLog, event: BlackboardEvent): SessionLog {
  assertBlackboardEvent(event);
  return { ...log, events: [...log.events, event] };
}

export function serializeLog(log: SessionLog): string {
  return JSON.stringify(log, null, 2);
}

/**
 * Parsing is a trust boundary: a log read off disk is data, and every event in
 * it is re-validated rather than assumed well-formed.
 */
export function deserializeLog(text: string): SessionLog {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("session log must be a JSON object");
  }
  const candidate = parsed as Partial<SessionLog>;
  if (typeof candidate.sessionId !== "string") {
    throw new Error("session log needs a string `sessionId`");
  }
  const events = Array.isArray(candidate.events) ? candidate.events : [];
  for (const event of events) assertBlackboardEvent(event);
  const narration = Array.isArray(candidate.narration) ? candidate.narration : [];
  return { sessionId: candidate.sessionId, narration, events };
}

/** Events in timeline order. Two streams, one clock — ordering is derived. */
export function eventsInOrder(log: SessionLog): BlackboardEvent[] {
  return [...log.events].sort((a, b) => a.at - b.at);
}
