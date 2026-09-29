import type { SessionLog } from "../events/log.ts";
import type { Position } from "../events/types.ts";
import type { CompletionRequest, ModelProvider } from "../providers/types.ts";
import type { ExplanationStep } from "./explanation.ts";
import { StepScanner, parseExplanation } from "./explanation.ts";
import type { ReplyBudget } from "./retry.ts";
import { ModelReplyUnusable, retryNote } from "./retry.ts";
import { applySteps } from "./turn.ts";

export interface TurnOptions {
  /**
   * Rewrite a step before it lands.
   *
   * The narration places probes it did not author, and substituting the authored
   * question for the id has to happen identically whether or not the turn streamed —
   * otherwise a streamed session would put probe IDs on the blackboard.
   */
  prepare?: (step: ExplanationStep) => ExplanationStep;
  /**
   * Called after each step lands, so a live board can redraw and a learner can be asked.
   *
   * It may be async, because asking a person takes as long as it takes — the narration has to
   * be able to STOP at a probe rather than run to the end and collect answers afterwards.
   *
   * `source` is the step as it arrived, BEFORE `prepare`. That is the only place the probe id
   * still exists: `prepare` replaces `{probe:"Q1"}` with the authored question text, which is
   * what belongs on the board and not what identifies the probe.
   */
  onStep?: (
    log: SessionLog,
    step: ExplanationStep,
    source: ExplanationStep,
  ) => void | Promise<void>;
  /**
   * A pause where the caller may push the turn off course — the learner asking a question.
   *
   * Called at every step boundary, and a returned log must only EXTEND the current one:
   * an interjection is a detour inside the turn, not a rewrite of it. Its content is
   * recorded as ranges so the end-of-turn check can see through it (ADR 0008).
   */
  interlude?: (log: SessionLog) => SessionLog | undefined | Promise<SessionLog | undefined>;
  /**
   * Retry budget. Present means an unusable reply is retried once.
   *
   * A turn that has already put steps on the board is NOT retried, whatever the budget
   * says: the second attempt would append a second version of the same narration and the
   * learner would be taught it twice. Nothing-shown is the only safe point to try again,
   * and it is the point where almost every failure happens — a malformed reply fails to
   * parse before any step exists.
   */
  retry?: ReplyBudget;
}

export interface TurnResult {
  text: string;
  log: SessionLog;
  /** The steps, as they were applied. */
  steps: ExplanationStep[];
  /** True when the steps arrived incrementally rather than in one piece. */
  streamed: boolean;
}

/** A half-open [from, to) range of a stream that the turn's own steps did not put there. */
interface Interjection {
  narration: [number, number];
  events: [number, number];
}

/**
 * The content of a log in timeline order, positions stripped and interjection ranges removed.
 *
 * Used only when an interjection happened, where the strict comparison cannot apply: content
 * and order are what the check has always been about, and the interleaving of the two streams
 * is still compared here — only the position numbers, which an interjection necessarily moves,
 * are left out.
 */
function contentSequence(log: SessionLog, interjections: readonly Interjection[]): string[] {
  const dropped = (index: number, ranges: ReadonlyArray<[number, number]>): boolean =>
    ranges.some(([from, to]) => index >= from && index < to);

  const items: Array<{ at: number; content: unknown }> = [];
  log.narration.forEach((chunk, index) => {
    if (!dropped(index, interjections.map((interjection) => interjection.narration))) {
      items.push({ at: chunk.at, content: { stream: "say", actor: chunk.actor, text: chunk.text } });
    }
  });
  log.events.forEach((event, index) => {
    if (!dropped(index, interjections.map((interjection) => interjection.events))) {
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event)) {
        if (key !== "at") rest[key] = value;
      }
      items.push({ at: event.at, content: { stream: "event", event: rest } });
    }
  });

  return items
    .sort((a, b) => a.at - b.at)
    .map((item) => JSON.stringify(item.content));
}

/**
 * Run one turn and apply its steps — as they arrive, when the provider can stream.
 *
 * ADR 0005: "real-time starts when the list passes". Verification is not streamed, because
 * it happens on the small artifact and has to finish before anything is said. From here on,
 * whatever the provider hands over is applied immediately.
 */
