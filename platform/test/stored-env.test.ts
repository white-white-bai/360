import test from "node:test";
import assert from "node:assert/strict";

import { staleEnvHint } from "../src/util/stored-env.ts";

/**
 * The mismatch that cost the most debugging time: setx wrote the value somewhere the running
 * terminal cannot see (see stored-env.ts). What the hint may and may not say is the whole
 * test surface — the stored value is a credential.
 */

test("a value stored but not present is named, with its length, never its text", () => {
  const hint = staleEnvHint({ ATP_API_KEY: "sk-secret-value", ATP_MODEL: "deepseek-chat" }, {});
  assert.ok(hint !== null);
  assert.match(hint, /ATP_API_KEY \(15 chars\)/);
  assert.match(hint, /ATP_MODEL/);
  assert.ok(!hint.includes("sk-secret-value"), "the key itself never leaves the module");
});

test("nothing is said when the process already has what is stored", () => {
  assert.equal(staleEnvHint({ ATP_API_KEY: "k" }, { ATP_API_KEY: "k" }), null);
  assert.equal(staleEnvHint({}, {}), null, "an empty registry is not a hint");
  assert.equal(staleEnvHint({ ATP_API_KEY: "" }, {}), null, "an empty stored value is not a value");
});

test("the OpenAI alias counts as having a key", () => {
  assert.equal(staleEnvHint({ ATP_API_KEY: "k" }, { OPENAI_API_KEY: "k" }), null);
});
