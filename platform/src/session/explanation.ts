import type { BlackboardEvent } from "../events/types.ts";
import { assertBlackboardEvent } from "../events/types.ts";

/**
 * What one turn of explanation returns.
 *
 * Narration and blackboard events arrive INTERLEAVED, in one ordered list, and
 * that is deliberate (ADR 0005): the product promises a blackboard that shows
 * the teaching as it is being said, so "says here, draws here" has to be
 * expressible. They are stored as two separate streams afterwards, sharing one
 * timeline — the interleaving is the input format, not the storage format.
 *
 * The payload is JSON produced by a model, which makes `parseExplanation` a
 * trust boundary. Every event is re-validated; an unknown `kind` is refused
 * rather than passed to the renderer.
 */
export interface ExplanationStep {
  say?: string;
  event?: BlackboardEvent;
}

export interface Explanation {
  steps: ExplanationStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExplanation(text: string): Explanation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`explanation is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    throw new Error("explanation must be an object with a `steps` array");
  }
  if (parsed.steps.length === 0) {
    throw new Error("explanation has no steps");
  }

  const steps: ExplanationStep[] = parsed.steps.map((raw, index) => {
    const at = `explanation step ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);

    const hasSay = typeof raw.say === "string";
    const hasEvent = raw.event !== undefined;
    if (hasSay === hasEvent) {
      throw new Error(`${at} must have exactly one of \`say\` or \`event\``);
    }

    if (hasSay) {
      const say = raw.say as string;
      if (say.trim() === "") throw new Error(`${at} has an empty \`say\``);
      return { say };
    }

    // `at` is assigned from the step order, so a model never chooses its own
    // position on the shared timeline.
    const candidate = { ...(raw.event as Record<string, unknown>), at: index };
    assertBlackboardEvent(candidate);
    return { event: candidate };
  });

  return { steps };
}

/** Shift step-assigned positions onto the log's shared timeline. */
export function offsetSteps(explanation: Explanation, base: number): Explanation {
  return {
    steps: explanation.steps.map((step, index) => {
      if (step.event === undefined) return { say: step.say };
      return { event: { ...step.event, at: base + index } };
    }),
  };
}
