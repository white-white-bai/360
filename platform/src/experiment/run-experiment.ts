import { parseAssertionList } from "../assertions/parse.ts";
import type { AssertionList } from "../assertions/types.ts";
import { findCheck } from "../checks/load.ts";
import { composeExpert, loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import { selectLiveProvider } from "../providers/live.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { loadRepoEnv } from "../util/local-env.ts";
import {
  apparatusTrialScript,
  baselineTrialScript,
  EXPERIMENT_CHECKS,
  EXPERIMENT_DOMAIN,
  EXPERIMENT_LIST,
  PROFILES,
} from "./fixtures-experiment.ts";
import type { Comparison, Condition, TrialResult } from "./harness.ts";
import { compare, runTrial } from "./harness.ts";
import { ExperimentStore } from "./records.ts";

const CONDITIONS: readonly Condition[] = ["baseline", "apparatus"];

function pad(text: string, width: number): string {
  // Chinese glyphs are two columns wide in a terminal; counting code points makes
  // the table ragged, which is the one thing a table must not be.
  let columns = 0;
  for (const character of text) columns += /[　-鿿＀-￯]/.test(character) ? 2 : 1;
  return text + " ".repeat(Math.max(0, width - columns));
}

function right(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - text.length)) + text;
}

const usd = (value: number): string => `$${value.toFixed(4)}`;

/**
 * How often to show that something is still happening.
 *
 * A live call takes seconds, so a dot per call is roughly a dot per four seconds. The
 * number is a compromise between "the screen is moving" and "the screen is noise".
 */
const TICK_MS = 4000;

interface PanelRow {
  learner: string;
  trial: TrialResult;
}

/**
 * One source's report — its trials, its conditions, and ITS OWN verdict.
 *
 * The two sources are never pooled (ADR 0019), so this is called once per source rather
 * than once over everything. A single verdict over both would be the experiment averaging
 * a script against a person, which is the exact thing the source field exists to forbid.
 */
function printPanel(options: {
  title: string;
  rows: readonly PanelRow[];
  /** The terminal check's id, naming the asset that decided a first-attempt verdict. */
  checkId: string;
  /** How many COMPLETED trials a condition needs before the verdict is anything but inconclusive. */
  minTrials: number;
  money: (value: number) => string;
}): Comparison {
  const { title, rows, checkId, minTrials, money } = options;

  console.log(`\nPER TRIAL — ${title}`);
  console.log(
    `  ${pad("condition", 12)}${pad("learner", 26)}${pad("result", 9)}${pad("decided by", 13)}${right("concerns", 9)}${right("calls", 7)}${right("cost", 10)}`,
  );
  for (const { learner, trial } of rows) {
    // The asset that produced the verdict: the first question, or the retake's. They
    // are different claims about the learner and must not look the same.
    const decidedBy = trial.completed ? (trial.retakeCheckId ?? checkId) : "—";
    console.log(
      `  ${pad(trial.condition, 12)}${pad(learner, 26)}${pad(trial.completed ? (trial.passed ? "pass" : "FAIL") : "INCOMPLETE", 9)}${pad(decidedBy, 13)}${right(String(trial.probeConcerns), 9)}${right(String(trial.calls), 7)}${right(money(trial.costUsd), 10)}`,
    );
    if (!trial.completed) {
      // The reason gets its own line and is not truncated. An incomplete trial is the one row
      // a reader has to act on, and "why" is the whole of what it has to say.
      console.log(`      ↳ could not be run: ${trial.incompleteReason ?? "unknown"}`);
    }
  }

  const comparison = compare(rows.map((row) => row.trial), minTrials);
  console.log(`\nPER CONDITION — ${title}`);
  console.log(
    `  ${pad("condition", 12)}${right("ran", 6)}${right("incompl", 9)}${right("passed", 8)}${right("rate", 8)}${right("retries", 9)}${right("retention", 11)}${right("transfer", 10)}${right("mean calls", 12)}${right("mean cost", 12)}${right("illusion", 10)}`,
  );
  // "no data" rather than 0%: a learner who never came back is not a learner who failed.
  const pct = (value: number | null): string => (value === null ? "no data" : `${(value * 100).toFixed(0)}%`);
  for (const summary of [comparison.baseline, comparison.apparatus]) {
    console.log(
      `  ${pad(summary.condition, 12)}${right(String(summary.completed), 6)}${right(String(summary.incomplete), 9)}${right(String(summary.passed), 8)}${right(`${(summary.passRate * 100).toFixed(0)}%`, 8)}${right(String(summary.retries), 9)}${right(pct(summary.retentionRate), 11)}${right(pct(summary.transferRate), 10)}${right(summary.meanCalls.toFixed(1), 12)}${right(money(summary.meanCostUsd), 12)}${right(summary.meanIllusionGap === null ? "n/a" : summary.meanIllusionGap.toFixed(2), 10)}`,
    );
  }
  console.log(
    `  ${pad("challenges", 12)}${right(`baseline ${comparison.baseline.challenges}`, 24)}${right(`apparatus ${comparison.apparatus.challenges}`, 24)}`,
  );

  console.log(`\nVERDICT (${title})  ${comparison.verdict.toUpperCase()}`);
  console.log(`  ${comparison.reason}`);
  if (comparison.caveat !== null) {
    console.log(`\n  READ THIS TOO — ${comparison.caveat}`);
  }
  return comparison;
}

