import type { Completion, CompletionRequest, ModelProvider } from "./types.ts";
import { estimateTokens } from "../util/tokens.ts";

/**
 * A provider seeded with canned responses, so the pipeline can be exercised
 * deterministically and offline.
 *
 * A recorded-response fixture, not a model. Two behaviours are deliberate:
 *
 *   - An actor with no script is an ERROR, not an empty string. A missing fixture
 *     usually means a call site was added without anyone deciding what that actor
 *     should produce, and returning "" would hide it.
 *   - An actor can be given a SEQUENCE. The apparatus calls the explainer more
 *     than once — once for the claims, once to realise them, once more if a retry
 *     happens — and each call must return something different. Running past the
 *     end of a sequence is also an error, because a fixture that quietly repeats
 *     would let a runaway loop look like a passing test.
 */
export class ScriptedProvider implements ModelProvider {
  #script: Map<string, string[]>;
  #used: Map<string, number>;

  constructor(script: Record<string, string | string[]>) {
    this.#script = new Map(
      Object.entries(script).map(([actor, value]) => [actor, Array.isArray(value) ? [...value] : [value]]),
    );
    this.#used = new Map();
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
}
