import type { ModelProvider } from "./types.ts";
import { AnthropicProvider, anthropicConfigFromEnv } from "./anthropic.ts";
import { configFromEnv, liveProvider as openAiLive } from "./openai.ts";

export interface LiveSelection {
  provider: ModelProvider;
  /** Which adapter is answering, and where. Never includes the key. */
  describe: string;
}

/**
 * The configured provider, whichever shape it speaks.
 *
 * Anthropic first, because its variables are unambiguous; the `OPENAI_API_KEY` name is
 * one people already have set for something else, which is why the OpenAI adapter
 * prefers `ATP_` and treats it as a fallback.
 *
 * Returns null rather than throwing, so a caller can fall back to fixtures. It is the
 * only place that decides which adapter a session gets, so "which model taught this"
 * has one answer no matter which entry point started the session.
 */
export function selectLiveProvider(env: NodeJS.ProcessEnv = process.env): LiveSelection | null {
  const anthropic = anthropicConfigFromEnv(env);
  if (anthropic !== null) {
    return {
      provider: new AnthropicProvider(anthropic),
      describe: `anthropic ${anthropic.model} at ${anthropic.baseUrl}`,
    };
  }

  const openai = openAiLive(env);
  if (openai === null) return null;
  const config = configFromEnv(env);
  return {
    provider: openai,
    describe: `openai-compatible ${config.model} at ${config.baseUrl}`,
  };
}
