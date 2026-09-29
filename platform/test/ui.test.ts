import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { findCheck } from "../src/checks/load.ts";
import {
  BUILD_PEDAGOGY,
  BUILD_PLAN,
  BUILD_PLAN_TWIN,
  BUILD_SELECTION,
  builderScript,
  documentedFetcher,
} from "../src/build/fixtures-build.ts";
import type { SessionLog } from "../src/events/log.ts";
import { composeExpert, loadLibrary } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import type { ModelProvider } from "../src/providers/types.ts";
import { answeredQuestionScript, cleanScript, misconceptionScript } from "../src/session/fixtures-apparatus.ts";
import { APPARATUS_VERDICTS_UNSUPPORTED } from "../src/session/fixtures-apparatus.ts";
import type { SessionStore } from "../src/session/store.ts";
import { createBoardServer } from "../src/ui/serve.ts";

/** The shape `/options` promises the page (ADR 0009). */
interface BoardOptionsPayload {
  live: boolean;
  provider: string | null;
  domains: Array<{ id: string; label: string; detail: string }>;
  styles: Array<{ id: string; label: string; detail: string }>;
  personas: Array<{ id: string; label: string; detail: string }>;
  models: string[];
  defaultModel: string | null;
  drafts: Array<{ id: string; name: string }>;
  recorded: { persona: string; style: string; domain: string };
}

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
  models?: string[],
): Promise<void> {
  // Zero delay: the pacing is a fixture imitating a network, and a test should not
  // spend nine seconds pretending. The drafts shelf is a fresh temporary one, so a test can
  // never depend on — or disturb — whatever is actually waiting for review in the repo.
  const draftsRoot = mkdtempSync(join(tmpdir(), "atp-board-drafts-"));
  const server = createBoardServer({
    chunkDelayMs: 0,
    draftsDir: join(draftsRoot, "domains-draft"),
    ...(provider === undefined ? {} : { provider }),
    ...(store === undefined ? {} : { store }),
    ...(models === undefined ? {} : { models }),
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
    rmSync(draftsRoot, { recursive: true, force: true });
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

test("the page hears what the session is doing before anyone speaks", async () => {
  // Prep is several model calls with nothing on the board. If those were silent, a page with a
  // slow provider would look broken exactly while it works.
  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board`)).text();
    const phases = [...body.matchAll(/event: phase\ndata: \{"phase":"([^"]+)"\}/g)].map((match) => match[1]);

    assert.deepEqual(
      phases.slice(0, 4),
      ["assertion-list", "structural-verify", "semantic-verify", "probe-author"],
      "the silent preparation is reported, in order",
    );
    assert.ok(phases.includes("narration"));
    assert.ok(body.indexOf("event: phase") < body.indexOf("event: surface"), "phases arrive before the board fills");
  });
});

test("a session that stops before teaching names the claim that stopped it", async () => {
  // ADR 0005: an unverified claim is not delivered, and the session stops. A stop that does not
  // say WHICH claim failed leaves the learner with "未通过" and nothing to act on.
  await withBoard(
    async (base) => {
      const body = await (await fetch(`${base}/board`)).text();

      assert.match(body, /"stoppedBefore":"semantic"/);
      assert.match(body, /"passed":false/);
      assert.match(body, /"id":"A3"/, "the failing claim is named");
      assert.match(body, /the grammar shows an offset is carried/, "with the verifier's reason");
      assert.ok(!body.includes("event: surface"), "and nothing was taught on an unverified list");
    },
    new ScriptedProvider({ ...cleanScript(), "grounding-verifier": APPARATUS_VERDICTS_UNSUPPORTED }),
  );
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

// ------------------------------------------- the entry panel (ADR 0009) --

test("the page carries the entry panel: what, how, who teaches, who challenges, which model", async () => {
  await withBoard(async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const ids = [
      "setup",
      "pick-mode",
      "pick-topic",
      "catalogue",
      "draft-line",
      "drafts",
      "pick-style",
      "pick-lead",
      "pick-challenger",
      "pick-model",
      "setup-result",
      "start",
      "askq",
      "askq-send",
      "review",
      "review-name",
      "review-boundary",
      "review-body",
      "review-problems",
      "review-signer",
      "review-sign",
      "review-back",
      "sweep-line",
      "sweep-list",
      "review-sweep",
    ];
    for (const id of ids) {
      assert.match(html, new RegExp(`id="${id}"`), `${id} must be on the page`);
    }
    // The topic is typed rather than picked, and the Catalogue stays visible underneath it —
    // its length is the honest statement of what can be taught.
    assert.match(html, /id="pick-topic"/, "the topic is an input");
    assert.doesNotMatch(html, /<select id="pick-topic"/, "and not a dropdown wearing its id");
    assert.match(html, /id="catalogue"/, "with the catalogue beside it");
    assert.match(html, /addEventListener\("phase"/, "the page listens for what the session is doing");
    assert.match(html, /addEventListener\("draft"/, "and for a build that finished");
    assert.match(html, /addEventListener\("pending"/, "and for a draft waiting for its signature");
    assert.match(html, /\/draft\?id=/, "the review is fetched from the board, not hand-rolled in the page");
    assert.match(html, /\/sign"/, "and the signature posts to the same gate the CLI uses");
    assert.match(html, /stoppedBefore/, "a stop before teaching is rendered as its own outcome");
    // The direct classroom (ADR 0011) is a door of its own: a mode chosen before the subject,
    // messages that go to /say, and its own events on the same stream.
    assert.match(html, /name="how"/, "the mode is chosen at entry");
    assert.doesNotMatch(html, /<select[^>]*name="how"/, "as a choice, not a dropdown");
    assert.match(html, /\/classroom\?/, "the classroom opens on its own endpoint");
    assert.match(html, /\/say"/, "and the learner's messages post to /say");
    assert.match(html, /addEventListener\("turn"/, "the page renders the classroom's turns");
    assert.match(html, /addEventListener\("closed"/, "and lets an idle classroom go");
    // A stream that ends is not reopened: EventSource reconnects by itself, and a reconnect
    // would rerun the session — or the build — from the top. Every terminal event closes it.
    assert.match(html, /addEventListener\("failed"[\s\S]{0,600}?source\.close\(\)/, "failed closes the stream");
    assert.match(html, /addEventListener\("draft"[\s\S]{0,600}?source\.close\(\)/, "so does the draft");
    assert.match(html, /addEventListener\("pending"[\s\S]{0,600}?source\.close\(\)/, "and so does pending");
  });
});

test("a typed topic that names a Domain teaches it, with no build involved", async () => {
  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board?topic=${encodeURIComponent("时区")}`)).text();
    assert.ok(!body.includes("event: failed"), `a matching topic must teach: ${body.slice(0, 300)}`);
    assert.match(body, /event: done/);
    assert.match(body, /时区是一套规则/, "and the lesson is the Domain the topic matched");
  });
});

