import type { Completion, CompletionRequest, ModelProvider } from "./types.ts";
import { estimateTokens } from "../util/tokens.ts";

/**
 * Deterministic stand-in for a model, so the cost estimate runs with no
 * credentials and no network.
 *
 * It produces no teaching content. It returns output of the size the caller
 * declared, and measures its own input honestly with `estimateTokens` — so the
 * whole path (text -> tokens -> cost) is exercised rather than short-circuited.
 * When real credentials exist, this is swapped out and the meter keeps working
 * unchanged; that is the point of building the wrapper now.
 */
export class FakeProvider implements ModelProvider {
  async complete(req: CompletionRequest): Promise<Completion> {
    const inputTokens = estimateTokens(`${req.system ?? ""}\n${req.input}`);
    const outputTokens = req.expectedOutputTokens ?? 200;
    return {
      text: `<fake actor=${req.actor} output=${outputTokens}tok>`,
      usage: { calls: 1, inputTokens, outputTokens },
    };
  }
}
