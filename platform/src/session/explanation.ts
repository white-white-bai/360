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

/**
 * Pull complete steps out of a partially-arrived `{"steps":[...]}` document.
 *
 * ADR 0005 promises the blackboard shows the teaching as it is SAID, so waiting for
 * the closing brace would throw away the only thing streaming was for. This scans
 * for complete step objects as the text arrives.
 *
 * It is a SCANNER, not a parser: brace depth and string state, and no opinion about
 * what the objects mean. The authoritative parse still happens on the finished text
 * and a disagreement between the two is an error — so a bug in here can change what
 * was SHOWN while a turn arrived, never what was taught.
 *
 * It lives beside the parser because it reads the same contract; that a fixture
 * provider also uses it to cut a recorded response into plausible chunks is a
 * consequence of that, not a reason to duplicate the rules.
 */
export class StepScanner {
  #buffer = "";
  #ends: number[] = [];
  #inArray = false;
  #depth = 0;
  #inString = false;
  #escaped = false;
  #start = -1;

  /** Feed a delta; get back any step objects that have just become complete. */
  push(delta: string): string[] {
    const complete: string[] = [];

    for (const character of delta) {
      this.#buffer += character;

      if (this.#escaped) {
        this.#escaped = false;
        continue;
      }
      if (this.#inString) {
        if (character === "\\") this.#escaped = true;
        else if (character === '"') this.#inString = false;
        continue;
      }
      if (character === '"') {
        this.#inString = true;
        continue;
      }

      if (!this.#inArray) {
        // Only the `[` that opens the `steps` array starts a capture, so a model that
        // says something before the JSON cannot shift the window.
        if (character === "[" && /"steps"\s*:\s*\[$/.test(this.#buffer)) this.#inArray = true;
        continue;
      }

      if (character === "{") {
        if (this.#depth === 0) this.#start = this.#buffer.length - 1;
        this.#depth += 1;
        continue;
      }
      if (character === "}") {
        if (this.#depth === 0) continue;
        this.#depth -= 1;
        if (this.#depth === 0 && this.#start >= 0) {
          complete.push(this.#buffer.slice(this.#start));
          this.#ends.push(this.#buffer.length);
          this.#start = -1;
        }
        continue;
      }
      if (character === "]") {
        // Only the `]` that closes the `steps` array ends the capture. A step may
        // contain arrays of its own — an axis has `marks` — and treating their `]`
        // as the end silently truncates the turn: the learner sees the first few
        // steps and then nothing, with no error anywhere.
        if (this.#depth === 0) this.#inArray = false;
        continue;
      }
    }

    return complete;
  }

  /** Buffer offsets just past each completed step — where a replay of a turn cuts. */
  get boundaries(): number[] {
    return [...this.#ends];
  }
}
