import type { Completion, CompletionRequest, ModelProvider, StreamEvent, Usage } from "./types.ts";
import { setPrice } from "./pricing.ts";
import { envNumber, envValue } from "./env.ts";
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

// The environment readers are shared with the Anthropic adapter now that there are two;
// two copies would eventually disagree about whitespace or about which name wins.

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

/** One server-sent event from a streamed completion. */
interface RawStreamChunk {
  choices?: Array<{ delta?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
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

  /**
   * Stream the turn, server-sent events.
   *
   * `stream_options.include_usage` is asked for because most compatible endpoints
   * report usage only on a final chunk. Without it a streamed turn would be costed
   * from an estimate while the same turn buffered is costed from the reply — one
   * session, two prices, depending on how it was delivered.
   *
   * Frames that are not JSON are refused rather than skipped. A gateway that
   * interleaves an HTML error page into the stream produces a body of text that
   * parses as nothing, and silently dropping the frame would turn that into a
   * short, plausible-looking answer.
   */
  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const messages = [
      ...(req.system === undefined ? [] : [{ role: "system", content: req.system }]),
      { role: "user", content: req.input },
    ];

    const body: Record<string, unknown> = {
      model: this.#config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.#config.maxTokens !== undefined) body.max_tokens = this.#config.maxTokens;

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`request to the provider failed before a response (actor ${req.actor}): ${reason}`);
    }

    if (!response.ok) {
      const failure = await response.text();
      throw new Error(
        `provider returned HTTP ${response.status} for actor ${req.actor}: ${failure.slice(0, 500)}`,
      );
    }
    if (response.body === null) {
      throw new Error(`provider returned no body to stream for actor ${req.actor}`);
    }

    let text = "";
    let usage: Usage | null = null;
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      // Frames are separated by a blank line, and the tail stays buffered: a frame
      // can be split across two network chunks, and parsing half a frame would
      // produce exactly the malformed-JSON failure this code refuses.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        const payload = dataLine?.slice(5).trim();
        if (payload !== undefined && payload !== "" && payload !== "[DONE]") {
          let parsed: RawStreamChunk;
          try {
            parsed = JSON.parse(payload) as RawStreamChunk;
          } catch {
            throw new Error(
              `provider sent a stream frame that is not JSON (actor ${req.actor}): ${payload.slice(0, 200)}`,
            );
          }

          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta !== "") {
            text += delta;
            yield { kind: "delta", text: delta };
          }

          const promptTokens = parsed.usage?.prompt_tokens;
          const completionTokens = parsed.usage?.completion_tokens;
          if (typeof promptTokens === "number" && typeof completionTokens === "number") {
            usage = { calls: 1, inputTokens: promptTokens, outputTokens: completionTokens };
          }
        }

        boundary = buffer.indexOf("\n\n");
      }
    }

    if (usage === null) {
      this.#usageEstimated = true;
      usage = {
        calls: 1,
        inputTokens: estimateTokens(`${req.system ?? ""}\n${req.input}`),
        outputTokens: estimateTokens(text),
      };
    }
    yield { kind: "usage", usage };
  }
}
