/**
 * What to do when a model reply cannot be used.
 *
 * A live model occasionally returns JSON that does not parse, or places a step the contract
 * does not allow. Before this, one slip destroyed a whole session — which measured the
 * model's typing rather than the teaching.
 *
 * The owner's decision, on ADR 0001's behalf: retry ONCE, COUNT every retry, and report a
 * trial that still fails as INCOMPLETE — not as a pass and not as a failure. The count is
 * kept per trial and reported per condition, because a design that makes more calls is more
 * exposed to this, and that exposure is part of its real cost rather than something to
 * hide. Folding it away would make the apparatus look cheaper than it is.
 */
export class ModelReplyUnusable extends Error {}

export class ReplyBudget {
  #retries = 0;

  /** How many extra calls this trial has already spent on replies it could not use. */
  get retries(): number {
    return this.#retries;
  }

  /** One more attempt is about to be made. Every one of these is a real, billed call. */
  spend(): void {
    this.#retries += 1;
  }
}

/** The retry limit. One, and it is a decision rather than a default. */
export const RETRY_ATTEMPTS = 1;

/**
 * The nudge appended to a retried request.
 *
 * Deliberately short. A parse failure's message now includes the raw reply, which is useful
 * to a human and expensive to send back, so the model gets the instruction and not the
 * evidence. Only the first line of the reason survives for the same reason.
 */
export function retryNote(reason: string): string {
  const first = reason.split("\n")[0] ?? "unparseable";
  return [
    "",
    "---",
    "Your previous reply could not be used.",
    `Reason: ${first.slice(0, 160)}`,
    "Reply with the JSON object only: no prose, no code fences, no commentary.",
  ].join("\n");
}
