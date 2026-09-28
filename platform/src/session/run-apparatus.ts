import { findCheck } from "../checks/load.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import { surfaceToText } from "../render/text.ts";
import { runApparatusSession } from "./apparatus.ts";
import type { ApparatusResult } from "./apparatus.ts";
import { cleanScript, misconceptionScript } from "./fixtures-apparatus.ts";

const usd = (n: number): string => `$${n.toFixed(6)}`;

function banner(title: string): void {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

function summarise(label: string, result: ApparatusResult): void {
  banner(label);
  console.log(`PHASES     ${result.phases.join(" -> ")}`);

  if (result.stoppedBefore !== null) {
    const unsupported = result.semantic.filter((verdict) => !verdict.ok);
    console.log(`STOPPED    before teaching: ${result.stoppedBefore}`);
    for (const verdict of unsupported) {
      console.log(`  unsupported claim ${verdict.id}: ${verdict.reason}`);
    }
    console.log(`SAID       ${result.log.narration.length} narration chunks, ${result.log.events.length} events`);
    console.log("           nothing was delivered on an unverified list (ADR 0005)");
    return;
  }

  console.log(`CLAIMS     ${result.list.assertions.length}`);
  for (const assertion of result.list.assertions) {
    const cites = assertion.sources.length > 0 ? ` <- ${assertion.sources.join(", ")}` : "";
    console.log(`  ${assertion.id} [${assertion.kind}] ${assertion.statement}${cites}`);
  }

  const failed = result.structural.verdicts.filter((verdict) => !verdict.ok);
  console.log(`STRUCTURAL ${failed.length === 0 ? "every citation resolves" : `${failed.length} unresolved`}`);

  const unsupported = result.semantic.filter((verdict) => !verdict.ok);
  console.log(`SEMANTIC   ${unsupported.length === 0 ? "every claim supported by what it cites" : `${unsupported.length} unsupported`}`);
  console.log(`PROBES     ${result.probes.map((probe) => `${probe.id}@${probe.afterAssertion}`).join("  ") || "(none)"}`);
  for (const outcome of result.outcomes) {
    const tone = outcome.concern ? "CONCERN" : "ok";
    console.log(`  ${outcome.probeId} ${tone} ${outcome.misconceptionId ?? ""} ${outcome.reason}`);
  }

  console.log(`CHALLENGER ${result.challenge.fired ? `summoned by ${result.challenge.triggers.join(", ")}` : "not summoned"}`);
  console.log(`VERDICT    ${result.verdict?.verdict.toUpperCase() ?? "n/a"}  (${result.verdict?.diagnosis?.reason ?? "no diagnosis"})`);
  console.log(`USAGE      calls ${result.usage.calls}  in ${result.usage.inputTokens} tok  out ${result.usage.outputTokens} tok  ${usd(result.usage.costUsd)}`);

  console.log("\nBOARD (replayed from the event log)");
  for (const line of surfaceToText(result.surface).split("\n")) console.log(`  ${line}`);
}

async function main(): Promise<void> {
  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");

  banner("APPARATUS — claims, verification, probes, challenge");
  console.log(`expert  ${describeExpert(expert)}`);
  console.log(`check   ${check.id}  (hand-authored asset; the explainer never sees it)`);
  console.log("order   claims -> structural check -> INDEPENDENT semantic check -> probes");
  console.log("        -> narration -> terminal check -> probe outcomes -> Challenger -> retry");

  const answers = ["时区是规则，偏移量是某一瞬间的结果", "我会说那段时间在这台机器上根本不存在"];

  const clean = await runApparatusSession(new ScriptedProvider(cleanScript()), {
    expert,
    check,
    probeAnswers: answers,
    terminalAnswer: check.expected,
    sessionId: "demo-apparatus-clean",
  });
  summarise("SCENARIO 1 — everything passes", clean);

  const dirty = await runApparatusSession(new ScriptedProvider(misconceptionScript()), {
    expert,
    check,
    probeAnswers: answers,
    terminalAnswer: check.expected,
    sessionId: "demo-apparatus-misconception",
  });
  summarise("SCENARIO 2 — a probe exposes a catalogued misconception", dirty);

  const earlier = clean.surface.elements;
  const grew = dirty.surface.elements.length > earlier.length;
  const prefixPreserved =
    JSON.stringify(dirty.surface.elements.slice(0, earlier.length)) === JSON.stringify(earlier);
  console.log(
    `\nRETRY: board ${grew ? "grew" : "did not grow"} (${earlier.length} -> ${dirty.surface.elements.length}); ` +
      `earlier elements ${prefixPreserved ? "unchanged" : "CHANGED — the retry disturbed history"}`,
  );
  if (!prefixPreserved) process.exitCode = 1;

  const unsupportedScript = cleanScript();
  unsupportedScript["grounding-verifier"] = JSON.stringify({
    verdicts: [
      { id: "A1", ok: true, reason: "" },
      { id: "A2", ok: true, reason: "" },
      { id: "A3", ok: false, reason: "the grammar shows an offset is carried, but nothing says a timestamp cannot also name a zone" },
      { id: "A4", ok: true, reason: "scaffold" },
    ],
  });
  const stopped = await runApparatusSession(new ScriptedProvider(unsupportedScript), {
    expert,
    check,
    probeAnswers: answers,
    terminalAnswer: check.expected,
    sessionId: "demo-apparatus-stopped",
  });
  summarise("SCENARIO 3 — one claim the source does not support", stopped);

  console.log("\nPhase 4 is complete: claims are separated from delivery, verified by the kernel and");
  console.log("then by an independent actor, probes are authored by someone other than the explainer,");
  console.log("and the Challenger has exactly two triggers. What is NOT here is the ablation harness");
  console.log("itself (Phase 5) and a real provider behind the actor interface.\n");
}

await main();