export async function runTurn(
  provider: ModelProvider,
  request: CompletionRequest,
  log: SessionLog,
  actor: Position,
  options: TurnOptions = {},
): Promise<TurnResult> {
  const prepare = options.prepare ?? ((step: ExplanationStep) => step);

  // Steps handed to the learner so far, across every attempt. The whole reason a retry is
  // sometimes refused is this number.
  let landed = 0;

  // Content the turn did not author, inserted at boundaries by the interjection point. The
  // ranges are absolute indices and stay valid forever, because a log only ever grows.
  const interjections: Interjection[] = [];

  const land = async (
    current: SessionLog,
    step: ExplanationStep,
    source: ExplanationStep,
  ): Promise<SessionLog> => {
    let next = applySteps(current, [step], actor);
    landed += 1;
    await options.onStep?.(next, step, source);

    const after = await options.interlude?.(next);
    if (after !== undefined && after !== next) {
      if (after.narration.length < next.narration.length || after.events.length < next.events.length) {
        throw new Error(
          "an interjection must extend the log, not rewrite it — it is a detour inside the turn, " +
            "and the end-of-turn check has no way to see through a log that shrank",
        );
      }
      interjections.push({
        narration: [next.narration.length, after.narration.length],
        events: [next.events.length, after.events.length],
      });
      next = after;
    }
    return next;
  };

  const attempt = async (asked: CompletionRequest): Promise<TurnResult> => {
    if (provider.stream === undefined) {
      const completion = await provider.complete(asked);
      const raw = parseExplanation(completion.text).steps;
      let current = log;
      for (const source of raw) current = await land(current, prepare(source), source);
      return { text: completion.text, log: current, steps: raw.map(prepare), streamed: false };
    }

    const scanner = new StepScanner();
    let current = log;
    let text = "";
    const shown: ExplanationStep[] = [];

    for await (const event of provider.stream(asked)) {
      if (event.kind !== "delta") continue;
      text += event.text;
      for (const raw of scanner.push(event.text)) {
        // Parsed through the same door as a finished turn, so a streamed step is
        // validated exactly as strictly as a buffered one.
        const parsed = parseExplanation(`{"steps":[${raw}]}`).steps;
        const source = parsed[0] as ExplanationStep;
        current = await land(current, prepare(source), source);
        shown.push(prepare(source));
      }
    }

    // The check is on the LOG, not on a step count. What matters is that the board the
    // learner watched is the board the finished turn describes; comparing counts would
    // pass a scanner that swapped one step for another.
    const authoritative = applySteps(log, parseExplanation(text).steps.map(prepare), actor);
    const diverged =
      interjections.length === 0
        ? // Nothing interjected: bit for bit, exactly as before.
          JSON.stringify(authoritative.narration) !== JSON.stringify(current.narration) ||
          JSON.stringify(authoritative.events) !== JSON.stringify(current.events)
        : // Something interjected: the two logs can no longer be compared position by position,
          // because the interjection necessarily moved every position after it — and both sides
          // allocate positions from the same clock, so the numbers cannot be the defect this
          // check exists to catch. Content and order are still compared exactly, the interleaving
          // of the two streams included; a scanner that drops, invents or reorders a step still
          // fails here.
          JSON.stringify(contentSequence(authoritative, [])) !==
          JSON.stringify(contentSequence(current, interjections));
    if (diverged) {
      throw new Error(
        "the streamed turn and the finished turn do not describe the same board. The scan and the " +
          "parse disagreed, so the learner was shown something other than what was taught — refuse " +
          "the turn rather than write a log that contradicts itself.",
      );
    }

    return { text, log: current, steps: shown, streamed: true };
  };

  if (options.retry === undefined) return attempt(request);

  try {
    return await attempt(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (landed > 0) {
      throw new ModelReplyUnusable(
        `the turn from \`${request.actor}\` failed after ${landed} step(s) were already shown: ${reason}. ` +
          "A partially delivered turn cannot be retried — the second attempt would teach the same thing " +
          "twice — so this trial cannot be used.",
      );
    }

    options.retry.spend();
    try {
      return await attempt({ ...request, input: request.input + retryNote(reason) });
    } catch (second) {
      const again = second instanceof Error ? second.message : String(second);
      throw new ModelReplyUnusable(
        `\`${request.actor}\` returned an unusable reply twice.\nFirst: ${reason}\nSecond: ${again}`,
      );
    }
  }
}

export { ModelReplyUnusable, RETRY_ATTEMPTS } from "./retry.ts";
export type { ReplyBudget } from "./retry.ts";
