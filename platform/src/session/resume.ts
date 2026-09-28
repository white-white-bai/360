import type { SessionLog } from "../events/log.ts";
import { eventsInOrder, nextAt } from "../events/log.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import type { SessionStore } from "./store.ts";

export interface ResumedSession {
  log: SessionLog;
  surface: Surface;
  /** The position the next turn will continue from. */
  continuesAt: number;
  /** Events, in timeline order, as the renderer sees them. */
  orderedEvents: ReturnType<typeof eventsInOrder>;
}

/**
 * Pick a session back up where it stopped (ADR 0002).
 *
 * There is deliberately no "restore the conversation state" step beyond reading
 * the log. Because the blackboard is event-sourced, the surface is a pure
 * function of the events — so resuming needs no re-derivation of anything, and
 * the replayed board is the same board the learner left. That is the payoff for
 * choosing event sourcing in the first place.
 */
export function resumeSession(store: SessionStore, sessionId: string): ResumedSession {
  const log = store.load(sessionId);
  return {
    log,
    surface: render(log.events),
    continuesAt: nextAt(log),
    orderedEvents: eventsInOrder(log),
  };
}
