import type { AssertionList } from "../assertions/types.ts";
import type { UnderstandingCheck } from "../checks/types.ts";
import type { Expert } from "../experts/types.ts";
import type { ModelProvider } from "../providers/types.ts";
import type { ApparatusFeature } from "../session/apparatus.ts";
import { ALL_FEATURES, runApparatusSession } from "../session/apparatus.ts";

/**
 * The ablation experiment (ADR 0001, ADR 0015).
 *
 * ADR 0001 accepts v1 by comparing one set of claims under two conditions, and
 * ADR 0015 says any piece of the apparatus that shows no difference against the
 * baseline should be deleted. Both need the same thing: a way to switch pieces
 * off and measure.
 *
 * The claims are INJECTED rather than generated per run, and that is the point of
 * the whole design here. If each condition produced its own claims, a difference
 * in outcome could just mean the two conditions taught different lessons — the
 * comparison would be confounded before it started. The list is the stimulus; the
 * condition is the treatment.
 */
export type Condition = "baseline" | "apparatus";

/**
 * What each condition switches off.
 *
 * The baseline is ADR 0001's: one strong explainer, the same terminal check, and
 * nothing else — no semantic verification, no probes, no Challenger. Everything
 * else is shared, including the structural check, which is a guard rather than a
 * teaching device and stays on in both.
 */
export const CONDITION_ABLATIONS: Record<Condition, readonly ApparatusFeature[]> = {
  baseline: ALL_FEATURES,
  apparatus: [],
};

export interface TrialInput {
  expert: Expert;
  check: UnderstandingCheck;
  /** The shared stimulus, generated once and taught by both conditions. */
  list: AssertionList;
  probeAnswers: readonly string[];
  terminalAnswer: string;
  /**
   * What the learner said they thought they understood, from 0 to 1.
   *
   * ADR 0001 asks for this because fluency produces the illusion of understanding:
   * a well-delivered explanation makes people feel they learned more than they
   * did. The gap between this and the measured result is that illusion, made into
   * a number — and it is the number this product should be judged on.
   */
  selfAssessment?: number;
}

export interface TrialResult {
  condition: Condition;
  disabled: readonly ApparatusFeature[];
  /**
   * True when the claims were injected rather than generated. It should always be
   * true in an experiment: two conditions that generated their own lists could
   * differ for a reason that has nothing to do with the apparatus.
   */
  listInjected: boolean;
  passed: boolean;
  diagnosis: string | null;
  probeConcerns: number;
  challengeFired: boolean;
  calls: number;
  costUsd: number;
  selfAssessment: number | null;
  /** self-assessment minus the measured result. Positive means they felt better than they did. */
  illusionGap: number | null;
}

export async function runTrial(
  condition: Condition,
  provider: ModelProvider,
  input: TrialInput,
): Promise<TrialResult> {
  const result = await runApparatusSession(provider, {
    expert: input.expert,
    check: input.check,
    probeAnswers: input.probeAnswers,
    terminalAnswer: input.terminalAnswer,
    list: input.list,
    disable: CONDITION_ABLATIONS[condition],
    sessionId: `trial-${condition}`,
  });

  const passed = result.verdict?.verdict === "pass";
  const selfAssessment = input.selfAssessment ?? null;
  return {
    condition,
    disabled: result.disabled,
    listInjected: result.listInjected,
    passed,
    diagnosis: result.verdict?.diagnosis?.misconceptionId ?? null,
    probeConcerns: result.outcomes.filter((outcome) => outcome.concern).length,
    challengeFired: result.challenge.fired,
    calls: result.usage.calls,
    costUsd: result.usage.costUsd,
    selfAssessment,
    illusionGap: selfAssessment === null ? null : selfAssessment - (passed ? 1 : 0),
  };
}

export interface ConditionSummary {
  condition: Condition;
  disabled: readonly ApparatusFeature[];
  trials: number;
  passed: number;
  passRate: number;
  meanCalls: number;
  meanCostUsd: number;
  probeConcerns: number;
  challenges: number;
  /** Mean of the per-trial illusion gaps, or null when nobody reported one. */
  meanIllusionGap: number | null;
}

export function summarise(condition: Condition, trials: readonly TrialResult[]): ConditionSummary {
  const mine = trials.filter((trial) => trial.condition === condition);
  const gaps = mine.map((trial) => trial.illusionGap).filter((gap): gap is number => gap !== null);
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    condition,
    disabled: CONDITION_ABLATIONS[condition],
    trials: mine.length,
    passed: mine.filter((trial) => trial.passed).length,
    passRate: mine.length === 0 ? 0 : mine.filter((trial) => trial.passed).length / mine.length,
    meanCalls: mean(mine.map((trial) => trial.calls)),
    meanCostUsd: mean(mine.map((trial) => trial.costUsd)),
    probeConcerns: mine.reduce((sum, trial) => sum + trial.probeConcerns, 0),
    challenges: mine.filter((trial) => trial.challengeFired).length,
    meanIllusionGap: gaps.length === 0 ? null : mean(gaps),
  };
}

export interface Comparison {
  baseline: ConditionSummary;
  apparatus: ConditionSummary;
  /**
   * The verdict ADR 0015 asks for, stated rather than left to the reader.
   *
   * It is deliberately conservative: with too few trials, or with no difference,
   * nothing is concluded — because "the apparatus helped" on three fixture runs is
   * an opinion, and "the apparatus did not help" on three fixture runs is the same
   * opinion with the opposite sign.
   */
  verdict: "apparatus-better" | "no-difference" | "baseline-better" | "inconclusive";
  reason: string;
}

export function compare(trials: readonly TrialResult[], minTrialsPerCondition = 3): Comparison {
  const baseline = summarise("baseline", trials);
  const apparatus = summarise("apparatus", trials);

  if (baseline.trials < minTrialsPerCondition || apparatus.trials < minTrialsPerCondition) {
    return {
      baseline,
      apparatus,
      verdict: "inconclusive",
      reason: `fewer than ${minTrialsPerCondition} trials in a condition — not enough to say anything`,
    };
  }

  const delta = apparatus.passRate - baseline.passRate;
  if (Math.abs(delta) < 0.0001) {
    return {
      baseline,
      apparatus,
      verdict: "no-difference",
      reason:
        "the apparatus did not change the pass rate. Per ADR 0015, a piece of apparatus that shows no " +
        "difference should be deleted — though with this few trials, first check whether the measurement " +
        "can see a difference at all.",
    };
  }
  return {
    baseline,
    apparatus,
    verdict: delta > 0 ? "apparatus-better" : "baseline-better",
    reason:
      delta > 0
        ? `apparatus pass rate is ${(delta * 100).toFixed(0)} points higher`
        : `baseline pass rate is ${(-delta * 100).toFixed(0)} points higher — the apparatus is costing more and teaching less`,
  };
}
