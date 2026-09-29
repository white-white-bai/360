import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { findCheck } from "../checks/load.ts";
import type { UnderstandingCheck } from "../checks/types.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { PROFILES } from "../experiment/fixtures-experiment.ts";
import { selectLiveProvider } from "../providers/live.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { render } from "../render/render.ts";
import { runApparatusSession } from "../session/apparatus.ts";
import type { Probe } from "../session/contracts.ts";
import { misconceptionScript } from "../session/fixtures-apparatus.ts";

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
}

/** How long a question waits for the page before it is treated as unanswered. */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1000;

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

const CHUNK_DELAY_MS = 450;
const HTML = readFileSync(new URL("./index.html", import.meta.url), "utf8");

export function createBoardServer(options: BoardOptions = {}): Server {
  const chunkDelayMs = options.chunkDelayMs ?? CHUNK_DELAY_MS;

  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");
  const retakeCheck = findCheck(expert.domain.checks, "C-overlap");

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

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(HTML);
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

    const send = (event: string, data: unknown): void => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const wantsLive = url.searchParams.get("live") === "1";
    const live = wantsLive ? selectLiveProvider() : null;
    if (wantsLive && live === null && options.provider === undefined) {
      send("failed", "no provider is configured — see `npm run probe`");
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

    const put = async (kind: string, prompt: string, skippable: boolean): Promise<string> => {
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
        }
      : {};

    send("meta", {
      mode: live === null ? "fixture" : "live",
      expert: `${describeExpert(expert)} · ${learner ? "学习者是你" : `学习者：${profile.name}`}`,
      detail:
        live === null
          ? `夹具回放 · 每步 ${chunkDelayMs}ms`
          : (live?.describe ?? "live"),
      learner,
    });

    // The learner closed the tab. The session must not sit on a question for ten minutes
    // waiting for an answer that is not coming: it is told nobody is there, in the same shape as
    // a skip, and it reaches its own end.
    request.on("close", () => {
      waiting.get(token)?.("");
    });

    void (async () => {
      try {
        const result = await runApparatusSession(provider, {
          expert,
          check,
          retakeCheck,
          ...asking,
          // No injected list. The board shows the WHOLE loop, list generation
          // included — an experiment needs the claims held constant, a demonstration
          // does not.
          probeAnswers: profile.probeAnswers,
          terminalAnswer: profile.terminalAnswer,
          retryAnswer: profile.retryAnswer,
          sessionId: `board-${Date.now()}`,
          // Each step redraws from the events, so the page never has to merge.
          onStep: (log) => send("surface", { surface: render(log.events), narration: log.narration }),
        });

        const final = result.verdictAfterRetry ?? result.verdict;
        send("done", {
          passed: final?.verdict === "pass",
          retaken: result.verdictAfterRetry !== null,
          checkId: final?.checkId ?? null,
          calls: result.usage.calls,
          costUsd: result.usage.costUsd,
        });
      } catch (error) {
        // A failed session has to reach the page. A server that logs to its own
        // console and leaves the board hanging shows a learner an empty screen and
        // calls it a lesson.
        send("failed", error instanceof Error ? error.message : String(error));
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