test("a topic nothing matches, with no provider, says exactly what it needs", async () => {
  await withBoard(async (base) => {
    const body = await (await fetch(`${base}/board?topic=${encodeURIComponent("量子力学")}`)).text();
    assert.match(body, /event: failed/);
    assert.match(body, /需要一个模型 provider/, "the refusal names what is missing rather than pretending");
  });
});

test("a topic nothing matches is built, and the page is handed the review step", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-board-build-"));
  const server = createBoardServer({
    chunkDelayMs: 0,
    provider: new ScriptedProvider(builderScript()),
    fetcher: documentedFetcher(),
    draftsDir: join(root, "domains-draft"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const body = await (
      await fetch(`http://127.0.0.1:${port}/board?live=1&topic=${encodeURIComponent("记号长度")}`)
    ).text();

    assert.match(body, /event: meta/);
    assert.match(body, /新教材构建/, "a build says what it is, before it is anything else");
    assert.match(body, /"phase":"plan"/, "the build reports its stages on the phase channel");
    assert.match(body, /"phase":"prove"/, "including the kernel's own proof step");
    assert.match(body, /event: draft/);
    assert.match(body, /"id":"token-length"/, "the page is told what was made");
    assert.ok(!body.includes("event: done"), "no lesson ran — a draft is not a lesson");
    assert.ok(
      existsSync(join(root, "domains-draft", "token-length", "corpus.md")),
      "and the draft is on disk, one signature away",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a waiting draft is listed, and its topic is answered with the signature — not a second build", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-board-drafts-"));
  const draftsDir = join(root, "domains-draft");
  mkdirSync(join(draftsDir, "token-length"), { recursive: true });
  writeFileSync(
    join(draftsDir, "token-length", "meta.md"),
    [
      "---",
      "id: token-length",
      "name: 记号与长度",
      "owner: TODO",
      "corpusReviewedBy: TODO",
      "corpusReviewedOn: TODO",
      "deliveryLanguage: zh",
      "sources:",
      "  - https://spec.example/alpha",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );

  // No provider at all: if the pending path were missed, the board would say so instead of
  // building — and the assertions below would catch a phase event that should not exist.
  const server = createBoardServer({ chunkDelayMs: 0, draftsDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const offered = (await (await fetch(`http://127.0.0.1:${port}/options`)).json()) as BoardOptionsPayload;
    assert.deepEqual(offered.drafts, [{ id: "token-length", name: "记号与长度" }], "the shelf is visible to the page");

    const body = await (
      await fetch(`http://127.0.0.1:${port}/board?topic=${encodeURIComponent("记号与长度")}`)
    ).text();
    assert.match(body, /event: pending/);
    assert.match(body, /"id":"token-length"/);
    assert.ok(!body.includes("event: phase"), "a topic that already has a draft is not built again");
    assert.ok(!body.includes("event: failed"));
    assert.ok(!body.includes("event: done"), "and it does not teach — the signature is the door");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a draft can be signed on the page: the material is served, and the signature moves it in", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-board-sign-"));
  mkdirSync(join(root, "domains"), { recursive: true });
  const base = `http://127.0.0.1:`;
  const server = createBoardServer({
    chunkDelayMs: 0,
    provider: new ScriptedProvider(builderScript()),
    fetcher: documentedFetcher(),
    draftsDir: join(root, "domains-draft"),
    domainsDir: join(root, "domains"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    // A real draft first, through the same door the page uses.
    const built = await (
      await fetch(`${base}${port}/board?live=1&topic=${encodeURIComponent("记号长度")}`)
    ).text();
    assert.match(built, /event: draft/);

    // What the reviewer is shown before any name is asked for.
    const review = (await (
      await fetch(`${base}${port}/draft?id=token-length`)
    ).json()) as {
      name: string;
      sources: unknown[];
      passages: Array<{ id: string }>;
      problems: string[];
    };
    assert.equal(review.name, "记号与长度");
    assert.equal(review.sources.length, 2, "the sources a signature accepts");
    assert.deepEqual(
      review.passages.map((passage) => passage.id),
      ["P-token-def", "P-whitespace"],
      "and the passages themselves",
    );
    assert.deepEqual(review.problems, [], "a clean draft has nothing to refuse it");

    // No name, no signature.
    const blank = await fetch(`${base}${port}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "token-length", name: "  " }),
    });
    assert.equal(blank.status, 400);

    const signed = await fetch(`${base}${port}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "token-length", name: "白杨" }),
    });
    assert.equal(signed.status, 200);

    // The board agrees with the filesystem, without a restart: shelf empty, catalogue grown.
    const offered = (await (await fetch(`${base}${port}/options`)).json()) as BoardOptionsPayload;
    assert.deepEqual(offered.drafts, [], "the shelf no longer holds it");
    assert.ok(
      offered.domains.some((domain) => domain.id === "token-length"),
      "and the catalogue does — the library is read per request",
    );
    assert.ok(existsSync(join(root, "domains", "token-length", "meta.md")));

    // Signing again is refused, not repeated.
    const again = await fetch(`${base}${port}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "token-length", name: "白杨" }),
    });
    assert.equal(again.status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

/** Two builds of the same plan: the first plan, then its twin (same sources, new id). */
function twinScript(): Record<string, string | string[]> {
  return {
    "domain-planner": [BUILD_PLAN, BUILD_PLAN_TWIN],
    "passage-selector": [BUILD_SELECTION, BUILD_SELECTION],
    "pedagogy-author": [BUILD_PEDAGOGY, BUILD_PEDAGOGY],
  };
}

test("signing can sweep the drafts it makes redundant — shown first, deleted only on request", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-board-sweep-"));
  mkdirSync(join(root, "domains"), { recursive: true });
  const draftsDir = join(root, "domains-draft");
  const server = createBoardServer({
    chunkDelayMs: 0,
    provider: new ScriptedProvider(twinScript()),
    fetcher: documentedFetcher(),
    draftsDir,
    domainsDir: join(root, "domains"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Two drafts on the shelf: the plan, and the same plan re-planned under a new id.
    const one = await (await fetch(`${base}/board?live=1&topic=${encodeURIComponent("记号长度")}`)).text();
    assert.match(one, /event: draft/);
    const two = await (await fetch(`${base}/board?live=1&topic=${encodeURIComponent("第二份对照草稿")}`)).text();
    assert.match(two, /event: draft/);

    // What the review offers to clean, with the reason it thinks so.
    const review = (await (await fetch(`${base}/draft?id=token-length`)).json()) as {
      siblings: Array<{ id: string; name: string; shared: number }>;
    };
    assert.deepEqual(review.siblings, [{ id: "token-length-twin", name: "记号与长度（重试）", shared: 2 }]);

    const signed = await fetch(`${base}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "token-length", name: "白杨", sweep: true }),
    });
    assert.equal(signed.status, 200);
    const result = (await signed.json()) as { deleted: string[] };
    assert.deepEqual(result.deleted, ["token-length-twin"], "the duplicate was deleted");

    assert.ok(!existsSync(join(draftsDir, "token-length-twin")), "and it is gone from the shelf");
    assert.ok(
      !existsSync(join(root, "domains", "token-length-twin")),
      "deleted, not signed in its place",
    );
    assert.ok(existsSync(join(root, "domains", "token-length", "meta.md")));

    const offered = (await (await fetch(`${base}/options`)).json()) as BoardOptionsPayload;
    assert.deepEqual(offered.drafts, [], "one signature emptied the duplicate shelf");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("without the sweep ticked, the duplicate is left alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-board-sweep-off-"));
  mkdirSync(join(root, "domains"), { recursive: true });
  const draftsDir = join(root, "domains-draft");
  const server = createBoardServer({
    chunkDelayMs: 0,
    provider: new ScriptedProvider(twinScript()),
    fetcher: documentedFetcher(),
    draftsDir,
    domainsDir: join(root, "domains"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    await (await fetch(`${base}/board?live=1&topic=${encodeURIComponent("记号长度")}`)).text();
    await (await fetch(`${base}/board?live=1&topic=${encodeURIComponent("第二份对照草稿")}`)).text();

    const signed = await fetch(`${base}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "token-length", name: "白杨", sweep: false }),
    });
    assert.equal(signed.status, 200);
    const result = (await signed.json()) as { deleted: string[] };
    assert.deepEqual(result.deleted, [], "nothing was deleted without being asked");
    assert.ok(existsSync(join(draftsDir, "token-length-twin")), "the duplicate is exactly where it was");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("the options are a snapshot: the library's offerings, and models only when a provider exists", async () => {
  await withBoard(async (base) => {
    const offered = (await (await fetch(`${base}/options`)).json()) as BoardOptionsPayload;
    assert.equal(offered.live, false, "no provider is configured");
    assert.equal(offered.provider, null);
    assert.deepEqual(offered.models, [], "a recording runs on no model");
    assert.equal(offered.defaultModel, null);
    assert.ok(offered.domains.some((domain) => domain.id === "time-zones"));
    assert.ok(offered.domains.some((domain) => domain.id === "utf8-and-length"));
    assert.ok(offered.styles.some((style) => style.id === "analogy-heavy"));
    assert.ok(offered.styles.some((style) => style.id === "plain-direct"));
    assert.ok(offered.personas.some((persona) => persona.id === "patient-explainer"));
    assert.ok(offered.personas.some((persona) => persona.id === "terse-engineer"));
    assert.equal(offered.recorded.persona, "patient-explainer", "the page is told what the recording locked");
    assert.equal(offered.recorded.domain, "time-zones");
    assert.equal(offered.recorded.style, "analogy-heavy");
    assert.deepEqual(offered.drafts, [], "a fresh shelf has nothing waiting for a signature");
  });
});

test("with a provider, the options offer models and a default", async () => {
  await withBoard(
    async (base) => {
      const offered = (await (await fetch(`${base}/options`)).json()) as BoardOptionsPayload;
      assert.equal(offered.live, true);
      assert.deepEqual(offered.models, ["m-one", "m-two"]);
      assert.equal(offered.defaultModel, "m-one");
    },
    new ScriptedProvider(misconceptionScript()),
    undefined,
    ["m-one", "m-two"],
  );
});

test("a session runs with what the page chose: domain, style, voices, model", async () => {
  // Replay rather than learner mode, so the recorded answers carry the session to its end
  // without a page to type at — the choices are what is under test here, not the asking. The
  // recorded answers and scripted content are time-zones', so the Domain stays at the take's.
  await withBoard(
    async (base) => {
      const body = await (
        await fetch(
          `${base}/board?live=1&style=plain-direct&persona=terse-engineer&challenger=patient-explainer&model=m-two`,
        )
      ).text();
      assert.ok(!body.includes("event: failed"), `the chosen configuration must run, got:\n${body.slice(0, 300)}`);
      assert.match(body, /event: done/, "and reach its own verdict");
      assert.match(body, /惜字如金的工程师/, "the header names the chosen voice");
      assert.match(body, /质疑者：耐心的讲解者/, "and the chosen challenger");
    },
    new ScriptedProvider(misconceptionScript()),
    undefined,
    ["m-one", "m-two"],
  );
});

test("a chosen Domain is the corpus the session is checked against", async () => {
  // The recorded claims cite time-zones passages, so against the other Domain's corpus the
  // structural check must refuse them — which is only possible if the Domain choice reached the
  // composition. The failure naming structural verification IS the evidence.
  await withBoard(
    async (base) => {
      const body = await (await fetch(`${base}/board?live=1&domain=utf8-and-length`)).text();
      assert.match(body, /event: failed/);
      assert.match(body, /structural verification/);
    },
    new ScriptedProvider(misconceptionScript()),
  );
});

test("an unoffered choice is refused at the door, not defaulted", async () => {
  await withBoard(async (base) => {
    const unknownPersona = await (await fetch(`${base}/board?persona=not-a-persona`)).text();
    assert.match(unknownPersona, /event: failed/);
    assert.match(unknownPersona, /not an offered persona/);

    const unknownDomain = await (await fetch(`${base}/board?domain=not-a-domain`)).text();
    assert.match(unknownDomain, /not an offered domain/);

    const unknownStyle = await (await fetch(`${base}/board?style=not-a-style`)).text();
    assert.match(unknownStyle, /not an offered style/);

    const unknownModel = await (await fetch(`${base}/board?live=1&model=nope`)).text();
    assert.match(unknownModel, /not one of the offered models/);
  });
});

test("the recording refuses what it did not record", async () => {
  // The same honesty the question bar applies to a board with no answer on file: the demo is
  // one take — one Domain, one Style, one voice — and pretending otherwise would break the
  // very thing it exists to show.
  await withBoard(async (base) => {
    for (const query of ["persona=terse-engineer", "style=plain-direct", "domain=utf8-and-length"]) {
      const body = await (await fetch(`${base}/board?learner=1&${query}`)).text();
      assert.match(body, /event: failed/, `${query} must be refused`);
      assert.match(body, /one take/, `${query}: the refusal names the take`);
    }
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

test("the direct classroom opens on a topic and answers the learner in context", async () => {
  const requests: Array<{ actor: string; input: string }> = [];
  const inner = new ScriptedProvider({
    "lead-explainer": [
      "先讲第一点：时区是一套规则。用你自己的话说说？",
      "对——规则先于偏移量。接着看第二个点。",
    ],
  });
  const capturing: ModelProvider = {
    complete: async (request) => {
      requests.push({ actor: request.actor, input: request.input });
      return inner.complete(request);
    },
  };

  await withBoard(
    async (base) => {
      const classroom = boardReader(
        await fetch(
          `${base}/classroom?topic=${encodeURIComponent("时区")}` +
            "&persona=patient-explainer&style=analogy-heavy&challenger=terse-engineer",
        ),
      );

      // The opening: the session says what it is before anyone speaks, then the teacher starts.
      assert.ok(await classroom.readUntil("event: ready"), "the first turn finishes");
      assert.match(classroom.all(), /"classroom":true/, "the mode is said out loud");
      assert.match(classroom.all(), /"unverified":true/, "including that nothing here is verified");
      assert.match(classroom.all(), /时区是一套规则/, "and the teacher's first turn reaches the page");
      assert.ok(requests[0]?.input.includes("我想学：时区"), "the subject is the first thing said");

      const token = /"token":"([^"]+)"/.exec(classroom.all())?.[1];
      assert.ok(token !== undefined && token !== "", "the page needs the token before it can speak");

      // The learner's message goes straight into the model's context — that is the mode.
      const said = "我猜时区就是太阳的位置";
      const posted = await fetch(`${base}/say`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, text: said }),
      });
      assert.equal(posted.status, 200, "a message is accepted while the teacher is not speaking");

      assert.ok(await classroom.readUntil("event: ready"), "the second turn finishes");
      assert.match(classroom.all(), /规则先于偏移量/, "the reply reaches the page");
      assert.ok(requests[1]?.input.includes(`学习者：${said}`), "the learner's words are in the model's context");
      assert.ok(requests[1]?.input.includes("主讲：先讲第一点"), "with the conversation behind them");
      assert.match(classroom.all(), /"calls":2/, "and the ledger counts both turns");

      await classroom.close();
    },
    capturing,
  );
});

test("a message nobody is waiting for is refused, like an answer into nowhere", async () => {
  await withBoard(async (base) => {
    const nowhere = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "nobody", text: "在吗" }),
    });
    assert.equal(nowhere.status, 409);

    const empty = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "nobody", text: "   " }),
    });
    assert.equal(empty.status, 400, "an empty message is not a message");
  });
});

test("the classroom needs a subject, and a voice it was offered", async () => {
  await withBoard(async (base) => {
    const noTopic = await (await fetch(`${base}/classroom`)).text();
    assert.match(noTopic, /event: failed/);
    assert.match(noTopic, /先写一个主题/);

    const unknownVoice = await (await fetch(`${base}/classroom?topic=x&persona=not-a-persona`)).text();
    assert.match(unknownVoice, /not an offered persona/);

    const unknownModel = await (await fetch(`${base}/classroom?topic=x&model=nope`)).text();
    assert.match(unknownModel, /not one of the offered models/);
  });
});
