import type { Position } from "../events/types.ts";
import type { SessionLog } from "../events/log.ts";
import { appendEvent, appendNarration, nextAt } from "../events/log.ts";
import type { ExplanationStep } from "./explanation.ts";

/**
 * Apply interleaved narration/event steps to a log, continuing from wherever the
 * log currently ends.
 *
 * Shared by the first turn and by every resumed one, so that "where does the
 * timeline continue" is decided in exactly one place. Two implementations would
 * eventually disagree, and a resumed session whose positions overlap its own
 * history replays in the wrong order — which is a silent corruption, not a
 * crash, and it would only surface as a subtly wrong board.
 */
export function applySteps(
  log: SessionLog,
  steps: readonly ExplanationStep[],
  actor: Position,
): SessionLog {
  let current = log;
  let at = nextAt(current);

  for (const step of steps) {
    if (step.say !== undefined) {
      current = appendNarration(current, { at, actor, text: step.say });
      at += 1;
      continue;
    }
    if (step.event !== undefined) {
      current = appendEvent(current, { ...step.event, at });
      at += 1;
    }
  }

  return current;
}
