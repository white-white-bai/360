import type { Completion, CompletionRequest, ModelProvider, StreamEvent, Usage } from "./types.ts";
import { setPrice } from "./pricing.ts";
import { envNumber, envValue } from "./env.ts";
import { estimateTokens } from "../util/tokens.ts";

/**
 * Anthropic's Messages API.
 *
 * A separate adapter, not a flag on the OpenAI one, because the shapes genuinely
 * differ: the system prompt is a top-level parameter rather than a message, `max_tokens`
 * is required rather than optional, usage is `input_tokens`/`output_tokens` rather than
 * `prompt_tokens`/`completion_tokens`, and the streaming events are typed rather than
 * uniform. "OpenAI-compatible" quietly invites the assumption that it covers
 * everything, and it does not.
 *
 * The differences are mapped here and nowhere else: everything above this file sees a
 * `ModelProvider`, so no call site has to know which vendor is answering.
 */
export interface AnthropicConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Required by this API. There is no "let the model decide". */
  maxTokens: number;
  timeoutMs?: number;
  pricePerMTok?: { input: number; output: number };
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Pinned, because this API is versioned by header and a default would drift. */
const API_VERSION = "2023-06-01";

export function anthropicConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicConfig | null {
  const apiKey = envValue(env, "ATP_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY");
  const model = envValue(env, "ATP_ANTHROPIC_MODEL", "ANTHROPIC_MODEL");
  if (apiKey === undefined || model === undefined) return null;

  const priceIn = envNumber(env, "ATP_ANTHROPIC_PRICE_IN");
  const priceOut = envNumber(env, "ATP_ANTHROPIC_PRICE_OUT");

  return {
    baseUrl: envValue(env, "ATP_ANTHROPIC_BASE_URL") ?? DEFAULT_BASE_URL,
    apiKey,
    model,
    maxTokens: envNumber(env, "ATP_ANTHROPIC_MAX_TOKENS") ?? DEFAULT_MAX_TOKENS,
    timeoutMs: envNumber(env, "ATP_ANTHROPIC_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS,
    pricePerMTok:
      priceIn !== undefined && priceOut !== undefined ? { input: priceIn, output: priceOut } : undefined,
  };
}

interface RawMessage {
  content?: Array<{ type?: string; text?: unknown }>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

export class AnthropicProvider implements ModelProvider {
  #config: AnthropicConfig;
  #usageEstimated = false;

  constructor(config: AnthropicConfig) {
    this.#config = config;
    if (config.pricePerMTok !== undefined) {
      // Same mapping layer as the other adapter: the config mirrors what a person types
      // into an environment variable, the price table keeps its own vocabulary.
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
    return `${this.#config.baseUrl.replace(/\/+$/, "")}/messages`;
  }

  #headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.#config.apiKey,
      "anthropic-version": API_VERSION,
    };
  }

  #body(req: CompletionRequest, stream: boolean): Record<string, unknown> {
    return {
      model: this.#config.model,
      max_tokens: this.#config.maxTokens,
      // Top-level, not a message. Sending it as a message would work on the OpenAI
      // shape and be ignored here, which is the kind of difference that looks like the
      // model misbehaving.
      ...(req.system === undefined ? {} : { system: req.system }),
      messages: [{ role: "user", content: req.input }],
      ...(stream ? { stream: true } : {}),
    };
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(this.#body(req, false)),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`request to the provider failed before a response (actor ${req.actor}): ${reason}`);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`provider returned HTTP ${response.status} for actor ${req.actor}: ${raw.slice(0, 500)}`);
    }

    let parsed: RawMessage;
    try {
      parsed = JSON.parse(raw) as RawMessage;
    } catch {
      throw new Error(`provider returned non-JSON for actor ${req.actor}: ${raw.slice(0, 200)}`);
    }

    // `content` is a list of blocks and only the text ones matter here. Reading
    // `content[0].text` would break the moment a tool block came first.
    const text = (parsed.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (text === "") {
      throw new Error(`provider response for actor ${req.actor} has no text block: ${raw.slice(0, 200)}`);
    }

    const promptTokens = parsed.usage?.input_tokens;
    const completionTokens = parsed.usage?.output_tokens;
    const reported = typeof promptTokens === "number" && typeof completionTokens === "number";
    if (!reported) this.#usageEstimated = true;

    return {
      text,
      usage: {
        calls: 1,
        inputTokens: reported
          ? (promptTokens as number)
          : estimateTokens(`${req.system ?? ""}\n${req.input}`),
        outputTokens: reported ? (completionTokens as number) : estimateTokens(text),
      },
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(this.#body(req, true)),
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
    let outputTokens: number | null = null;
    let inputTokens: number | null = null;
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        const payload = dataLine?.slice(5).trim();
        if (payload !== undefined && payload !== "" && payload !== "[DONE]") {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            throw new Error(
              `provider sent a stream frame that is not JSON (actor ${req.actor}): ${payload.slice(0, 200)}`,
            );
          }

          // This API names its events, so the type decides what to read rather than a
          // shape probe on every frame.
          if (parsed.type === "content_block_delta") {
            const delta = (parsed.delta as { text?: unknown } | undefined)?.text;
            if (typeof delta === "string" && delta !== "") {
              text += delta;
              yield { kind: "delta", text: delta };
            }
          } else if (parsed.type === "message_start") {
            const usage = (parsed.message as { usage?: { input_tokens?: unknown } } | undefined)?.usage;
            if (typeof usage?.input_tokens === "number") inputTokens = usage.input_tokens;
          } else if (parsed.type === "message_delta") {
            const usage = parsed.usage as { output_tokens?: unknown } | undefined;
            if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens;
          } else if (parsed.type === "error") {
            const message = (parsed.error as { message?: unknown } | undefined)?.message;
            throw new Error(`provider streamed an error (actor ${req.actor}): ${String(message ?? payload)}`);
          }
        }

        boundary = buffer.indexOf("\n\n");
      }
    }

    let usage: Usage;
    if (typeof inputTokens === "number" && typeof outputTokens === "number") {
      usage = { calls: 1, inputTokens, outputTokens };
    } else {
      this.#usageEstimated = true;
      usage = {
        calls: 1,
        inputTokens: inputTokens ?? estimateTokens(`${req.system ?? ""}\n${req.input}`),
        outputTokens: outputTokens ?? estimateTokens(text),
      };
    }
    yield { kind: "usage", usage };
  }
}
