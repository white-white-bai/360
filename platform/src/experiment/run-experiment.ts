import { parseAssertionList } from "../assertions/parse.ts";
import type { AssertionList } from "../assertions/types.ts";
import { findCheck } from "../checks/load.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { configFromEnv, liveProvider } from "../providers/openai.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { apparatusTrialScript, baselineTrialScript, EXPERIMENT_LIST, PROFILES } from "./fixtures-experiment.ts";
import type { Condition, TrialResult } from "./harness.ts";
import { compare, runTrial } from "./harness.ts";

const CONDITIONS: readonly Condition[] = ["baseline", "apparatus"];

function pad(text: string, width: number): string {
  // Chinese glyphs are two columns wide in a terminal; counting code points makes
  // the table ragged, which is the one thing a table must not be.
  let columns = 0;
  for (const character of text) columns += /[\u3000-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1;
  return text + " ".repeat(Math.max(0, width - columns));
}

function right(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - text.length)) + text;
}

const usd = (value: number): string => `$${value.toFixed(4)}`;

async function main(): Promise<void> {
  const live = process.argv.includes("--live");

  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", "time-zones");
  const check = findCheck(expert.domain.checks, "C-gap");

  console.log("Ablation experiment (ADR 0001, ADR 0015)");
  console.log(`  expert   ${describeExpert(expert)}`);
  console.log(`  check    ${check.id} — the same hand-authored asset in every trial`);
  console.log(`  learners ${PROFILES.map((profile) => profile.name).join(", ")}`);
  console.log("  baseline = the apparatus with semanticVerify, probes and challenger switched off");

  if (live) {
    if (liveProvider() === null) {
      console.error("\n--live was asked for, but no provider is configured. Run `npm run probe` for the details.");
      process.exitCode = 1;
      return;
    }
    const config = configFromEnv();
    console.log(`\n  MODE LIVE — via ${config.baseUrl}, model ${config.model}`);
    console.log("  The first trial generates the claims; every later trial is given them.");
  } else {
    console.log("\n  MODE FIXTURE — recorded responses, so the numbers below are ILLUSTRATIVE, not");
    console.log("  evidential. They show the harness is wired to the right thing. Real numbers need");
    console.log("  a real provider: `npm run experiment -- --live`.");
  }

  /** In a live run the first trial produces the stimulus; every later one is given it. */
  let stimulus: AssertionList | undefined;
  if (!live) stimulus = parseAssertionList(EXPERIMENT_LIST, "time-zones");

  const trials: TrialResult[] = [];
  /** Kept alongside the results so a row can name the learner it belongs to. */
  const rows: Array<{ learner: string; trial: TrialResult }> = [];
  for (const profile of PROFILES) {
    for (const condition of CONDITIONS) {
      const provider: ModelProvider = live
        ? (liveProvider() as ModelProvider)
        : new ScriptedProvider(condition === "baseline" ? baselineTrialScript() : apparatusTrialScript(profile));

      const result = await runTrial(condition, provider, {
        expert,
        check,
        list: stimulus,
        probeAnswers: profile.probeAnswers,
        terminalAnswer: profile.terminalAnswer,
        retryAnswer: profile.retryAnswer,
        selfAssessment: profile.selfAssessment,
      });

      if (stimulus === undefined) stimulus = result.list;
      trials.push(result);
      rows.push({ learner: profile.name, trial: result });
    }
  }

  console.log("\nPER TRIAL");
  console.log(
    `  ${pad("condition", 12)}${pad("learner", 26)}${pad("result", 9)}${pad("retake", 8)}${right("concerns", 9)}${right("calls", 7)}${right("cost", 10)}`,
  );
  for (const { learner, trial } of rows) {
    console.log(
      `  ${pad(trial.condition, 12)}${pad(learner, 26)}${pad(trial.passed ? "pass" : "FAIL", 9)}${pad(trial.retaken ? "yes" : "no", 8)}${right(String(trial.probeConcerns), 9)}${right(String(trial.calls), 7)}${right(usd(trial.costUsd), 10)}`,
    );
  }

  const comparison = compare(trials, PROFILES.length);
  console.log("\nPER CONDITION");
  console.log(`  ${pad("condition", 12)}${right("trials", 8)}${right("passed", 8)}${right("rate", 8)}${right("mean calls", 12)}${right("mean cost", 12)}${right("recalled gap", 14)}`);
  for (const summary of [comparison.baseline, comparison.apparatus]) {
    console.log(
      `  ${pad(summary.condition, 12)}${right(String(summary.trials), 8)}${right(String(summary.passed), 8)}${right(`${(summary.passRate * 100).toFixed(0)}%`, 8)}${right(summary.meanCalls.toFixed(1), 12)}${right(usd(summary.meanCostUsd), 12)}${right(summary.meanIllusionGap === null ? "n/a" : summary.meanIllusionGap.toFixed(2), 14)}`,
    );
  }
  console.log(`  ${pad("challenges", 12)}${right(`baseline ${comparison.baseline.challenges}`, 24)}${right(`apparatus ${comparison.apparatus.challenges}`, 24)}`);

  console.log(`\nVERDICT  ${comparison.verdict.toUpperCase()}`);
  console.log(`  ${comparison.reason}`);

  if (!live) {
    console.log(
      "\n  A fixture run can only show a difference the fixtures were written to contain. Treat the" +
        "\n  verdict above as a demonstration, and re-run with --live before believing anything.",
    );
  }
}

await main();