async function main(): Promise<void> {
  // The repo's local .env first: a key that lives there is found before anything asks for one.
  loadRepoEnv();
  const live = process.argv.includes("--live");
  const liveSelection = live ? selectLiveProvider() : null;

  const library = loadLibrary();
  const expert = composeExpert(library, "patient-explainer", "analogy-heavy", EXPERIMENT_DOMAIN);
  const check = findCheck(expert.domain.checks, EXPERIMENT_CHECKS.terminal);
  // A DIFFERENT asset for the second sitting. Re-asking the question the learner just
  // failed measures recall of that question, which would flatter the apparatus for a
  // reason that has nothing to do with understanding.
  const retakeCheck = findCheck(expert.domain.checks, EXPERIMENT_CHECKS.retake);
  // A question the explanation never used: can they apply the same claim somewhere new.
  // Asking one they were just taught the answer to measures recall, and recall is not
  // transfer.
  const transferCheck = findCheck(expert.domain.checks, EXPERIMENT_CHECKS.transfer);

  console.log("Ablation experiment (ADR 0001)");
  console.log(`  expert   ${describeExpert(expert)}`);
  console.log(`  check    ${check.id} — the same hand-authored asset in every trial`);
  console.log(`  retake   ${retakeCheck.id} — a DIFFERENT situation, so a pass after remediation`);
  console.log("           cannot be recall of the question that was just failed");
  console.log(`  transfer ${transferCheck.id} — a situation the lesson never used, asked a day later`);
  console.log(`  learners ${PROFILES.map((profile) => profile.name).join(", ")} — simulated`);
  console.log("  baseline = the apparatus with semanticVerify, probes and challenger switched off");
  // ADR 0019: a person's sitting is a different observation and gets its own panel below,
  // never averaged with a script's.
  console.log("  real learners, if any have sat one, are reported separately and never pooled with these");

  if (live) {
    if (liveSelection === null) {
      console.error("\n--live was asked for, but no provider is configured. Run `npm run probe` for the details.");
      process.exitCode = 1;
      return;
    }
    console.log(`\n  MODE LIVE — ${liveSelection.describe}`);
    console.log("  The first trial generates the claims; every later trial is given them.");
  } else {
    console.log("\n  MODE FIXTURE — recorded responses, so the numbers below are ILLUSTRATIVE, not");
    console.log("  evidential. They show the harness is wired to the right thing. Real numbers need");
    console.log("  a real provider: `npm run experiment -- --live`.");
  }

  /** In a live run the first trial produces the stimulus; every later one is given it. */
  let stimulus: AssertionList | undefined;
  if (!live) stimulus = parseAssertionList(EXPERIMENT_LIST, EXPERIMENT_DOMAIN);

  const trials: TrialResult[] = [];
  /** Kept alongside the results so a row can name the learner it belongs to. */
  const rows: PanelRow[] = [];
  const total = PROFILES.length * CONDITIONS.length;
  let index = 0;

  console.log(`\nRUNNING  ${total} trials`);
  for (const profile of PROFILES) {
    for (const condition of CONDITIONS) {
      const provider: ModelProvider =
        liveSelection?.provider ??
        new ScriptedProvider(condition === "baseline" ? baselineTrialScript() : apparatusTrialScript(profile));

      // Progress, and the reason it is here rather than in a comment: a live trial is several
      // four-second round trips, and the report does not exist until every trial is done. The
      // run was therefore silent for minutes, and a working experiment looked exactly like a
      // hung one — which is how a real attempt got mistaken for a stall and killed.
      index += 1;
      const began = Date.now();
      process.stdout.write(`  [${index}/${total}] ${condition} · ${profile.name} `);
      const pulse = setInterval(() => process.stdout.write("."), TICK_MS);

      let result: TrialResult;
      try {
        result = await runTrial(condition, provider, {
          expert,
          check,
          retakeCheck,
          list: stimulus,
          probeAnswers: profile.probeAnswers,
          terminalAnswer: profile.terminalAnswer,
          retryAnswer: profile.retryAnswer,
          transferCheck,
          // ADR 0001 asks for a day. The clock is MOVED rather than waited on, and the
          // elapsed time is printed with the result so a simulated day cannot pass for a
          // real one.
          followUp: {
            afterHours: 24,
            retentionAnswer: profile.retentionAnswer,
            transferAnswer: profile.transferAnswer,
          },
          selfAssessment: profile.selfAssessment,
        });
      } catch (error) {
        // A dead trial still has to end its own line, or the error is printed glued to a row
        // of dots and reads as part of the progress rather than as a failure.
        console.log(` FAILED TO RUN after ${((Date.now() - began) / 1000).toFixed(1)}s`);
        throw error;
      } finally {
        clearInterval(pulse);
      }

      if (stimulus === undefined) stimulus = result.list;
      trials.push(result);
      rows.push({ learner: profile.name, trial: result });
      console.log(
        `${result.passed ? "pass" : "FAIL"} · ${result.calls} calls · ${((Date.now() - began) / 1000).toFixed(1)}s` +
          `${result.retaken ? " · retaken" : ""}`,
      );
    }
  }

  // A person's trials, read off disk. The store is a read here and creates nothing. It is
  // read through `scan` rather than `list` because the report has to be able to SAY that a
  // file could not be read (ADR 0020): a record that is quietly absent from this panel reads
  // as a sitting that never happened, and a person's hour is worth more than that.
  const realScan = new ExperimentStore().scan();
  const realRows: PanelRow[] = realScan.records.map((record) => ({
    learner: record.learner,
    trial: record.trial,
  }));

  // A dollar figure computed from a fallback rate is not a measurement. Marking it where
  // it is printed is the only reason the flag exists. Both panels are checked, because a
  // real sitting pays the same placeholder rate a simulated one does.
  const placeholderPrices = [...trials, ...realRows.map((row) => row.trial)].some(
    (trial) => trial.costIsPlaceholder,
  );
  const money = (value: number): string => (placeholderPrices ? `≈${usd(value)}` : usd(value));

  const simulated = printPanel({
    title: "SIMULATED LEARNERS",
    rows,
    checkId: check.id,
    minTrials: PROFILES.length,
    money,
  });

  // The honest empty state, and it is not a footnote: until a person sits one, the platform
  // has measured the apparatus and said nothing about anybody. A simulated learner cannot
  // stand in (ADR 0019), so there is nothing to print but the instructions.
  console.log("\nPER TRIAL — REAL LEARNERS");
  // ADR 0020: a file the store could not read is NAMED and shown, never quietly dropped. It
  // is printed here rather than after the panel because a person's sitting that vanishes from
  // the numbers without a mark is the one outcome this report must not produce — and a reader
  // who meets the count first has to meet the caveat with it.
  if (realScan.unreadable.length > 0) {
    console.log(`  ${realScan.unreadable.length} file(s) on the shelf could not be read and are NOT counted below:`);
    for (const entry of realScan.unreadable) {
      console.log(`  ⚠ ${entry.file} — ${entry.reason}`);
    }
  }
  if (realRows.length === 0) {
    if (realScan.unreadable.length > 0) {
      // "Nobody has sat one" would be a claim this panel cannot make: a person may well have sat
      // one, and the files named above are the only reason it is not in the count. Saying it
      // anyway is exactly the silent absence ADR 0020 exists to prevent.
      console.log("  No record here could be read, so this panel says nothing about anybody. A person may");
      console.log("  have sat a trial — the files named above are why it is not counted. Repair or remove");
      console.log("  them, then re-run.");
    } else {
      console.log("  No person has sat a trial yet. A simulated learner cannot stand in for one, and the");
      console.log("  two are never averaged (ADR 0019) — so this panel stays empty until somebody runs");
      console.log("  `npm run enter -- --baseline` or `npm run enter -- --apparatus`.");
    }
  } else {
    printPanel({
      title: "REAL LEARNERS",
      rows: realRows,
      checkId: check.id,
      // A person's three trials is still a sample of three. The default threshold is the
      // honest one here, not a number tuned to make a small sample look decisive.
      minTrials: 3,
      money,
    });
  }

  if (placeholderPrices) {
    console.log(
      "\n  The costs above are PLACEHOLDER prices. This model is not in the price table, so the dollars" +
        "\n  come from the fallback rate in src/providers/pricing.ts and measure nothing. Set ATP_PRICE_IN" +
        "\n  and ATP_PRICE_OUT to the real numbers before quoting any of them.",
    );
  }
  const followUpHours = simulated.apparatus.meanFollowUpHours;
  if (followUpHours !== null) {
    console.log(
      `\n  The simulated follow-up clock was MOVED, not waited on (${followUpHours.toFixed(0)}h). The measurement` +
        "\n  is wired up; the waiting is not. Re-measure for real before believing any retention number here." +
        "\n  (Real learners' retention is measured over their own elapsed time, and is not affected by this.)",
    );
  }

  if (!live) {
    console.log(
      "\n  A fixture run can only show a difference the fixtures were written to contain. Treat the" +
        "\n  verdict above as a demonstration, and re-run with --live before believing anything.",
    );
  }
}

await main();
