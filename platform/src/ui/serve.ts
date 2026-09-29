import { createServer } from "node:http";
import type { Server } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { UnderstandingCheck } from "../checks/types.ts";
import { buildDomain } from "../build/build-domain.ts";
import { httpFetcher } from "../build/fetch.ts";
import type { Fetcher } from "../build/fetch.ts";
import { inspectDraft, listDraftSiblings, listDrafts, signDraft } from "../build/review-domain.ts";
import { DOMAINS_DIR, DOMAIN_DRAFTS_DIR } from "../catalog.ts";
import { catalogue, matchDomain, matchTopic } from "../experts/catalogue.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { PROFILES } from "../experiment/fixtures-experiment.ts";
import { configuredModels, defaultModel, selectLiveProvider } from "../providers/live.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { render } from "../render/render.ts";
import { runApparatusSession } from "../session/apparatus.ts";
import type { Probe } from "../session/contracts.ts";
import { runClassroomTurn } from "../session/classroom.ts";
import type { ClassroomMessage } from "../session/classroom.ts";
import { misconceptionScript } from "../session/fixtures-apparatus.ts";
import { FileSessionStore } from "../session/store.ts";
import type { SessionStore } from "../session/store.ts";

/**
 * The blackboard, on a screen.
 *
 * ADR 0001 accepted "no UI" for v1 because the experience is visual and a kernel
 * cannot be judged without one. This is that consumer, and it is deliberately the
 * cheapest thing that can be honest about it: one static page, `node:http`, no
 * framework, no bundler, no dependency.
 *
 * It is a CONSUMER of `Surface`, not a second renderer of events. The page never
 * sees an event, so the closed vocabulary, the ordering and the "no coordinates in
 * the events" rule all stay decided in one place and in one language. That is what
 * the event-sourcing discipline bought.
 *
 * The delay between steps is a parameter because it is a FIXTURE pretending to be a
 * network: a real provider paces itself, and a test must not wait nine seconds to
 * watch a replay.
 */
export interface BoardOptions {
  /** Milliseconds between replayed steps. Zero in tests; the page says which mode it is in. */
  chunkDelayMs?: number;
  /**
   * Force a provider, for tests.
   *
   * Without this the only way to reach the failure path would be to configure a real
   * endpoint and break it — which is a test that spends money, or one that passes
   * only on a machine with no credentials.
   */
  provider?: ModelProvider;
  /**
   * Ask the PAGE rather than a recorded learner.
   *
   * Off by default, and the default is a replay: an unattended `GET /board` has nobody to
   * answer, so a board that always asked would hang for every script and every test that
   * reads the stream to its end. `?learner=1` turns the page into the learner.
   */
  askLearner?: boolean;
  /**
   * Where the lesson is kept.
   *
   * A lesson nobody recorded is a lesson that cannot be returned to, and coming back is the only
   * way the retention and transfer measures ever say anything about a person. The same store
   * `npm run enter` uses, so a lesson taken in the browser is followed up with the same command.
   */
  store?: SessionStore;
  /**
   * The models a session may be started with, when the caller wants to say.
   *
   * Defaults to what the environment offers (`ATP_MODELS`, else the single configured model).
   * An option so a test can exercise the choice without touching the process's environment.
   */
  models?: string[];
  /**
   * Where a build writes its draft, and where the page reads the shelf waiting for a signature
   * (ADR 0010). Defaults to `domains-draft/`; an option so a test can build and sign without
   * touching the repo.
   */
  draftsDir?: string;
  /**
   * Where a signature moves a draft to — and the catalogue the board teaches from.
   *
   * Defaults to `domains/`; an option for the same reason as `draftsDir`.
   */
  domainsDir?: string;
  /**
   * How a build fetches its sources. Injected in tests; the real board uses HTTP.
   */
  fetcher?: Fetcher;
}

/** How long a question waits for the page before it is treated as unanswered. */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The one combination the recorded lesson exists in.
 *
 * The fixtures are recordings of this voice teaching this Domain. Anything else has no
 * recording on file, and the board refuses to pretend otherwise (ADR 0009) — the same
 * honesty the question bar applies to a board with no answer on file (ADR 0008).
 */
