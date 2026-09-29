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
  /** Called after each step lands, so a live board can redraw. */
  onStep?: (log: SessionLog, step: ExplanationStep) => void;
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

  const land = (current: SessionLog, step: ExplanationStep): SessionLog => {
    const next = applySteps(current, [step], actor);
    landed += 1;
    options.onStep?.(next, step);
    return next;
  };

  const attempt = async (asked: CompletionRequest): Promise<TurnResult> => {
    if (provider.stream === undefined) {
      const completion = await provider.complete(asked);
      const steps = parseExplanation(completion.text).steps.map(prepare);
      let current = log;
      for (const step of steps) current = land(current, step);
      return { text: completion.text, log: current, steps, streamed: false };
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
        const step = prepare(parsed[0] as ExplanationStep);
        current = land(current, step);
        shown.push(step);
      }
    }

    // The check is on the LOG, not on a step count. What matters is that the board the
    // learner watched is the board the finished turn describes; comparing counts would
    // pass a scanner that swapped one step for another.
    const authoritative = applySteps(log, parseExplanation(text).steps.map(prepare), actor);
    if (
      JSON.stringify(authoritative.narration) !== JSON.stringify(current.narration) ||
      JSON.stringify(authoritative.events) !== JSON.stringify(current.events)
    ) {
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
