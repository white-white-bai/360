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
 * A step may also be a `probe`: a point where the session stops and asks the
 * learner to say something back (ADR 0013). The probe's TEXT is authored before
 * the narration, by a different actor, so the explainer is placing questions it
 * did not write rather than grading itself.
 *
 * The payload is JSON produced by a model, which makes `parseExplanation` a
 * trust boundary. Every event is re-validated; an unknown `kind` is refused
 * rather than passed to the renderer.
 */
export interface ExplanationStep {
  say?: string;
  event?: BlackboardEvent;
  /** A probe id, referencing a probe authored earlier in the session. */
  probe?: string;
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

    const forms = [typeof raw.say === "string", raw.event !== undefined, raw.probe !== undefined].filter(
      (present) => present,
    ).length;
    if (forms !== 1) {
      throw new Error(`${at} must have exactly one of \`say\`, \`event\` or \`probe\``);
    }

    if (typeof raw.say === "string") {
      if (raw.say.trim() === "") throw new Error(`${at} has an empty \`say\``);
      return { say: raw.say };
    }

    if (raw.probe !== undefined) {
      if (typeof raw.probe !== "string" || raw.probe.trim() === "") {
        throw new Error(`${at} \`probe\` must be a non-empty probe id`);
      }
      return { probe: raw.probe };
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
      if (step.event === undefined) {
        return step.probe === undefined ? { say: step.say } : { probe: step.probe };
      }
      return { event: { ...step.event, at: base + index } };
    }),
  };
}