const RECORDED = { persona: "patient-explainer", style: "analogy-heavy", domain: "time-zones" } as const;

/**
 * Questions waiting for an answer from the page, by token.
 *
 * The board is one connection per learner, and the token is how a POST finds the question it
 * is answering. Nothing here is keyed by session id: a person with two tabs open is two
 * learners, and confusing them would put one person's answer in the other's record.
 */
const waiting = new Map<string, (answer: string) => void>();

function waitForAnswer(token: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(token);
      // A question nobody answered is not an error. It is a learner who walked away, and the
      // session has to be able to finish without them rather than hold a socket open forever.
      resolve("");
    }, timeoutMs);
    waiting.set(token, (answer) => {
      clearTimeout(timer);
      waiting.delete(token);
      resolve(answer);
    });
  });
}

/**
 * Where a learner's own questions wait, one box per connection (ADR 0008).
 *
 * Queued rather than answered on arrival: the session takes the question at the next pause in
 * the teaching, which is the only place an answer can be given without talking over the lesson.
 * Keyed by the same token as the answers, and for the same reason — a person with two tabs open
 * is two learners.
 */
const questionBoxes = new Map<string, { pending: string | undefined }>();

const CHUNK_DELAY_MS = 450;
const HTML = readFileSync(new URL("./index.html", import.meta.url), "utf8");

/**
 * Where the direct classroom waits for the learner's next message (ADR 0011).
 *
 * One message at a time: `open` is true only while the teacher is not speaking, and a message
 * that arrives mid-turn is refused rather than queued — the learner can see the reply they are
 * about to be answering, and words typed against the wrong turn are worse than a retry.
 */
interface SayBox {
  open: boolean;
  resolve: ((text: string) => void) | null;
}

const sayBoxes = new Map<string, SayBox>();

function waitForSay(box: SayBox, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Silence is an idle classroom, not an error: nobody said anything for long enough that
      // the session lets go rather than holding a socket open for a person who has gone.
      box.resolve = null;
      box.open = false;
      resolve("");
    }, timeoutMs);
    box.open = true;
    box.resolve = (text) => {
      clearTimeout(timer);
      box.resolve = null;
      box.open = false;
      resolve(text);
    };
  });
}

