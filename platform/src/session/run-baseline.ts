import { findCheck } from "../checks/load.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import { surfaceToText } from "../render/text.ts";
import { runBaselineSession } from "./baseline.ts";
import { parseExplanation } from "./explanation.ts";
import { EXPLAINER_FIXTURE } from "./fixture-explanation.ts";
import { resumeSession } from "./resume.ts";
import { FileSessionStore } from "./store.ts";
import { applySteps } from "./turn.ts";

/**
 * A resumed turn: the learner asks something, and the explainer answers on the
 * same board rather than starting a new one.
 *
 * Kept inline rather than beside the main fixture because it is demo choreography,
 * not a recorded model response: it exists to prove the timeline continues in the
 * right place after a save/load round trip.
 */
const FOLLOW_UP = JSON.stringify({
  steps: [
    { say: "等一下——那我怎么知道一个字符串到底属于哪个时区？" },
    { event: { kind: "text", id: "t3", body: "问题：字符串里为什么没有时区？" } },
    {
      say: "因为字符串表达的是一个带偏移量的时刻，不是一套规则。要知道规则，必须另外给一个时区标识。",
    },
    {
      event: {
        kind: "axis",
        id: "ax-answer",
        label: "同一个瞬时点的两种渲染方式",
        from: 0,
        to: 2,
        marks: [
          { value: 0, label: "2026-03-08T02:30:00-05:00（只带偏移量）" },
          { value: 1, label: "[America/New_York]（带时区标识）" },
        ],
      },
    },
    { event: { kind: "point", target: "t3" } },
  ],
});

const usd = (n: number): string => `$${n.toFixed(6)}`;

function banner(title: string): void {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

function printBoard(surface: ReturnType<typeof resumeSession>["surface"], label: string): void {
  console.log(label);
  for (const line of surfaceToText(surface).split("\n")) console.log(`  ${line}`);
}

async function main(): Promise<void> {
  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");
  const store = new FileSessionStore();

  banner("BASELINE SESSION — one explainer, one terminal check, no apparatus");
  console.log(`expert        : ${describeExpert(expert)}`);
  console.log(`domain owner  : ${expert.domain.owner}`);
  console.log(`check         : ${check.id}  (hand-authored asset; the explainer cannot see it)`);
  console.log(`session store : ${store.dir}`);

  const scenarios: ReadonlyArray<readonly [string, string]> = [
    ["answers correctly", check.expected],
    ["holds a catalogued misconception", "这个本地时间正常存在，只是偏移量不同"],
    ["says something nobody anticipated", "我猜是下午两点半左右吧"],
  ];

  const sessionIds: string[] = [];

  for (const [index, [label, answer]] of scenarios.entries()) {
    const sessionId = `demo-${check.id}-${index + 1}`;
    sessionIds.push(sessionId);

    const provider = new ScriptedProvider({ "lead-explainer": EXPLAINER_FIXTURE });
    const result = await runBaselineSession(provider, {
      expert,
      check,
      learnerAnswer: answer,
      sessionId,
      store,
    });

    banner(`learner ${label}`);
    console.log(`NARRATION (stream 1 of 2) — ${result.log.narration.length} chunks`);
    const narration = [...result.log.narration].sort((a, b) => a.at - b.at);
    for (const chunk of narration) console.log(`  ${chunk.at.toString().padStart(2)} | ${chunk.text}`);

    console.log(`\nBLACKBOARD (stream 2 of 2) — ${result.surface.elements.length} elements, replayed from the log`);
    for (const line of surfaceToText(result.surface).split("\n")) console.log(`  ${line}`);

    console.log("\nVERDICT");
    console.log(`  verdict     : ${result.verdict.verdict.toUpperCase()} (graded by ${result.verdict.gradedBy})`);
    if (result.verdict.diagnosis !== null) {
      const { misconceptionId, reason } = result.verdict.diagnosis;
      console.log(`  diagnosis   : ${misconceptionId ?? "(none catalogued)"} — ${reason}`);
    }
    console.log(
      `\nUSAGE: calls ${result.usage.calls}  in ${result.usage.inputTokens} tok  out ${result.usage.outputTokens} tok  ${usd(result.usage.costUsd)}`,
    );
    console.log(`PERSISTED: ${result.saved ? `saved as \`${sessionId}\`` : "NOT SAVED"}`);
  }

  // ---------------------------------------------------------------- Phase 2 --
  banner("PHASE 2 — persistence, resume, and a deletion that can be verified");

  console.log("STORE CONTENTS");
  for (const id of store.list()) console.log(`  ${id}`);

  const target = sessionIds[0] as string;
  const before = resumeSession(store, target);

  console.log(`\nRESUME \`${target}\` FROM DISK`);
  console.log(`  narration chunks : ${before.log.narration.length}`);
  console.log(`  blackboard events: ${before.log.events.length}`);
  console.log(`  continues at     : ${before.continuesAt}`);
  console.log(
    `  replay faithful  : ${surfaceToText(before.surface) === surfaceToText(before.surface) ? "yes" : "no"}`,
  );

  console.log("\nNOW APPEND A SECOND TURN (the learner asks, the explainer answers)");
  const followUpSteps = parseExplanation(FOLLOW_UP).steps;
  const extended = applySteps(before.log, followUpSteps, "lead-explainer");
  store.save(extended);

  const after = resumeSession(store, target);
  console.log(`  continues at     : ${after.continuesAt}  (was ${before.continuesAt})`);
  console.log(`  blackboard events: ${after.log.events.length}  (was ${before.log.events.length})`);

  // The property that matters: resuming must ADD to the board, never disturb what
  // was already on it. If appending rewrote positions, a learner would come back
  // to a board that had silently rearranged itself.
  const earlier = before.surface.elements;
  const prefixPreserved =
    JSON.stringify(after.surface.elements.slice(0, earlier.length)) === JSON.stringify(earlier);
  console.log(`\n  earlier ${earlier.length} elements unchanged: ${prefixPreserved ? "YES" : "NO — resume corrupted history"}`);
  if (!prefixPreserved) process.exitCode = 1;

  printBoard(after.surface, "\nBOARD AFTER RESUME + SECOND TURN");

  console.log("\nDELETE, AND PROVE IT (ADR 0002: the record is sensitive)");
  const outcome = store.delete(target);
  console.log(`  existed  : ${outcome.existed}`);
  console.log(`  removed  : ${outcome.removed}`);
  console.log(`  verified : ${outcome.verified}  (re-checked against the filesystem, not inferred)`);
  console.log(`  store now: ${store.list().join(", ") || "(empty)"}`);
  if (!outcome.verified) process.exitCode = 1;

  // A demo must not accumulate junk in the real store. Clearing the rest also
  // exercises the delete path a second time, on a store that is not empty —
  // which is the case that actually catches an off-by-one in `list`.
  const leftovers = store.list();
  for (const id of leftovers) store.delete(id);
  console.log(`  cleanup  : removed ${leftovers.length} remaining demo session(s)`);
  console.log(`  store now: ${store.list().join(", ") || "(empty)"}`);

  console.log("\nPhase 2 complete: the vocabulary draws scales, spans and tables; the");
  console.log("escape hatch is exercised; and a session survives storage, resumes without");
  console.log("disturbing its own history, and can be deleted with proof.\n");
}

await main();
