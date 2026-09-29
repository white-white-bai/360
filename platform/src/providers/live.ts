import type { ModelProvider } from "./types.ts";
import { AnthropicProvider, anthropicConfigFromEnv } from "./anthropic.ts";
import { OpenAiCompatibleProvider, configFromEnv, liveProvider as openAiLive } from "./openai.ts";
import { envValue } from "./env.ts";

export interface LiveSelection {
  provider: ModelProvider;
  /** Which adapter is answering, and where. Never includes the key. */
  describe: string;
}

/**
 * The models a session may be started with (ADR 0009).
 *
 * `ATP_MODELS`, when set, is a list an operator wrote — and its length is the honest
 * statement of what this deployment is willing to run and pay for, the same way the
 * Catalogue's length is the honest statement of what can be taught. With no list, the
 * one configured model is the whole choice, and a selector offering one option is
 * telling the truth about the machine.
 *
 * Deliberately not a discovery call to the endpoint's `/models`: that would make what
 * the page offers a function of whatever a gateway happens to expose, and an operator
 * would lose the ability to say "not this one" without changing the gateway.
 */
export function configuredModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = envValue(env, "ATP_MODELS");
  if (listed !== undefined) {
    return listed
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
  }

  // No list: the active adapter's own model is the single choice. Anthropic first, for
  // the same reason `selectLiveProvider` prefers it — its variables are unambiguous.
  const single = envValue(env, "ATP_ANTHROPIC_MODEL", "ANTHROPIC_MODEL", "ATP_MODEL");
  return single === undefined ? [] : [single];
}

/** The model a session gets when nobody chose one: the configured model, or the first offered. */
export function defaultModel(env: NodeJS.ProcessEnv = process.env): string | null {
  const models = configuredModels(env);
  if (models.length === 0) return null;
  const preferred = envValue(env, "ATP_ANTHROPIC_MODEL", "ANTHROPIC_MODEL", "ATP_MODEL");
  return preferred !== undefined && models.includes(preferred) ? preferred : (models[0] as string);
}

/**
 * The configured provider, whichever shape it speaks.
 *
 * Anthropic first, because its variables are unambiguous; the `OPENAI_API_KEY` name is
 * one people already have set for something else, which is why the OpenAI adapter
 * prefers `ATP_` and treats it as a fallback.
 *
 * `chosen.model` is how a session picks its model (ADR 0009). The choice is applied
 * HERE rather than by a second builder, because this is the only place allowed to
 * decide which adapter answers — "which model taught this" must not have two answers
 * depending on how the session was started.
 *
 * Returns null rather than throwing, so a caller can fall back to fixtures.
 */
export function selectLiveProvider(
  env: NodeJS.ProcessEnv = process.env,
  chosen: { model?: string } = {},
): LiveSelection | null {
  const anthropic = anthropicConfigFromEnv(env);
  if (anthropic !== null) {
    const config = chosen.model === undefined ? anthropic : { ...anthropic, model: chosen.model };
    return {
      provider: new AnthropicProvider(config),
      describe: `anthropic ${config.model} at ${config.baseUrl}`,
    };
  }

  const openai = openAiLive(env);
  if (openai === null) return null;
  const config = configFromEnv(env);

  if (chosen.model === undefined || chosen.model === config.model) {
    return {
      provider: openai,
      describe: `openai-compatible ${config.model} at ${config.baseUrl}`,
    };
  }

  return {
    provider: new OpenAiCompatibleProvider({ ...config, model: chosen.model }),
    describe: `openai-compatible ${chosen.model} at ${config.baseUrl}`,
  };
}