export function createBoardServer(options: BoardOptions = {}): Server {
  const chunkDelayMs = options.chunkDelayMs ?? CHUNK_DELAY_MS;

  // What a session may be started with (ADR 0009). The list is configuration, not a discovery
  // call: it says what this deployment is willing to run and pay for.
  const models = options.models ?? configuredModels(process.env);
  const modelDefault = options.models !== undefined ? (models[0] ?? null) : defaultModel(process.env);

  // Where drafts live: what the page may LIST as waiting for a signature (ADR 0010), and where
  // a build writes. One path, so the shelf the page shows is the shelf the builder fills.
  const draftsDir = options.draftsDir ?? DOMAIN_DRAFTS_DIR;
  const domainsDir = options.domainsDir ?? DOMAINS_DIR;

  /**
   * The library, loaded per request rather than once at startup.
   *
   * A signature MOVES a directory into `domains/` while the server is running, and a catalogue
   * loaded at startup would not know: the topic just signed would fall through to the builder
   * and be refused as "already a Domain". Files are the source of truth; the loader is cheap
   * (a handful of markdown files) and reading them again is the honest way to agree with them.
   */
  const freshLibrary = (): ReturnType<typeof loadLibrary> => loadLibrary(undefined, undefined, domainsDir);

  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/answer" && request.method === "POST") {
      // The other half of the loop: the page has an answer and is handing it back. The session
      // is sitting on a promise at this moment, which is what makes the blackboard a lesson
      // rather than a recording of one.
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        let payload: { token?: unknown; text?: unknown };
        try {
          payload = JSON.parse(body) as { token?: unknown; text?: unknown };
        } catch {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("answer must be JSON");
          return;
        }

        const resolve = typeof payload.token === "string" ? waiting.get(payload.token) : undefined;
        if (resolve === undefined) {
          // Not 200. A question that is no longer waiting means the session moved on or timed
          // out, and an answer accepted into nowhere is worse than one refused.
          response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          response.end("no question is waiting for that token");
          return;
        }

        resolve(typeof payload.text === "string" ? payload.text : "");
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
      });
      return;
    }

    if (url.pathname === "/question" && request.method === "POST") {
      // The learner speaking first. The question is QUEUED here, not answered: the session takes
      // it at the next pause in the teaching, so the answer lands where the lesson is rather
      // than talking over it.
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        let payload: { token?: unknown; text?: unknown };
        try {
          payload = JSON.parse(body) as { token?: unknown; text?: unknown };
        } catch {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("question must be JSON");
          return;
        }

        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (text === "") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("a question must be the learner's words, not an empty string");
          return;
        }

        const box = typeof payload.token === "string" ? questionBoxes.get(payload.token) : undefined;
        if (box === undefined) {
          // 409, not 200. A question accepted into nowhere — a replay with no learner, a lesson
          // already over — looks exactly like one that was asked and will be answered.
          response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          response.end("no lesson is taking questions for that token");
          return;
        }
        if (box.pending !== undefined) {
          response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          response.end("a question is already waiting to be taken");
          return;
        }

        box.pending = text;
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
      });
      return;
    }

    if (url.pathname === "/say" && request.method === "POST") {
      // The learner speaking in the direct classroom (ADR 0011). Their words go straight into the
      // model's context — that is what the mode is — so the checks here are only the ones that
      // keep the conversation from talking over itself.
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        let payload: { token?: unknown; text?: unknown };
        try {
          payload = JSON.parse(body) as { token?: unknown; text?: unknown };
        } catch {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("say must be JSON");
          return;
        }

        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (text === "") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("a message must be the learner's words, not an empty string");
          return;
        }

        const box = typeof payload.token === "string" ? sayBoxes.get(payload.token) : undefined;
        if (box === undefined || box.resolve === null) {
          // 409, like an answer into nowhere: the teacher is mid-turn, or the classroom is over.
          response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          response.end("no classroom is waiting for a message with that token");
          return;
        }

        const resolve = box.resolve;
        box.resolve = null;
        box.open = false;
        resolve(text);
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
      });
      return;
    }

    if (url.pathname === "/options") {
      // What the page may offer (ADR 0009). A snapshot rather than a session: the choices travel
      // with the connection that starts the lesson, and nothing is kept between the two requests.
      let offered: ReturnType<typeof catalogue>;
      try {
        offered = catalogue(freshLibrary());
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(`读不到教材目录：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const selection = selectLiveProvider(process.env);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          live: selection !== null || options.provider !== undefined,
          provider: options.provider !== undefined ? "an injected provider" : (selection?.describe ?? null),
          domains: offered.domains,
          styles: offered.styles,
          personas: offered.personas,
          models,
          defaultModel: modelDefault,
          drafts: listDrafts(draftsDir),
          recorded: RECORDED,
        }),
      );
      return;
    }

    if (url.pathname === "/draft" && request.method === "GET") {
      // The material a signature accepts (ADR 0010): sources, passages, checks — everything the
      // reviewer is asked to vouch for, served so the page can show it without a terminal.
      const id = (url.searchParams.get("id") ?? "").trim();
      try {
        const report = inspectDraft(id, { draftsDir });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(
          JSON.stringify({
            id: report.id,
            name: report.domain.name,
            boundary: report.boundary,
            sources: report.sources.map(({ index, url, fetchedAt, sha256 }) => ({ index, url, fetchedAt, sha256 })),
            passages: report.domain.corpus.passages.map((passage) => ({
              id: passage.id,
              source: passage.source,
              text: passage.text,
            })),
            misconceptions: report.domain.misconceptions.map((entry) => ({
              id: entry.id,
              name: entry.name,
              wrongModel: entry.wrongModel,
              refutation: entry.refutation,
            })),
            checks: report.domain.checks.map((check) => ({
              id: check.id,
              prompt: check.prompt,
              expected: check.expected,
              grounding: check.grounding,
              diagnoses: check.diagnoses,
            })),
            problems: report.unexpected.map((finding) => `${finding.code}: ${finding.message}`),
            // Near-duplicates a signature may sweep. Listed, never deleted, until a person says so.
            siblings: listDraftSiblings(id, draftsDir),
          }),
        );
      } catch (error) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (url.pathname === "/sign" && request.method === "POST") {
      // The signature itself. Same `signDraft` the CLI calls — one gate, two doors, and the gate
      // is still the only thing that moves a directory across.
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        let payload: { id?: unknown; name?: unknown; sweep?: unknown };
        try {
          payload = JSON.parse(body) as { id?: unknown; name?: unknown; sweep?: unknown };
        } catch {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("sign must be JSON");
          return;
        }

        const id = typeof payload.id === "string" ? payload.id.trim() : "";
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        if (id === "" || name === "") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("签一份草稿需要它的 id 和你的名字");
          return;
        }

        const sweep = payload.sweep === true;
        try {
          // The sibling list is recomputed HERE, from the shelf, before the signature moves the
          // subject: what the page showed is a suggestion, and deletion never trusts a client's
          // list. Only drafts are ever swept — the set is read from the draft shelf, so a signed
          // Domain can never be in it.
          const siblings = sweep ? listDraftSiblings(id, draftsDir) : [];
          const target = signDraft(id, { draftsDir, domainsDir, name });
          const deleted: string[] = [];
          for (const sibling of siblings) {
            const path = join(draftsDir, sibling.id);
            if (existsSync(path)) {
              rmSync(path, { recursive: true, force: true });
              deleted.push(sibling.id);
            }
          }
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ id, movedTo: target, deleted }));
        } catch (error) {
          response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
          response.end(error instanceof Error ? error.message : String(error));
        }
      });
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(HTML);
      return;
    }

    if (url.pathname === "/classroom") {
      // The direct classroom (ADR 0011): a conversation instead of a verified lesson. Nothing here
      // is grounded, and the session says so for its whole length — no corpus is loaded, no
      // assertion is checked, no verdict is reached. The recorded replay cannot stand in for a
      // provider here: its lines were written for a lesson that was verified first.
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      let gone = false;
      const send = (event: string, data: unknown): void => {
        if (gone) return;
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const topic = (url.searchParams.get("topic") ?? "").trim();
      if (topic === "") {
        send("failed", "直接课堂要先写一个主题——写你想学的那个东西，老师就讲它");
        response.end();
        return;
      }

      let library: ReturnType<typeof freshLibrary>;
      let offered: ReturnType<typeof catalogue>;
      try {
        library = freshLibrary();
        offered = catalogue(library);
      } catch (error) {
        send("failed", `读不到教材目录：${error instanceof Error ? error.message : String(error)}`);
        response.end();
        return;
      }

      const wantedPersona = url.searchParams.get("persona") ?? RECORDED.persona;
      const wantedStyle = url.searchParams.get("style") ?? RECORDED.style;
      const wantedChallenger = url.searchParams.get("challenger") ?? wantedPersona;
      const wantedModel = url.searchParams.get("model");

      // The same door rule as the board (ADR 0007): an id nobody offered is a typo, and a typo
      // that reached the composition would surface as a broken session instead of a refusal.
      const choices = [
        { what: "style", id: wantedStyle, offered: offered.styles },
        { what: "persona", id: wantedPersona, offered: offered.personas },
        { what: "persona", id: wantedChallenger, offered: offered.personas },
      ];
      const unknown = choices.find((choice) => !choice.offered.some((option) => option.id === choice.id));
      if (unknown !== undefined) {
        send(
          "failed",
          `\`${unknown.id}\` is not an offered ${unknown.what}: ${unknown.offered.map((option) => option.id).join(", ")}`,
        );
        response.end();
        return;
      }
      if (wantedModel !== null && !models.includes(wantedModel)) {
        send("failed", `\`${wantedModel}\` is not one of the offered models: ${models.join(", ") || "(none)"}`);
        response.end();
        return;
      }

      const selection = selectLiveProvider(process.env, wantedModel === null ? {} : { model: wantedModel });
      const provider = options.provider ?? selection?.provider ?? null;
      if (provider === null) {
        send("failed", "直接课堂要接上真模型——先把环境变量配好（见 npm run probe），它不播录播");
        response.end();
        return;
      }

      const persona = library.personas.get(wantedPersona);
      const style = library.styles.get(wantedStyle);
      const challenger = library.personas.get(wantedChallenger);
      if (persona === undefined || style === undefined || challenger === undefined) {
        // Unreachable: the ids were validated against this same catalogue just above.
        send("failed", "课堂上少了主讲、风格或质疑者——重新选一次");
        response.end();
        return;
      }

      const history: ClassroomMessage[] = [];
      const token = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
      const box: SayBox = { open: false, resolve: null };
      sayBoxes.set(token, box);

      send("meta", {
        classroom: true,
        expert:
          `直接课堂：${topic} · 主讲：${persona.name}` +
          (challenger.id === persona.id ? "" : ` · 质疑者：${challenger.name}`) +
          ` · 风格：${style.name}`,
        detail: options.provider !== undefined ? "an injected provider" : (selection?.describe ?? ""),
        unverified: true,
        token,
      });

      request.on("close", () => {
        gone = true;
        box.open = false;
        const wake = box.resolve;
        box.resolve = null;
        wake?.("");
        sayBoxes.delete(token);
      });

      let calls = 0;
      let costUsd = 0;

      const speak = async (message: string): Promise<void> => {
        const result = await runClassroomTurn({ provider, setup: { persona, style, challenger, topic }, history, message });
        calls += result.usage.calls;
        costUsd += result.usage.costUsd;
        history.push({ role: "learner", text: message });
        for (const turn of result.turns) {
          send("turn", turn);
          history.push({ role: "teacher", actor: turn.actor, text: turn.text });
        }
        send("ready", { calls, costUsd });
      };

      void (async () => {
        try {
          await speak(`我想学：${topic}`);
          for (;;) {
            const said = await waitForSay(box, ANSWER_TIMEOUT_MS);
            if (gone) break;
            if (said === "") {
              send("closed", { reason: "idle" });
              break;
            }
            await speak(said);
          }
        } catch (error) {
          // A dead turn has to reach the page: the classroom keeps no record to inspect
          // afterwards, so the page and the console are the only places it can be said.
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[classroom ${token}] ${message}`);
          send("failed", message);
        }
        response.end();
      })();
      return;
    }

    if (url.pathname !== "/board") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // Whether the learner is still there. Closing the tab does not end the session by itself —
    // the apparatus has to walk its own loop — but nothing that is left may WAIT on anyone: a
    // fix that only resolved the wait that happened to be open would leave every remaining
    // question holding a ten-minute timer, which is the failure that looks like nothing
    // happening.
    let gone = false;

    const send = (event: string, data: unknown): void => {
      // After the tab closes there is nowhere to write. Silent rather than an error: the lesson
      // is allowed to finish its loop, but nothing it says is for anyone any more.
      if (gone) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const wantsLive = url.searchParams.get("live") === "1";
    const requestedTopic = (url.searchParams.get("topic") ?? "").trim();
    let wantedDomain = url.searchParams.get("domain") ?? RECORDED.domain;
    let wantsBuild = false;

    // The catalogue, as of THIS request: a signature may have moved a draft in since the last one.
    // A load failure is a failed stream, not a crash — the response has already started, and a
    // request handler that throws leaves a socket hanging with nothing on it.
    let library: ReturnType<typeof freshLibrary>;
    let offered: ReturnType<typeof catalogue>;
    try {
      library = freshLibrary();
      offered = catalogue(library);
    } catch (error) {
      send("failed", `读不到教材目录：${error instanceof Error ? error.message : String(error)}`);
      response.end();
      return;
    }

    // A typed topic resolves before anything else (ADR 0010): a hit teaches now, a miss goes to
    // the builder, and an ambiguous one asks — a wrong match would teach the wrong subject with
    // full confidence, which is the failure ADR 0002 recorded this door against.
    if (requestedTopic !== "") {
      const match = matchDomain(library, requestedTopic);
      if (match.kind === "one") {
        wantedDomain = match.id;
      } else if (match.kind === "ambiguous") {
        send("failed", `\`${requestedTopic}\` 同时像 ${match.ids.join(" 和 ")}——把主题说得更具体一点`);
        response.end();
        return;
      } else {
        // A topic that already has an unsigned draft is not built twice (ADR 0010): the draft is
        // named, and the only door to teaching it is the signature.
        const drafts = listDrafts(draftsDir);
        const pending = matchTopic(drafts, requestedTopic);
        if (pending.kind === "one" || pending.kind === "ambiguous") {
          const ids = pending.kind === "one" ? [pending.id] : pending.ids;
          send("pending", { drafts: drafts.filter((entry) => ids.includes(entry.id)) });
          response.end();
          return;
        }
        wantsBuild = true;
      }
    }

    const wantedStyle = url.searchParams.get("style") ?? RECORDED.style;
    const wantedPersona = url.searchParams.get("persona") ?? RECORDED.persona;
    const wantedChallenger = url.searchParams.get("challenger") ?? wantedPersona;
    const wantedModel = url.searchParams.get("model");

    // Choices are validated against what the library offers before anything starts (ADR 0007's
    // rule, applied at this door): an unoffered id is a typo, and a typo that reached the
    // composition would surface as a broken session instead of a refusal.
    const choices = [
      // A build request never composes a Domain, so a missing one is not a refusal — the topic
      // is what a build runs on, and it was resolved above.
      ...(wantsBuild ? [] : [{ what: "domain", id: wantedDomain, offered: offered.domains }]),
      { what: "style", id: wantedStyle, offered: offered.styles },
      { what: "persona", id: wantedPersona, offered: offered.personas },
      { what: "persona", id: wantedChallenger, offered: offered.personas },
    ];
    const unknown = choices.find((choice) => !choice.offered.some((option) => option.id === choice.id));
    if (unknown !== undefined) {
      send(
        "failed",
        `\`${unknown.id}\` is not an offered ${unknown.what}: ${unknown.offered.map((option) => option.id).join(", ")}`,
      );
      response.end();
      return;
    }
    if (wantedModel !== null && !models.includes(wantedModel)) {
      send("failed", `\`${wantedModel}\` is not one of the offered models: ${models.join(", ") || "(none)"}`);
      response.end();
      return;
    }
    if (wantedModel !== null && !wantsLive && options.provider === undefined) {
      send("failed", "a model was chosen, but this session is a replay — add ?live=1 to run it on a provider");
      response.end();
      return;
    }

    const live = wantsLive
      ? selectLiveProvider(process.env, wantedModel === null ? {} : { model: wantedModel })
      : null;
    if (wantsLive && live === null && options.provider === undefined) {
      send("failed", "no provider is configured — see `npm run probe`");
      response.end();
      return;
    }

    // A topic nothing matches is not a refusal — it is a build (ADR 0010). It reports its own
    // stages on the same phase channel a session uses, and ends by handing over a draft that is
    // one signature away from being teachable.
    if (wantsBuild) {
      const builder = options.provider ?? live?.provider ?? null;
      if (builder === null) {
        send("failed", "现做一份新教材需要一个模型 provider——先把环境变量配好（见 npm run probe）");
        response.end();
        return;
      }

      // The build gets a header of its own, before it starts: the page shows what is being made
      // while it is made, and a failure later cannot be confused with a lesson's.
      send("meta", {
        mode: "live",
        expert: `新教材构建：${requestedTopic}`,
        detail: "把主题变成一份可教的草稿；完成并签字前不会上课",
        learner: false,
        questions: false,
        token: "",
      });

      void (async () => {
        try {
          const result = await buildDomain({
            topic: requestedTopic,
            provider: builder,
            fetcher: options.fetcher ?? httpFetcher(),
            draftsDir,
            onStage: (stage) => send("phase", { phase: stage }),
          });
          if (result.unexpected.length > 0) {
            const message =
              `草稿没有通过校验（${result.unexpected.length} 个错误）：\n` +
              result.unexpected.map((finding) => `${finding.code}: ${finding.message}`).join("\n");
            // Echoed to the server's own console too: the page may be closed by the time anyone
            // asks what happened, and a build is long enough that its death deserves a trace.
            console.error(`[build ${result.id}] ${message}`);
            send("failed", message);
          } else {
            send("draft", { id: result.id, name: result.plan.name });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[build] ${message}`);
          send("failed", message);
        }
        response.end();
      })();
      return;
    }

    // A board with a provider is a live board; otherwise it is the recorded take.
    const isLive = live !== null || options.provider !== undefined;

    // The recorded lesson exists in one take: one Domain, one Style, one voice. Offering choices
    // it cannot honor would be the same lie as offering it a question it has no answer to (ADR
    // 0008), so the demo refuses anything but what was recorded.
    if (!isLive) {
      const onFile: Array<[string, string, string]> = [
        ["domain", wantedDomain, RECORDED.domain],
        ["style", wantedStyle, RECORDED.style],
        ["persona", wantedPersona, RECORDED.persona],
        ["challenger", wantedChallenger, RECORDED.persona],
      ];
      for (const [what, id, recorded] of onFile) {
        if (id !== recorded) {
          send(
            "failed",
            `the recorded lesson is one take — ${RECORDED.domain} · ${RECORDED.style} · ${RECORDED.persona} — ` +
              `and \`${id}\` is not its ${what}; configure a provider and use ?live=1`,
          );
          response.end();
          return;
        }
      }
    }

    // The two Positions may be different voices (ADR 0009); they share the Domain and the Style
    // — one choice of how the lesson is taught covers it, and only the voice is chosen twice.
    const expert = composeExpert(library, wantedPersona, wantedStyle, wantedDomain);
    const challenger = composeExpert(library, wantedChallenger, wantedStyle, wantedDomain);
    const terminalChecks = expert.domain.checks.filter((candidate) => !candidate.id.startsWith("T-"));
    const check = terminalChecks[0];
    const retakeCheck = terminalChecks[1];
    if (check === undefined) {
      send("failed", `${expert.domain.id} has no terminal check, so there is nothing to teach`);
      response.end();
      return;
    }

    // The recorded pacing exists so the board can be LOOKED AT without an account.
    // The page says which mode it is in rather than letting a replay pass for a live
    // session.
    const provider: ModelProvider =
      options.provider ?? live?.provider ?? new ScriptedProvider(misconceptionScript(), { chunkDelayMs });
    const profile = PROFILES[1] as (typeof PROFILES)[number];

    /**
     * Is the PAGE the learner, or is a recorded one answering?
     *
     * Off unless asked for. An unattended stream has nobody to answer, so a board that always
     * put questions would hang every script and every test that reads it to the end — and a
     * hang is the one failure that looks like nothing happening.
     */
    const learner = url.searchParams.get("learner") === "1" || options.askLearner === true;
    const token = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const sessionId = `board-${Date.now()}`;
    const store = options.store ?? new FileSessionStore();

    // Whether this board can answer a question at all. The recorded demo has no answer on file
    // for one — a script cannot branch on whether the learner asked — so learner mode on it does
    // not offer the bar: accepting a question there ends the very demonstration it exists to
    // show. A live provider, or one a caller injected, can answer, so those take questions.
    const takesQuestions = learner && isLive;

    // One question at a time, and only where somebody can take it.
    const box = { pending: undefined as string | undefined };
    if (takesQuestions) questionBoxes.set(token, box);

    const put = async (kind: string, prompt: string, skippable: boolean): Promise<string> => {
      // Nobody is there any more. Every remaining question is answered with silence — the same
      // shape as a skip — and the session reaches its own end without them, rather than holding
      // one timer per question it still had to ask.
      if (gone) return "";
      send("question", { token, kind, prompt, skippable });
      const answer = await waitForAnswer(token, ANSWER_TIMEOUT_MS);
      // Echoed back so the page can clear its input. Without it the page would keep showing a
      // question the session has already gone past — including the case where it timed out and
      // the learner is typing into something nobody is listening to.
      send("heard", { token, answer });
      return answer.trim();
    };

    // Only supplied when the page is the learner. Absent keys, not undefined ones: the
    // apparatus falls back to the recorded answers by their ABSENCE.
    const asking = learner
      ? {
          askProbe: async (probe: Probe): Promise<string | undefined> => {
            const answer = await put("probe", probe.prompt, true);
            return answer === "" ? undefined : answer;
          },
          askTerminal: async (asked: UnderstandingCheck): Promise<string> => put("check", asked.prompt, false),
          askRetake: async (asked: UnderstandingCheck): Promise<string | undefined> => {
            const answer = await put("retake", asked.prompt, true);
            return answer === "" ? undefined : answer;
          },
          takeQuestion: (): string | undefined => {
            const question = box.pending;
            if (question === undefined) return undefined;
            box.pending = undefined;
            // Told so the page can show what was just picked up. Without it, a learner who asked
            // could not tell a queued question from a lost one.
            send("question-taken", { text: question });
            return question;
          },
        }
      : {};

    send("meta", {
      mode: isLive ? "live" : "fixture",
      expert:
        describeExpert(expert) +
        (challenger.persona.id === expert.persona.id ? "" : ` · 质疑者：${challenger.persona.name}`) +
        ` · ${learner ? "学习者是你" : `学习者：${profile.name}`}`,
      detail:
        live === null
          ? `夹具回放 · 每步 ${chunkDelayMs}ms`
          : (live?.describe ?? "live"),
      learner,
      // Told separately from `learner`: a page can be the learner without a board that can
      // answer a question, and offering the bar there would be offering nothing.
      questions: takesQuestions,
      // The page needs the token before it can post a question of its own — waiting for a probe
      // to carry it would mean a learner who thought of something could not ask until the
      // platform happened to ask them first.
      token,
    });

    // The learner closed the tab. From here on nobody is there — not just for the wait that
    // happens to be open, but for everything the session still had to ask.
    request.on("close", () => {
      gone = true;
      waiting.get(token)?.("");
      box.pending = undefined;
      questionBoxes.delete(token);
    });

    void (async () => {
      try {
        const result = await runApparatusSession(provider, {
          expert,
          challenger,
          check,
          retakeCheck,
          ...asking,
          // No injected list. The board shows the WHOLE loop, list generation
          // included — an experiment needs the claims held constant, a demonstration
          // does not.
          probeAnswers: profile.probeAnswers,
          terminalAnswer: profile.terminalAnswer,
          retryAnswer: profile.retryAnswer,
          sessionId,
          store,
          // Each step redraws from the events, so the page never has to merge.
          onStep: (log) => send("surface", { surface: render(log.events), narration: log.narration }),
          // Told as each phase BEGINS: preparation is several model calls with nothing on the
          // board, and a page that says nothing for a minute looks broken while it works.
          onPhase: (phase) => send("phase", { phase }),
        });

        const final = result.verdictAfterRetry ?? result.verdict;
        if (result.stoppedBefore !== null) {
          // Echoed to the console too: a stop is the one outcome whose diagnosis lives nowhere
          // else — nothing was taught, so there is no record to inspect afterwards.
          const unsupported = result.semantic.filter((verdict) => !verdict.ok);
          console.error(
            `[session ${sessionId}] stopped before teaching — the verifier rejected: ` +
              unsupported.map((verdict) => `${verdict.id}: ${verdict.reason}`).join("; "),
          );
        }
        send("done", {
          passed: final?.verdict === "pass",
          retaken: result.verdictAfterRetry !== null,
          checkId: final?.checkId ?? null,
          // A session that stopped before teaching must carry its own diagnosis: "未通过" with no
          // reason leaves the learner with nothing to act on.
          stoppedBefore: result.stoppedBefore,
          unsupported: result.semantic
            .filter((verdict) => !verdict.ok)
            .map((verdict) => ({ id: verdict.id, reason: verdict.reason })),
          calls: result.usage.calls,
          costUsd: result.usage.costUsd,
          // Handed to the page so it can tell the learner how to come back. A record nobody can
          // name is a record nobody returns to, and the whole retention measure is what happens
          // on the return visit.
          sessionId,
          saved: result.saved,
        });
      } catch (error) {
        // A failed session has to reach the page. A server that logs to its own
        // console and leaves the board hanging shows a learner an empty screen and
        // calls it a lesson.
        send("failed", error instanceof Error ? error.message : String(error));
      }
      // The lesson is over. A question still queued was never taken, and the page is told
      // rather than left waiting on an answer that cannot come (ADR 0008).
      if (box.pending !== undefined) {
        send("question-dropped", { text: box.pending });
        box.pending = undefined;
      }
      response.end();
    })();
  });
}

// Only listen when run directly; importing this in a test must not open a port.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? process.argv.find((arg) => /^\d+$/.test(arg)) ?? 8787);
  createBoardServer().listen(port, () => {
    console.log(`drawing the blackboard on http://localhost:${port}/`);
    console.log("  ?live=1 to use the configured provider instead of the recorded replay");
  });
}
