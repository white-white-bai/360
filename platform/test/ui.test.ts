import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createBoardServer } from "../src/ui/serve.ts";
import type { ModelProvider } from "../src/providers/types.ts";

/**
 * The board is the only part of the platform whose failure a learner would SEE, and
 * the only part that cannot be exercised by calling a function. It is also the part
 * that already failed once in a way nothing caught: the page connected, streamed its
 * header, and then announced an empty session, because the fixture script and the
 * injected list disagreed about who generates the claims.
 */
async function withBoard(run: (base: string) => Promise<void>, provider?: ModelProvider): Promise<void> {
  // Zero delay: the pacing is a fixture imitating a network, and a test should not
  // spend nine seconds pretending.
  const server = createBoardServer({ chunkDelayMs: 0, ...(provider === undefined ? {} : { provider }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
}

test("the board page is served, and it is a consumer of Surface rather than of events", async () => {
  await withBoard(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /id="board"/, "the page needs somewhere to draw");
    // The page must never see the event vocabulary: if it did, there would be two
    // renderers of the same stream to keep in agreement.
    assert.doesNotMatch(html, /"kind"\s*:\s*"band"/);
    assert.match(html, /case "axis"/, "and it must handle the vocabulary it does receive");
  });
});

test("an unknown path is a 404, not an empty stream", async () => {
  await withBoard(async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

test("the board streams the loop and then states its own verdict", async () => {
  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board`)).text();

    assert.match(body, /^event: meta$/m);
    assert.ok(
      (body.match(/event: surface/g) ?? []).length > 5,
      "the board must fill up gradually, not arrive in one piece",
    );
    assert.ok(body.includes("event: done"), `the session must report its result, got:\n${body.slice(0, 400)}`);
    assert.ok(!body.includes("event: failed"), `nothing should have failed, got:\n${body.slice(0, 400)}`);
  });
});

test("the streamed session shows the whole loop, ending on the retake", async () => {
  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board`)).text();
    const done = JSON.parse(body.slice(body.indexOf("event: done") + "event: done\ndata: ".length).split("\n")[0] as string);

    // A learner who failed the first question, was challenged, re-taught and asked a
    // DIFFERENT one. Anything less means the board is not showing the loop.
    assert.equal(done.passed, true);
    assert.equal(done.retaken, true);
    assert.equal(done.checkId, "C-overlap");
  });
});

test("a broken session reaches the page instead of an empty board", async () => {
  // A provider that fails on the very first turn, so nothing lands. A server that
  // logged this to its own console and left the board blank would show a learner an
  // empty screen and call it a lesson.
  const broken: ModelProvider = {
    complete: async () => {
      throw new Error("the provider fell over");
    },
  };

  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board?live=1`)).text();
    assert.match(body, /event: failed/, "a broken session must not leave the board blank");
    assert.match(body, /the provider fell over/);
  }, broken);
});
