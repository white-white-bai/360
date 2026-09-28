import type { Completion, CompletionRequest, ModelProvider } from "./types.ts";
import { estimateTokens } from "../util/tokens.ts";

/**
 * A provider seeded with canned responses, so the session plumbing can be
 * exercised deterministically and offline.
 *
 * This is a recorded-response fixture, not a model. It exists because Phase 1's
 * deliverable is "does the pipeline run end to end and replay faithfully", and
 * that question must be answerable without network access or credentials. Every
 * call is still metered, so the token accounting is exercised too.
 *
 * An actor with no scripted response is an ERROR, not an empty string: a missing
 * fixture usually means a call site was added without anyone thinking about what
 * that actor should produce, and silently returning "" would hide it.
 */
export class ScriptedProvider implements ModelProvider {
  #script: Map<string, string>;

  constructor(script: Record<string, string>) {
    this.#script = new Map(Object.entries(script));
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const text = this.#script.get(req.actor);
    if (text === undefined) {
      const known = [...this.#script.keys()].sort().join(", ") || "(none)";
      throw new Error(`no scripted response for actor \`${req.actor}\`; scripted: ${known}`);
    }
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
