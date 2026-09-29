import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { findCheck } from "../src/checks/load.ts";
import type { SessionLog } from "../src/events/log.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import type { ModelProvider } from "../src/providers/types.ts";
import { answeredQuestionScript } from "../src/session/fixtures-apparatus.ts";
import type { SessionStore } from "../src/session/store.ts";
import { createBoardServer } from "../src/ui/serve.ts";

/**
 * A cursor over a board's SSE stream, so "read to the next thing" means the next one after what
 * has already been consumed. Searching from the end of the buffer finds the first question every
 * time and answers a token that is already spent.
 */
function boardReader(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  let cursor = 0;
  return {
    async readUntil(needle: string): Promise<boolean> {
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
    },
    /** What has arrived past the cursor — where the payload of the thing just read begins. */
    tail(): string {
      return text.slice(cursor);
    },
    all(): string {
      return text;
    },
    /** Hang up: the learner walked away mid-lesson. */
    async close(): Promise<void> {
      await reader.cancel().catch(() => {});
    },
  };
}

/** A store that keeps sessions in memory, so a test can see what actually got saved. */
function memoryStore(): { store: SessionStore; saved: () => string[] } {
  const logs = new Map<string, SessionLog>();
  return {
    store: {
      save: (log) => { logs.set(log.sessionId, log); },
      load: (sessionId) => {
        const log = logs.get(sessionId);
        if (log === undefined) throw new Error(`no saved session \`${sessionId}\``);
        return log;
      },
      has: (sessionId) => logs.has(sessionId),
      delete: (sessionId) => {
        const existed = logs.delete(sessionId);
        return { existed, removed: existed, verified: !logs.has(sessionId) };
      },
      list: () => [...logs.keys()].sort(),
    },
    saved: () => [...logs.keys()],
  };
}

/**
 * The board is the only part of the platform whose failure a learner would SEE, and
 * the only part that cannot be exercised by calling a function. It is also the part
 * that already failed once in a way nothing caught: the page connected, streamed its
 * header, and then announced an empty session, because the fixture script and the
 * injected list disagreed about who generates the claims.
 */
async function withBoard(
  run: (base: string) => Promise<void>,
  provider?: ModelProvider,
  store?: SessionStore,
): Promise<void> {
  // Zero delay: the pacing is a fixture imitating a network, and a test should not
  // spend nine seconds pretending.
  const server = createBoardServer({
    chunkDelayMs: 0,
    ...(provider === undefined ? {} : { provider }),
    ...(store === undefined ? {} : { store }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    // A cancelled stream leaves its socket half-open on the client's side of the keep-alive,
    // and close() would sit and wait for it. Nothing is being asserted at this point, so the
    // connections are taken away rather than waited out.
    server.closeAllConnections();
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

// --------------------------------------------- the learner's own questions (ADR 0008) --

test("a question with no lesson taking it is refused, like an answer into nowhere", async () => {
  // A token that belongs to no connection — a replay, a lesson already over — must not be told
  // "ok": accepted-into-nowhere looks exactly like asked-and-will-be-answered.
  await withBoard(async (base) => {
    const response = await fetch(`${base}/question`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "no-such-token", text: "为什么？" }),
    });
    assert.equal(response.status, 409);
  });
});

test("the recorded demo keeps the bar closed: a recording has no answer on file", async () => {
  // Asking on the fixture board used to run past the end of the recorded script and kill the
  // session it was demonstrating. A script cannot branch on whether the learner asked, so the
  // board does not offer what it cannot answer — and the endpoint refuses rather than accepting
  // a question into a crash.
  await withBoard(async (base) => {
    const board = boardReader(await fetch(`${base}/board?learner=1`));
    assert.ok(await board.readUntil("event: meta\ndata: "));
    const meta = JSON.parse(board.tail().split("\n")[0] as string);

    assert.equal(meta.learner, true, "the page is still the learner — it can answer");
    assert.equal(meta.questions, false, "but it is not offered questions it cannot answer");

    const refused = await fetch(`${base}/question`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: meta.token, text: "为什么？" }),
    });
    assert.equal(refused.status, 409);

    await board.close();
  });
});

