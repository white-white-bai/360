import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { findCheck } from "../checks/load.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { PROFILES } from "../experiment/fixtures-experiment.ts";
import { selectLiveProvider } from "../providers/live.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { render } from "../render/render.ts";
import { runApparatusSession } from "../session/apparatus.ts";
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

    send("meta", {
      mode: live === null ? "fixture" : "live",
      expert: `${describeExpert(expert)} · 学习者：${profile.name}`,
      detail:
        live === null
          ? `夹具回放 · 每步 ${chunkDelayMs}ms`
          : (live?.describe ?? "live"),
    });

    void (async () => {
      try {
        const result = await runApparatusSession(provider, {
          expert,
          check,
          retakeCheck,
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
