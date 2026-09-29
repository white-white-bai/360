import type { Completion, CompletionRequest, ModelProvider, StreamEvent } from "./types.ts";
import { estimateTokens } from "../util/tokens.ts";
import { StepScanner } from "../session/explanation.ts";

/**
 * A provider seeded with canned responses, so the pipeline can be exercised
 * deterministically and offline.
 *
 * A recorded-response fixture, not a model. Three behaviours are deliberate:
 *
 *   - An actor with no script is an ERROR, not an empty string. A missing fixture
 *     usually means a call site was added without anyone deciding what that actor
 *     should produce, and returning "" would hide it.
 *   - An actor can be given a SEQUENCE. The apparatus calls the explainer more
 *     than once — once for the claims, once to realise them, once more if a retry
 *     happens — and each call must return something different. Running past the
 *     end of a sequence is also an error, because a fixture that quietly repeats
 *     would let a runaway loop look like a passing test.
 *   - It STREAMS, by cutting the recorded text at step boundaries. The pacing is
 *     simulated — a real model gets it from the network — and it exists so the live
 *     board can be looked at without a provider account. It is not evidence that a
 *     provider streams well.
 */
export class ScriptedProvider implements ModelProvider {
  #script: Map<string, string[]>;
  #used: Map<string, number>;
  #chunkDelayMs: number;

  constructor(script: Record<string, string | string[]>, options: { chunkDelayMs?: number } = {}) {
    this.#script = new Map(
      Object.entries(script).map(([actor, value]) => [actor, Array.isArray(value) ? [...value] : [value]]),
    );
    this.#used = new Map();
    this.#chunkDelayMs = options.chunkDelayMs ?? 0;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const responses = this.#script.get(req.actor);
    if (responses === undefined) {
      const known = [...this.#script.keys()].sort().join(", ") || "(none)";
      throw new Error(`no scripted response for actor \`${req.actor}\`; scripted: ${known}`);
    }

    const index = this.#used.get(req.actor) ?? 0;
    const text = responses[index];
    if (text === undefined) {
      throw new Error(
        `actor \`${req.actor}\` was called ${index + 1} time(s) but only ${responses.length} response(s) are scripted — ` +
          "add another, or the session is running more turns than intended",
      );
    }
    this.#used.set(req.actor, index + 1);

    return {
      text,
      usage: {
        calls: 1,
        inputTokens: estimateTokens(`${req.system ?? ""}\n${req.input}`),
        outputTokens: estimateTokens(text),
      },
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const completion = await this.complete(req);

    for (const chunk of cutAtStepBoundaries(completion.text)) {
      if (this.#chunkDelayMs > 0) await sleep(this.#chunkDelayMs);
      yield { kind: "delta", text: chunk };
    }
    yield { kind: "usage", usage: completion.usage };
  }
}

/**
 * Cut a recorded turn where its steps end.
 *
 * Uses the same scanner the session does, so the chunks a fixture produces and the
 * chunks a session expects cannot drift apart — a fixture that cut in the wrong
 * places would make the session's own consistency check fail, which is the right
 * outcome but a confusing one to debug.
 */
export function cutAtStepBoundaries(text: string): string[] {
  const scanner = new StepScanner();
  scanner.push(text);
  const ends = scanner.boundaries;

  const chunks: string[] = [];
  let from = 0;
  for (const end of ends) {
    chunks.push(text.slice(from, end));
    from = end;
  }
  chunks.push(text.slice(from));
  return chunks.filter((chunk) => chunk !== "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