test("a tab closed mid-lesson still leaves a session that reaches its own end", async () => {
  // The close handler used to resolve only the wait that happened to be open, so the lesson then
  // asked its next question and held a ten-minute timer apiece — the hang that looks like nothing
  // happening. Being told nobody is there has to cover everything the session still had to ask.
  const memory = memoryStore();
  await withBoard(
    async (base) => {
      const board = boardReader(await fetch(`${base}/board?learner=1`));
      assert.ok(
        await board.readUntil("event: question\ndata:"),
        "the session is waiting on the learner, which is where a tab close lands",
      );
      await board.close();

      const deadline = Date.now() + 2000;
      while (memory.saved().length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(memory.saved().length, 1, "the abandoned session still reached its own end");
    },
    undefined,
    memory.store,
  );
});

test("with the page as the learner, a question is queued and taken at the next pause", async () => {
  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");

  await withBoard(
    async (base) => {
      const board = boardReader(await fetch(`${base}/board?learner=1`));

      // Park at the first probe: the session is waiting on the learner, which is exactly when a
      // person would think of something to ask.
      assert.ok(await board.readUntil("event: question\ndata:"), "the lesson asks its first question");
      const token = /"token":"([^"]+)"/.exec(board.tail())?.[1];
      assert.ok(token !== undefined && token !== "", "each question says which one to answer");

      const question = "时区和偏移量到底是什么关系？";
      const queued = await fetch(`${base}/question`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: question }),
      });
      assert.equal(queued.status, 200, "a question is accepted while the lesson is being taught");

      // One at a time: a second one behind it is refused rather than stacked up.
      const second = await fetch(`${base}/question`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: "再问一个" }),
      });
      assert.equal(second.status, 409);

      const probeAnswer = await fetch(`${base}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: "时区是规则，偏移量是某一瞬间的读数" }),
      });
      assert.equal(probeAnswer.status, 200);

      assert.ok(await board.readUntil("event: question-taken"), "the question is picked up at a pause");
      assert.ok(board.all().includes(question), "the page is told which question was picked up");
      assert.ok(await board.readUntil("好问题。偏移量是读数"), "and the answer reaches the board");

      // The lesson still reaches its own end: the detour gated nothing, and the rest of the
      // probes and the check are answered as they always were.
      for (;;) {
        if (!(await board.readUntil("event: question\ndata:"))) break;
        const next = board.tail();
        const nextToken = /"token":"([^"]+)"/.exec(next)?.[1];
        const kind = /"kind":"([^"]+)"/.exec(next)?.[1];
        assert.ok(nextToken !== undefined && nextToken !== "");
        const answered = await fetch(`${base}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: nextToken,
            text: kind === "check" ? check.expected : "时区是规则，偏移量是某一瞬间的读数",
          }),
        });
        assert.equal(answered.status, 200);
      }

      assert.ok(board.all().includes("event: done"), "the session reaches its verdict");
      assert.ok(board.all().includes('"passed":true'), "with the lesson's own check passed");
    },
    new ScriptedProvider(answeredQuestionScript()),
  );
});

test("a question queued behind the check is dropped when the lesson ends, and the page is told", async () => {
  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");

  await withBoard(
    async (base) => {
      const board = boardReader(await fetch(`${base}/board?learner=1`));

      // Answer probes until the terminal check is on screen.
      let token = "";
      for (;;) {
        assert.ok(await board.readUntil("event: question\ndata:"), "the lesson reaches its check");
        const chunk = board.tail();
        token = /"token":"([^"]+)"/.exec(chunk)?.[1] ?? "";
        const kind = /"kind":"([^"]+)"/.exec(chunk)?.[1];
        if (kind === "check") break;
        await fetch(`${base}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, text: "时区是规则，偏移量是某一瞬间的读数" }),
        });
      }

      // Ask while the check waits, then pass it. No teaching turn remains that could take the
      // question, so it must be dropped and the page told — never answered after class.
      const question = "这节课以后还能问吗？";
      const queued = await fetch(`${base}/question`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: question }),
      });
      assert.equal(queued.status, 200, "a question is accepted while the check is on screen");

      await fetch(`${base}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: check.expected }),
      });

      assert.ok(await board.readUntil("event: question-dropped"), "the page is told the question died");
      assert.ok(board.all().includes(question), "and which one it was");
      assert.ok(board.all().includes("event: done"));
      assert.ok(board.all().includes('"passed":true'));
    },
    new ScriptedProvider(answeredQuestionScript()),
  );
});
