import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLocalEnv, parseLocalEnv } from "../src/util/local-env.ts";

/**
 * The local `.env` exists because `setx` only reaches terminals opened afterwards, and a person
 * who sets a key and reads "not set" reasonably concludes the machine is broken. What it must
 * never do: override the process, or treat a malformed line as a value.
 */

test("the format is lines, comments, optional quotes — and nothing else", () => {
  const values = parseLocalEnv(
    "\uFEFF# comment\nATP_API_KEY=\"sk-quoted\"\nATP_MODEL='m'\n\nnot a line\n=blank-name\nATP_ZDR=\nexport NOPE=1\n",
  );
  assert.deepEqual(values, { ATP_API_KEY: "sk-quoted", ATP_MODEL: "m" });
});

test("the process environment wins over the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "atp-env-"));
  try {
    const path = join(dir, ".env");
    writeFileSync(path, "ATP_API_KEY=from-file\nATP_MODEL=from-file\n", "utf8");
    const target: Record<string, string | undefined> = { ATP_MODEL: "from-process" };
    loadLocalEnv(path, target);
    assert.equal(target["ATP_MODEL"], "from-process", "a variable the process has is not overwritten");
    assert.equal(target["ATP_API_KEY"], "from-file", "a variable it lacks is filled in");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file is not an error", () => {
  const target: Record<string, string | undefined> = {};
  loadLocalEnv(join(tmpdir(), "atp-no-such-file", ".env"), target);
  assert.deepEqual(target, {});
});
