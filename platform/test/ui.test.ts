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

test("an answer for a token nobody is waiting on is refused", async () => {
  // 409, not 200. A question that is no longer waiting means the session moved on or timed out,
  // and an answer accepted into nowhere is worse than one refused — it would look delivered.
  await withBoard(async (base) => {
    const response = await fetch(`${base}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "no-such-token", text: "x" }),
    });
    assert.equal(response.status, 409);
  });
});

test("with the page as the learner, the board asks and WAITS", async () => {
  // The whole point of the two-way board: the session stops at a question instead of running to
  // the end and reading recorded answers. Without this the page is a recording of a lesson.
  const server = createBoardServer({ chunkDelayMs: 0, askLearner: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${base}/board`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";

    // A cursor rather than a search from the end: reading to the "next" thing has to mean the
    // next one after what has already been consumed, or every iteration finds the first question
    // again and answers a token that is already spent.
    let cursor = 0;
    const readUntil = async (needle: string): Promise<boolean> => {
      for (;;) {
        const found = text.indexOf(needle, cursor);
        if (found !== -1) {
          cursor = found + needle.length;
          return true;
        }
        const { value, done } = await reader.read();
        if (done) return false;
        text += decoder.decode(value, { stream: true });
      }
    };

    // Answer every question until the session stops asking. Answering one and walking away would
    // leave it waiting on the next — a real thing a learner can do, and its own problem, but not
    // something a test may leave hanging.
    let asked = 0;
    while (await readUntil("event: question")) {
      const token = /"token":"([^"]+)"/.exec(text.slice(cursor))?.[1];
      assert.ok(token !== undefined && token !== "", "each question says which one to answer");

      const posted = await fetch(`${base}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: "时区是规则，偏移量是某一瞬间的结果" }),
      });
      assert.equal(posted.status, 200, "an answer to a waiting question is accepted");
      asked += 1;
    }

    assert.ok(asked >= 1, "at least one question was put to the page");
    assert.match(text, /event: heard/, "and the answer reached the session");
    assert.match(text, /时区是规则/, "the page is told what it heard");
    assert.match(text, /event: done/, "and the session reached its own verdict");
    // The page has to be able to NAME the record, or a lesson taken in a browser is one nobody
    // can come back to — and coming back is the only thing that makes retention mean anything.
    assert.match(text, /"sessionId":"board-/, "the verdict carries the session it belongs to");
    assert.match(text, /"saved":true/, "and says whether it was kept");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
