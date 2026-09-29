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

/**
 * A question the learner asked mid-lesson (ADR 0008).
 *
 * Recorded verbatim, and for two reasons. It is the learner's own words, which ADR
 * 0002 already makes sensitive — the same lifecycle as their answers, or the most
 * sensitive half of the record has a different one. And a REFUSED question is
 * evidence about the Domain boundary: alongside the misconception queue, it is the
 * half that says what learners wanted that this Domain does not cover.
 */
export interface QuestionChunk {
  at: number;
  text: string;
  /**
   * What came of it. A refusal is a delivery (ADR 0004: "I do not know" is a
   * first-class output), not a failure — but the record should say which one the
   * learner got.
   */
  outcome: "answered" | "refused";
}

/**
 * A measurement taken after the session, on the same learner (ADR 0001).
 *
 * Two kinds, and the difference is the asset, not the machinery. **Retention** asks
 * the same question again later: did it stick. **Transfer** asks a different question
 * covering the same claim: can they use it somewhere new. ADR 0001 makes both
 * secondary measures, and says they matter more than they look — a pass rate measured
 * minutes after teaching is a statement about the lesson, and these are statements
 * about the learner.
 *
 * `elapsedHours` is recorded rather than assumed. A "retention" measurement taken
 * minutes later is the terminal check wearing a different name, and the only thing
 * that distinguishes them is this number.
 */
export interface FollowUpRecord {
  at: number;
  kind: "retention" | "transfer";
  checkId: string;
  /** The learner's answer. Their own words, so it is as sensitive as the rest. */
  answer: string;
  verdict: "pass" | "fail";
  elapsedHours: number;
}

export interface SessionLog {
  sessionId: string;
  /** ISO 8601, or null for a log written before this was recorded. */
  startedAt: string | null;
  /**
   * Which Domain taught this session.
   *
   * A session is resumable (ADR 0002), and resuming means asking its checks again a day
   * later — which is impossible without knowing what was taught. Until this field existed
   * the record could not describe itself, so the follow-up measurement had to be told the
   * Domain by hand, and a session restored from disk was a lesson with no subject.
   */
  domainId: string | null;
  narration: NarrationChunk[];
  events: BlackboardEvent[];
  answers: AnswerChunk[];
  questions: QuestionChunk[];
  followUps: FollowUpRecord[];
}

export interface NewSession {
  startedAt?: string | null;
  domainId?: string | null;
}

export function emptyLog(sessionId: string, options: NewSession = {}): SessionLog {
  return {
    sessionId,
    startedAt: options.startedAt ?? new Date().toISOString(),
    domainId: options.domainId ?? null,
    narration: [],
    events: [],
    answers: [],
    questions: [],
    followUps: [],
  };
}

/** Next free position on the shared timeline. */
export function nextAt(log: SessionLog): number {
  let max = -1;
  for (const chunk of log.narration) if (chunk.at > max) max = chunk.at;
  for (const event of log.events) if (event.at > max) max = event.at;
  for (const answer of log.answers) if (answer.at > max) max = answer.at;
  for (const question of log.questions) if (question.at > max) max = question.at;
  for (const followUp of log.followUps) if (followUp.at > max) max = followUp.at;
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

export function appendQuestion(log: SessionLog, question: QuestionChunk): SessionLog {
  if (question.text.trim() === "") {
    throw new Error("a question must be the learner's words, not an empty string");
  }
  if (question.outcome !== "answered" && question.outcome !== "refused") {
    throw new Error(`a question's outcome must be answered or refused, got ${JSON.stringify(question.outcome)}`);
  }
  return { ...log, questions: [...log.questions, question] };
}

export function appendFollowUp(log: SessionLog, followUp: FollowUpRecord): SessionLog {
  if (followUp.checkId.trim() === "") {
    throw new Error("a follow-up must name the check it was graded against");
  }
  return { ...log, followUps: [...log.followUps, followUp] };
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

function assertQuestion(value: unknown): asserts value is QuestionChunk {
  if (typeof value !== "object" || value === null) {
    throw new Error("each question must be an object");
  }
  const question = value as Record<string, unknown>;
  if (typeof question.at !== "number" || !Number.isFinite(question.at)) {
    throw new Error("a question needs a finite numeric `at`");
  }
  if (typeof question.text !== "string" || question.text.trim() === "") {
    throw new Error("a question needs the learner's words, not an empty `text`");
  }
  if (question.outcome !== "answered" && question.outcome !== "refused") {
    throw new Error(`a question's outcome must be answered or refused, got ${JSON.stringify(question.outcome)}`);
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

  const questions = Array.isArray(candidate.questions) ? (candidate.questions as unknown[]) : [];
  for (const question of questions) assertQuestion(question);

  const followUps = Array.isArray(candidate.followUps) ? (candidate.followUps as unknown[]) : [];

  return {
    sessionId: candidate.sessionId,
    // Null rather than "now": a log that does not say when it happened must not be
    // given a start time by the act of reading it, or retention would be measured
    // from the moment of inspection.
    startedAt: typeof candidate.startedAt === "string" ? candidate.startedAt : null,
    domainId: typeof candidate.domainId === "string" ? candidate.domainId : null,
    narration,
    events,
    answers: answers as AnswerChunk[],
    questions: questions as QuestionChunk[],
    followUps: followUps as FollowUpRecord[],
  };
}

/** Events in timeline order. Two streams, one clock — ordering is derived. */
export function eventsInOrder(log: SessionLog): BlackboardEvent[] {
  return [...log.events].sort((a, b) => a.at - b.at);
}
