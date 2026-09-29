import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { MissingProviderConfig, OpenAiCompatibleProvider, configFromEnv } from "../src/providers/openai.ts";
import { priceFor } from "../src/providers/pricing.ts";

interface WireBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
}

interface Stub {
  url: string;
  received: Array<{ authorization?: string; contentType?: string; body: WireBody }>;
  close(): Promise<void>;
}

/**
 * A local stand-in for an OpenAI-compatible endpoint.
 *
 * Testing the live client against a stub rather than a real vendor is not a
 * compromise: what needs verifying is the request it builds and how it reads the
 * reply, and neither of those is more true because a network was involved. It also
 * means the error paths — which are the ones that matter and the ones nobody
 * exercises by hand — get tested on every run.
 */
async function startStub(reply: (body: WireBody) => { status: number; text: string }): Promise<Stub> {
  const received: Stub["received"] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      const body = raw === "" ? {} : (JSON.parse(raw) as WireBody);
      received.push({
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body,
      });
      const { status, text } = reply(body);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(text);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const OK_REPLY = JSON.stringify({
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 11, completion_tokens: 2 },
});

test("the request carries the model, the messages and a bearer token", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: OK_REPLY }));
  t.after(() => stub.close());

  const provider = new OpenAiCompatibleProvider({
    baseUrl: stub.url,
    apiKey: "test-key",
    model: "test-model",
  });

  await provider.complete({ actor: "lead-explainer", model: "ignored", system: "SYS", input: "USR" });

  const sent = stub.received[0];
  assert.equal(sent?.body.model, "test-model", "the configured model wins, not the request's");
  assert.deepEqual(sent?.body.messages, [
    { role: "system", content: "SYS" },
    { role: "user", content: "USR" },
  ]);
  assert.equal(sent?.authorization, "Bearer test-key");
  assert.equal(sent?.contentType, "application/json");
});

test("a request without a system prompt sends only the user message", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: OK_REPLY }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" });

  await provider.complete({ actor: "a", model: "m", input: "USR" });
  assert.deepEqual(stub.received[0]?.body.messages, [{ role: "user", content: "USR" }]);
});

test("reported usage is used as reported", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: OK_REPLY }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" });

  const completion = await provider.complete({ actor: "a", model: "m", input: "hello" });
  assert.equal(completion.text, "ok");
  assert.equal(completion.usage.inputTokens, 11);
  assert.equal(completion.usage.outputTokens, 2);
  assert.equal(provider.usageEstimated, false);
});

test("a missing usage block falls back to an estimate AND says so", async (t) => {
  // The fallback keeps the ledger populated, but an estimate presented as measured
  // is a lie about the cost. The flag is the difference.
  const stub = await startStub(() => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" });

  const completion = await provider.complete({ actor: "a", model: "m", input: "hello there" });
  assert.ok(completion.usage.inputTokens > 0, "an estimate is better than zero");
  assert.equal(provider.usageEstimated, true);
});

test("max_tokens is omitted by default and sent when configured", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: OK_REPLY }));
  t.after(() => stub.close());

  await new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" }).complete({
    actor: "a",
    model: "m",
    input: "x",
  });
  assert.equal(stub.received[0]?.body.max_tokens, undefined);

  await new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m", maxTokens: 256 }).complete({
    actor: "a",
    model: "m",
    input: "x",
  });
  assert.equal(stub.received[1]?.body.max_tokens, 256);
});

test("an HTTP error is reported with the status and a body snippet", async (t) => {
  const stub = await startStub(() => ({ status: 429, text: '{"error":{"message":"rate limited"}}' }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "super-secret-key", model: "m" });

  await assert.rejects(
    () => provider.complete({ actor: "a", model: "m", input: "x" }),
    (error: Error) => {
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, /rate limited/);
      assert.ok(
        !error.message.includes("super-secret-key"),
        "an error message is the easiest place to leak a credential",
      );
      return true;
    },
  );
});

test("a non-JSON body is refused", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: "<html>gateway</html>" }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" });
  await assert.rejects(() => provider.complete({ actor: "a", model: "m", input: "x" }), /non-JSON/);
});

test("a response with no choices is refused rather than silently empty", async (t) => {
  const stub = await startStub(() => ({ status: 200, text: JSON.stringify({ usage: {} }) }));
  t.after(() => stub.close());
  const provider = new OpenAiCompatibleProvider({ baseUrl: stub.url, apiKey: "k", model: "m" });
  await assert.rejects(() => provider.complete({ actor: "a", model: "m", input: "x" }), /no choices/);
});

// ------------------------------------------------------------------- config --

test("configuration failures name exactly what is missing", () => {
  assert.throws(() => configFromEnv({} as NodeJS.ProcessEnv), (error: Error) => {
    assert.ok(error instanceof MissingProviderConfig);
    assert.match(error.message, /ATP_API_KEY/);
    assert.match(error.message, /ATP_MODEL/);
    return true;
  });
});

test("the base URL defaults, and the conventional key is accepted as a fallback", () => {
  const config = configFromEnv({ OPENAI_API_KEY: "from-env", ATP_MODEL: "m" } as NodeJS.ProcessEnv);
  assert.equal(config.apiKey, "from-env");
  assert.equal(config.baseUrl, "https://api.openai.com/v1");
});

test("the ATP_ names win over the conventional ones", () => {
  const config = configFromEnv({
    OPENAI_API_KEY: "conventional",
    ATP_API_KEY: "explicit",
    ATP_MODEL: "m",
    ATP_BASE_URL: "http://localhost:11434/v1",
  } as NodeJS.ProcessEnv);
  assert.equal(config.apiKey, "explicit");
  assert.equal(config.baseUrl, "http://localhost:11434/v1");
});

test("a configured price replaces the placeholder for that model", () => {
  new OpenAiCompatibleProvider({
    baseUrl: "http://unused.invalid/v1",
    apiKey: "k",
    model: "priced-model",
    pricePerMTok: { input: 1, output: 2 },
  });
  assert.deepEqual(priceFor("priced-model"), { inputPerMTok: 1, outputPerMTok: 2 });
});
