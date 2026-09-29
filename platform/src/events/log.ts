import type { BlackboardEvent, NarrationChunk } from "./types.ts";
import { assertBlackboardEvent } from "./types.ts";

/**
 * The session log (ADR 0002, ADR 0005).
 *
 * Two blackboard streams on one timeline — narration and events — plus the
 * learner's own words.
 *
 * ADR 0005 calls narration and events "two streams", and that remains true: they
 * are what the TEACHER put on the board. `answers` is not a third stream; it is
 * the other side of the interaction, and it lives in the same file deliberately.
 * ADR 0002 accepted that a session record is sensitive *because* it holds the
 * learner's misconceptions and their own words — keeping the answers somewhere
 * else would give the most sensitive half of that record a different lifecycle, a
 * different deletion guarantee, and eventually a different owner.
 *
 * NOTE: never commit these. `.gitignore` excludes `.sessions/`.
 */
export interface AnswerChunk {
  at: number;
  /** The probe being answered, so an answer can never end up orphaned. */
  probeId: string;
  text: string;
}

export interface SessionLog {
  sessionId: string;
  narration: NarrationChunk[];
  events: BlackboardEvent[];
  answers: AnswerChunk[];
}

export function emptyLog(sessionId: string): SessionLog {
  return { sessionId, narration: [], events: [], answers: [] };
}

/** Next free position on the shared timeline. */
export function nextAt(log: SessionLog): number {
  let max = -1;
  for (const chunk of log.narration) if (chunk.at > max) max = chunk.at;
  for (const event of log.events) if (event.at > max) max = event.at;
  for (const answer of log.answers) if (answer.at > max) max = answer.at;
  return max + 1;
}

export function appendNarration(log: SessionLog, chunk: NarrationChunk): SessionLog {
  return { ...log, narration: [...log.narration, chunk] };
}

export function appendEvent(log: SessionLog, event: BlackboardEvent): SessionLog {
  assertBlackboardEvent(event);
  return { ...log, events: [...log.events, event] };
}

export function appendAnswer(log: SessionLog, answer: AnswerChunk): SessionLog {
  if (answer.probeId.trim() === "") {
    throw new Error("an answer must name the probe it answers");
  }
  return { ...log, answers: [...log.answers, answer] };
}

export function serializeLog(log: SessionLog): string {
  return JSON.stringify(log, null, 2);
}

function assertAnswer(value: unknown): asserts value is AnswerChunk {
  if (typeof value !== "object" || value === null) {
    throw new Error("each answer must be an object");
  }
  const answer = value as Record<string, unknown>;
  if (typeof answer.at !== "number" || !Number.isFinite(answer.at)) {
    throw new Error("an answer needs a finite numeric `at`");
  }
  if (typeof answer.probeId !== "string" || answer.probeId.trim() === "") {
    throw new Error("an answer needs a non-empty `probeId`");
  }
  if (typeof answer.text !== "string") {
    throw new Error("an answer needs a string `text`");
  }
}

/**
 * Parsing is a trust boundary: a log read off disk is data, and every event in it
 * is re-validated rather than assumed well-formed.
 *
 * `answers` defaults to an empty array, so a log written before the learner's side
 * was recorded still loads. That is not a compatibility shim for its own sake: the
 * alternative is a session that cannot be resumed, and losing a learner's history
 * to a field rename is exactly the kind of quiet breakage this file avoids.
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

  const answers = Array.isArray(candidate.answers) ? (candidate.answers as unknown[]) : [];
  for (const answer of answers) assertAnswer(answer);

  return {
    sessionId: candidate.sessionId,
    narration,
    events,
    answers: answers as AnswerChunk[],
  };
}

/** Events in timeline order. Two streams, one clock — ordering is derived. */
export function eventsInOrder(log: SessionLog): BlackboardEvent[] {
  return [...log.events].sort((a, b) => a.at - b.at);
}
