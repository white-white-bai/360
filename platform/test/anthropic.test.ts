import test from "node:test";
import assert from "node:assert/strict";

import { AnthropicProvider, anthropicConfigFromEnv } from "../src/providers/anthropic.ts";
import { selectLiveProvider } from "../src/providers/live.ts";
import { configFromEnv } from "../src/providers/openai.ts";

const CONFIG = { baseUrl: "https://example.test/v1", apiKey: "secret-key", model: "m", maxTokens: 512 };
const REQUEST = { actor: "lead-explainer", model: "m", system: "you teach", input: "teach it" };

/** Replace fetch for one test, and put it back. Nothing here touches the network. */
function stubFetch(frames: { body: string; sse?: boolean; status?: number }): {
  calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });

    const status = frames.status ?? 200;
    if (frames.sse !== true) return new Response(frames.body, { status });

    const encoder = new TextEncoder();
    const pieces = frames.body.split("\n\n").filter((piece) => piece.trim() !== "");
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) controller.enqueue(encoder.encode(`${piece}\n\n`));
          controller.close();
        },
      }),
      { status },
    );
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("the request is the Anthropic shape, not the OpenAI one wearing its URL", async () => {
  const stub = stubFetch({ body: '{"content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":7,"output_tokens":3}}' });
  try {
    const completion = await new AnthropicProvider(CONFIG).complete(REQUEST);
    const call = stub.calls[0];

    assert.equal(call?.url, "https://example.test/v1/messages");
    assert.equal(call?.headers["x-api-key"], "secret-key", "the key goes in x-api-key, not a bearer header");
    assert.equal(call?.headers["anthropic-version"], "2023-06-01", "the API is versioned by header");
    // These three are the differences that make this a separate adapter.
    assert.equal(call?.body.system, "you teach", "system is top-level, not a message");
    assert.equal(call?.body.max_tokens, 512, "max_tokens is required here");
    assert.deepEqual(call?.body.messages, [{ role: "user", content: "teach it" }]);

    assert.equal(completion.text, "ok");
    assert.deepEqual(completion.usage, { calls: 1, inputTokens: 7, outputTokens: 3 });
  } finally {
    stub.restore();
  }
});

test("every text block is read, not just the first", async () => {
  // `content` is a list of blocks. Reading content[0].text happens to work until a
  // non-text block comes first, and then it silently returns nothing.
  const stub = stubFetch({
    body: '{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}],"usage":{"input_tokens":1,"output_tokens":2}}',
  });
  try {
    assert.equal((await new AnthropicProvider(CONFIG).complete(REQUEST)).text, "ab");
  } finally {
    stub.restore();
  }
});

test("a response with no text block is refused rather than read as empty", async () => {
  const stub = stubFetch({ body: '{"content":[{"type":"tool_use","id":"x"}],"usage":{"input_tokens":1,"output_tokens":2}}' });
  try {
    await assert.rejects(() => new AnthropicProvider(CONFIG).complete(REQUEST), /no text block/);
  } finally {
    stub.restore();
  }
});

test("streaming reads the named events and the usage that arrives in two of them", async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"，时区"}}',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":9}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ].join("\n\n");

  const stub = stubFetch({ body: frames, sse: true });
  try {
    const deltas: string[] = [];
    let usage = null;
    for await (const event of new AnthropicProvider(CONFIG).stream(REQUEST)) {
      if (event.kind === "delta") deltas.push(event.text);
      else usage = event.usage;
    }

    assert.deepEqual(deltas, ["你好", "，时区"], "one delta per text_delta, in order");
    assert.deepEqual(usage, { calls: 1, inputTokens: 11, outputTokens: 9 });
    assert.equal(stub.calls[0]?.body.stream, true);
  } finally {
    stub.restore();
  }
});

test("a streamed error event stops the turn instead of ending it politely", async () => {
  const stub = stubFetch({
    body: 'event: error\ndata: {"type":"error","error":{"message":"overloaded"}}',
    sse: true,
  });
  try {
    await assert.rejects(async () => {
      for await (const _ of new AnthropicProvider(CONFIG).stream(REQUEST)) void _;
    }, /overloaded/);
  } finally {
    stub.restore();
  }
});

test("the adapter is only chosen when its own variables are set", () => {
  assert.equal(anthropicConfigFromEnv({}), null);
  assert.equal(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "k" }), null, "a key without a model is not a provider");

  const config = anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude" });
  assert.equal(config?.model, "claude");
  assert.equal(config?.maxTokens, 4096, "there is no 'let the model decide' here, so there is a default");
});

test("Anthropic wins when both are configured, and OpenAI is the fallback", () => {
  // The OpenAI-compatible names are conventional ones people already have set for
  // something else, which is why they do not get to shadow an explicit choice.
  const both = selectLiveProvider({
    ANTHROPIC_API_KEY: "k",
    ANTHROPIC_MODEL: "claude",
    OPENAI_API_KEY: "k2",
    ATP_MODEL: "gpt",
  });
  assert.match(both?.describe ?? "", /^anthropic /);

  const onlyOpenAi = selectLiveProvider({ OPENAI_API_KEY: "k2", ATP_MODEL: "gpt" });
  assert.match(onlyOpenAi?.describe ?? "", /^openai-compatible /);

  assert.equal(selectLiveProvider({}), null);
});

test("the shared environment readers behave the same for both adapters", () => {
  // Extracted because two copies would drift; this is the contract they now share.
  assert.equal(configFromEnv({ ATP_API_KEY: "k", ATP_MODEL: "m" }).model, "m");
  assert.throws(() => configFromEnv({ ATP_API_KEY: "k", ATP_MODEL: "m", ATP_MAX_TOKENS: "lots" }), /must be a number/);
  assert.throws(
    () => anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m", ATP_ANTHROPIC_MAX_TOKENS: "lots" }),
    /must be a number/,
  );
});
