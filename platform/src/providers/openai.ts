import type { Completion, CompletionRequest, ModelProvider } from "./types.ts";
import { setPrice } from "./pricing.ts";
import { estimateTokens } from "../util/tokens.ts";

/**
 * An OpenAI-compatible chat-completions client.
 *
 * One adapter rather than one per vendor, because the `/chat/completions` shape is
 * what OpenAI, DeepSeek, Qwen, vLLM and Ollama all speak. That is a deliberate
 * choice against lock-in: the platform needs an actor interface, not a vendor.
 *
 * Anthropic's API is NOT this shape and needs its own adapter — worth saying
 * plainly, because "OpenAI-compatible" quietly invites the assumption that it
 * covers everything.
 */
export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Optional, per million tokens, so the ledger reports money instead of tokens. */
  pricePerMTok?: { input: number; output: number };
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;

export class MissingProviderConfig extends Error {}

function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function envNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = envValue(env, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new MissingProviderConfig(`${name} must be a number, got ${JSON.stringify(raw)}`);
  return parsed;
}

/**
 * Read the configuration from the environment.
 *
 * `OPENAI_API_KEY` is accepted as a fallback because people already have it set,
 * but the `ATP_` names win, so a project can point at something else without
 * disturbing whatever else on the machine uses the conventional name.
 *
 * Failures name exactly which variable is missing. A provider that starts up and
 * then fails on the first call wastes a session's worth of time to learn something
 * that was knowable at startup.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAiCompatibleConfig {
  const apiKey = envValue(env, "ATP_API_KEY", "OPENAI_API_KEY");
  const model = envValue(env, "ATP_MODEL");

  const missing: string[] = [];
  if (apiKey === undefined) missing.push("ATP_API_KEY (or OPENAI_API_KEY)");
  if (model === undefined) missing.push("ATP_MODEL");
  if (missing.length > 0) {
    throw new MissingProviderConfig(
      `cannot start a live provider: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        "Also optional: ATP_BASE_URL, ATP_MAX_TOKENS, ATP_TIMEOUT_MS, ATP_PRICE_IN, ATP_PRICE_OUT.",
    );
  }

  const priceIn = envNumber(env, "ATP_PRICE_IN");
  const priceOut = envNumber(env, "ATP_PRICE_OUT");
  const pricePerMTok =
    priceIn !== undefined && priceOut !== undefined ? { input: priceIn, output: priceOut } : undefined;

  return {
    baseUrl: envValue(env, "ATP_BASE_URL") ?? DEFAULT_BASE_URL,
    apiKey: apiKey as string,
    model: model as string,
    maxTokens: envNumber(env, "ATP_MAX_TOKENS"),
    timeoutMs: envNumber(env, "ATP_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS,
    pricePerMTok,
  };
}

/** The live provider, or null when the environment does not configure one. */
export function liveProvider(env: NodeJS.ProcessEnv = process.env): OpenAiCompatibleProvider | null {
  const apiKey = envValue(env, "ATP_API_KEY", "OPENAI_API_KEY");
  const model = envValue(env, "ATP_MODEL");
  if (apiKey === undefined || model === undefined) return null;
  return new OpenAiCompatibleProvider(configFromEnv(env));
}

interface RawCompletion {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export class OpenAiCompatibleProvider implements ModelProvider {
  #config: OpenAiCompatibleConfig;
  /** Set when the endpoint reported no usage, so the ledger can say so. */
  #usageEstimated = false;

  constructor(config: OpenAiCompatibleConfig) {
    this.#config = config;
    if (config.pricePerMTok !== undefined) {
      // Two shapes on purpose: the config mirrors the environment variables a
      // person types, the price table mirrors its own vocabulary. Mapping here
      // keeps either from dictating the other's names.
      setPrice(config.model, {
        inputPerMTok: config.pricePerMTok.input,
        outputPerMTok: config.pricePerMTok.output,
      });
    }
  }

  get usageEstimated(): boolean {
    return this.#usageEstimated;
  }

  get endpoint(): string {
    return `${this.#config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const messages = [
      ...(req.system === undefined ? [] : [{ role: "system", content: req.system }]),
      { role: "user", content: req.input },
    ];

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.#config.model,
          messages,
          ...(this.#config.maxTokens === undefined ? {} : { max_tokens: this.#config.maxTokens }),
        }),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      // The key never appears in an error message. A thrown request error is the
      // easiest place to leak one, and the logs are the last place it should be.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`request to the provider failed before a response (actor ${req.actor}): ${reason}`);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `provider returned HTTP ${response.status} for actor ${req.actor}: ${body.slice(0, 500)}`,
      );
    }

    let parsed: RawCompletion;
    try {
      parsed = JSON.parse(body) as RawCompletion;
    } catch {
      throw new Error(`provider returned non-JSON for actor ${req.actor}: ${body.slice(0, 200)}`);
    }

    const text = parsed.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error(
        `provider response for actor ${req.actor} has no choices[0].message.content: ${body.slice(0, 200)}`,
      );
    }

    const promptTokens = parsed.usage?.prompt_tokens;
    const completionTokens = parsed.usage?.completion_tokens;
    const reported = typeof promptTokens === "number" && typeof completionTokens === "number";
    if (!reported) this.#usageEstimated = true;

    return {
      text,
      usage: {
        calls: 1,
        // Falling back to an estimate keeps the ledger populated, but it is an
        // estimate, and `usageEstimated` exists so a cost figure can never be
        // presented as measured when it is not.
        inputTokens: reported
          ? (promptTokens as number)
          : estimateTokens(`${req.system ?? ""}\n${req.input}`),
        outputTokens: reported ? (completionTokens as number) : estimateTokens(text),
      },
    };
  }
}
