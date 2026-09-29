import type { CompletionRequest } from "../providers/types.ts";
import type { SpendMeter } from "../providers/meter.ts";
import type { ReplyBudget } from "./retry.ts";
import { ModelReplyUnusable, retryNote } from "./retry.ts";

/**
 * One actor call, with a single retry when the reply cannot be used.
 *
 * ADR 0001's owner decided the policy after three live runs each died on a different model
 * slip: retry once, count every retry, and let the harness report a trial that still fails
 * as incomplete rather than as a pass or a failure.
 *
 * Only a reply that could not be INTERPRETED is retried. A transport failure has its own
 * error and its own causes, and hiding an outage behind a second attempt would turn "the
 * provider was down" into "the model was sloppy" — which is the wrong lesson to learn from
 * a failed run.
 */
export async function ask<T>(
  meter: SpendMeter,
  request: CompletionRequest,
  parse: (text: string) => T,
  budget: ReplyBudget,
): Promise<T> {
  const first = await meter.complete(request);
  try {
    return parse(first.text);
  } catch (firstError) {
    const reason = firstError instanceof Error ? firstError.message : String(firstError);
    budget.spend();
    const second = await meter.complete({ ...request, input: request.input + retryNote(reason) });
    try {
      return parse(second.text);
    } catch (secondError) {
      const again = secondError instanceof Error ? secondError.message : String(secondError);
      throw new ModelReplyUnusable(
        `\`${request.actor}\` returned an unusable reply twice.\nFirst: ${reason}\nSecond: ${again}`,
      );
    }
  }
}
