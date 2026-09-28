import { findCheck } from "../checks/load.ts";
import { deserializeLog, serializeLog } from "../events/log.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import { render } from "../render/render.ts";
import { surfaceToText } from "../render/text.ts";
import { runBaselineSession } from "./baseline.ts";
import { EXPLAINER_FIXTURE } from "./fixture-explanation.ts";

const usd = (n: number): string => `$${n.toFixed(6)}`;

function banner(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function main(): Promise<void> {
  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");

  banner("BASELINE SESSION — one explainer, one terminal check, no apparatus");
  console.log(`expert        : ${describeExpert(expert)}`);
  console.log(`domain owner  : ${expert.domain.owner}`);
  console.log(`delivery      : ${expert.domain.deliveryLanguage}   corpus passages: ${expert.domain.corpus.passages.length}`);
  console.log(`check         : ${check.id}`);
  console.log(`  prompt      : ${check.prompt}`);
  console.log(`  expected    : ${check.expected}`);
  console.log("  (hand-authored asset — the explainer cannot see or shape it)");

  const scenarios: ReadonlyArray<readonly [string, string]> = [
    ["answers correctly", check.expected],
    ["holds a catalogued misconception", "这个本地时间正常存在，只是偏移量不同"],
    ["says something nobody anticipated", "我猜是下午两点半左右吧"],
  ];

  for (const [label, answer] of scenarios) {
    const provider = new ScriptedProvider({ "lead-explainer": EXPLAINER_FIXTURE });
    const result = await runBaselineSession(provider, {
      expert,
      check,
      learnerAnswer: answer,
      sessionId: `demo-${check.id}`,
    });

    banner(`learner ${label}`);

    console.log("NARRATION (stream 1 of 2)");
    const narration = [...result.log.narration].sort((a, b) => a.at - b.at);
    for (const chunk of narration) console.log(`  ${chunk.at.toString().padStart(2)} | ${chunk.text}`);

    console.log("\nBLACKBOARD (stream 2 of 2, replayed from the event log)");
    for (const line of surfaceToText(result.surface).split("\n")) console.log(`  ${line}`);

    console.log("\nVERDICT");
    console.log(`  answer      : ${answer}`);
    console.log(`  verdict     : ${result.verdict.verdict.toUpperCase()} (graded by ${result.verdict.gradedBy})`);
    if (result.verdict.diagnosis !== null) {
      const { misconceptionId, reason } = result.verdict.diagnosis;
      console.log(`  diagnosis   : ${misconceptionId ?? "(none catalogued)"} — ${reason}`);
      if (misconceptionId !== null) {
        const misconception = expert.domain.misconceptions.find((m) => m.id === misconceptionId);
        console.log(`  wrong model : ${misconception?.wrongModel ?? "?"}`);
        console.log(`  refutation  : ${misconception?.refutation ?? "?"}`);
        console.log("  -> in the apparatus this is what summons the Challenger; in the");
        console.log("     baseline there is no Challenger, so the session simply ends here.");
      }
    }

    console.log("\nUSAGE");
    console.log(
      `  calls ${result.usage.calls}  in ${result.usage.inputTokens} tok  out ${result.usage.outputTokens} tok  ${usd(result.usage.costUsd)}`,
    );

    // Replay is the acceptance mechanism (ADR 0005), so prove it here rather than
    // assert it in a comment: a log that survives storage must render identically.
    const restored = deserializeLog(serializeLog(result.log));
    const replayed = render(restored.events);
    const faithful = JSON.stringify(replayed) === JSON.stringify(result.surface);
    console.log(`\nREPLAY CHECK: ${faithful ? "surface matches after a storage round trip" : "MISMATCH — replay is not faithful"}`);
    if (!faithful) process.exitCode = 1;
  }

  console.log("\nBaseline complete. Nothing here is apparatus: no assertion list, no");
  console.log("grounding verification, no probes, no Challenger. That is the point —");
  console.log("this is the object every appliance will later be measured against.\n");
}

await main();
