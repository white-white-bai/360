import type { AssertionList } from "../assertions/types.ts";
import type { UnderstandingCheck } from "../checks/types.ts";
import type { Expert } from "../experts/types.ts";
import type { ModelProvider } from "../providers/types.ts";
import type { ApparatusFeature } from "../session/apparatus.ts";
import { ALL_FEATURES, runApparatusSession } from "../session/apparatus.ts";
import type { FollowUp } from "../session/measure.ts";
import { MEANINGFUL_RETENTION_HOURS, measureFollowUp } from "../session/measure.ts";
import { ModelReplyUnusable, ReplyBudget } from "../session/retry.ts";

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
  /**
   * The shared stimulus, taught by both conditions.
   *
   * Omit it only for the FIRST trial of a live run, whose job is to generate one;
   * capture it from `TrialResult.list` and inject it into every trial after that.
   * Both conditions teaching the same claims is what makes the comparison mean
   * anything.
   */
  list?: AssertionList;
  probeAnswers: readonly string[];
  terminalAnswer: string;
  /**
   * The learner's answer at the second sitting, when a failed check is retaken.
   *
   * Without it a condition that corrects a learner still records them as failed,
   * and the experiment would measure first attempts rather than teaching — which is
   * the same mistake the session itself had.
   */
  retryAnswer?: string;
  /**
   * The asset for the second sitting, when it should differ from the first.
   *
   * Supply one. Without it the retake re-asks the question the learner has just been
   * shown the answer to, and a higher pass rate says more about the question than
   * about the teaching.
   */
  retakeCheck?: UnderstandingCheck;
  /**
   * The asset for the TRANSFER measurement (ADR 0001) — a situation the explanation
   * never used.
   *
   * Retention re-uses the terminal check, because "did it stick" is the same
   * question. Transfer must not: a question the learner was just taught the answer to
   * measures recall, and recall is not transfer.
   */
  transferCheck?: UnderstandingCheck;
  /** The follow-up sitting. Omitted means it never happens. */
  followUp?: {
    /**
     * Hours between teaching and the follow-up.
     *
     * Simulated in an experiment that runs in one process — which is exactly why every
     * measurement records its own elapsed time. A retention number must be able to
     * show what it was measured over.
     */
    afterHours: number;
    retentionAnswer?: string;
    transferAnswer?: string;
  };
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
   * True when the claims were injected rather than generated. It is false only on a
   * live run's first trial, whose job is to produce the stimulus every later trial
   * is given: two conditions that generated their own lists could differ for a
   * reason that has nothing to do with the apparatus.
   */
  listInjected: boolean;
  /** The claims that were taught, when the trial got far enough to have any. */
  list: AssertionList | undefined;
  /**
   * False when the trial could not be run at all — an unusable reply, twice.
   *
   * Not a failure. Counting it as one turns the model's typing into a statement about the
   * learner, and counting it as a pass would be worse. It is excluded from the pass rate and
   * reported on its own, which is what makes a design that completes fewer trials visibly
   * worse rather than merely noisier.
   *
   * `calls` and `costUsd` are zero for these, and that is a GAP rather than a measurement:
   * the session threw before reporting its ledger, so the calls the failed attempt really
   * spent are not in this number.
   */
  completed: boolean;
  /** Why it could not be run, when it could not be. */
  incompleteReason: string | null;
  /** Extra calls spent on replies that could not be used. */
  retries: number;
  passed: boolean;
  /** True when a failed check was retaken, so the result can be read in context. */
  retaken: boolean;
  /**
   * The asset that decided the result, when it was a retake.
   *
   * Recorded so a pass after remediation can never be confused with a pass on the
   * first question — they are different claims about the learner.
   */
  retakeCheckId: string | null;
  diagnosis: string | null;
  probeConcerns: number;
  challengeFired: boolean;
  calls: number;
  costUsd: number;
  /**
   * True when the cost came from the placeholder price table rather than a real price.
   *
   * Carried alongside the number so a report can mark it. A cost figure that is wrong is
   * worse than no cost figure, because it is the one number in the output that looks like
   * it was measured.
   */
  costIsPlaceholder: boolean;
  selfAssessment: number | null;
  /** self-assessment minus the measured result. Positive means they felt better than they did. */
  illusionGap: number | null;
  /**
   * ADR 0001's two secondary measures, or null when the follow-up never happened.
   *
   * They matter more than they look: a pass rate measured minutes after teaching is a
   * statement about the lesson, and these are statements about the learner.
   */
  retention: FollowUpResult | null;
  transfer: FollowUpResult | null;
}

export interface FollowUpResult {
  passed: boolean;
  elapsedHours: number;
  /** False when too little time passed for the name to be honest. */
  meaningful: boolean;
}

function asFollowUpResult(followUp: FollowUp): FollowUpResult {
  return {
    passed: followUp.record.verdict === "pass",
    elapsedHours: followUp.record.elapsedHours,
    meaningful: followUp.meaningful,
  };
}

export async function runTrial(
  condition: Condition,
  provider: ModelProvider,
  input: TrialInput,
): Promise<TrialResult> {
  // (a)+(c), the owner's decision taken on ADR 0001's behalf: retry once, count every retry,
  // and report a trial that still fails as INCOMPLETE. A live model slips — three live runs
  // each died on a different slip — and one slip used to destroy everything measured so far.
  const budget = new ReplyBudget();
  try {
    return await runCompletedTrial(condition, provider, input, budget);
  } catch (error) {
    // Only an unusable REPLY makes a trial incomplete. A transport failure, a bug in the
    // kernel or a violated invariant still aborts the run, because turning those into
    // "incomplete" would hide a real fault behind a category that looks like bad luck.
    if (!(error instanceof ModelReplyUnusable)) throw error;
    return {
      condition,
      disabled: CONDITION_ABLATIONS[condition],
      listInjected: input.list !== undefined,
      list: input.list,
      completed: false,
      incompleteReason: error.message,
      retries: budget.retries,
      passed: false,
      retaken: false,
      retakeCheckId: null,
      diagnosis: null,
      probeConcerns: 0,
      challengeFired: false,
      calls: 0,
      costUsd: 0,
      costIsPlaceholder: false,
      selfAssessment: input.selfAssessment ?? null,
      illusionGap: null,
      retention: null,
      transfer: null,
    };
  }
}

async function runCompletedTrial(
  condition: Condition,
  provider: ModelProvider,
  input: TrialInput,
  budget: ReplyBudget,
): Promise<TrialResult> {
  const result = await runApparatusSession(provider, {
    retryBudget: budget,
    expert: input.expert,
    check: input.check,
    probeAnswers: input.probeAnswers,
    terminalAnswer: input.terminalAnswer,
    retryAnswer: input.retryAnswer,
    retakeCheck: input.retakeCheck,
    list: input.list,
    disable: CONDITION_ABLATIONS[condition],
    sessionId: `trial-${condition}`,
  });

  // The SECOND sitting decides, because passing is the session's end condition.
  const final = result.verdictAfterRetry ?? result.verdict;
  const passed = final?.verdict === "pass";
  // ADR 0001's secondary measures, taken on the same learner afterwards.
  let retention: FollowUpResult | null = null;
  let transfer: FollowUpResult | null = null;
  if (input.followUp !== undefined) {
    const startedAt = result.log.startedAt === null ? Number.NaN : Date.parse(result.log.startedAt);
    if (Number.isNaN(startedAt)) {
      throw new Error("the session log has no usable start time, so it cannot be followed up");
    }
    // The clock is MOVED rather than waited on. An experiment that spent a day per
    // trial would not be run at all, and every measurement records the elapsed time it
    // was taken over, so a simulated one is visible in the result rather than implied.
    const now = new Date(startedAt + input.followUp.afterHours * 3_600_000);

    // An absent answer means they did not come back, which is NOT the same as coming
    // back and getting it wrong. Scoring silence as failure would make the rates
    // measure attendance.
    if (input.followUp.retentionAnswer !== undefined) {
      retention = asFollowUpResult(
        measureFollowUp(result.log, input.check, "retention", input.followUp.retentionAnswer, now),
      );
    }
    if (input.transferCheck !== undefined && input.followUp.transferAnswer !== undefined) {
      transfer = asFollowUpResult(
        measureFollowUp(result.log, input.transferCheck, "transfer", input.followUp.transferAnswer, now),
      );
    }
  }

  const selfAssessment = input.selfAssessment ?? null;
  return {
    condition,
    disabled: result.disabled,
    listInjected: result.listInjected,
    list: result.list,
    passed,
    retaken: result.verdictAfterRetry !== null,
    retakeCheckId: result.verdictAfterRetry === null ? null : (input.retakeCheck ?? input.check).id,
    diagnosis: final?.diagnosis?.misconceptionId ?? null,
    probeConcerns: result.outcomes.filter((outcome) => outcome.concern).length,
    challengeFired: result.challenge.fired,
    completed: true,
    incompleteReason: null,
    retries: result.retries,
    calls: result.usage.calls,
    costUsd: result.usage.costUsd,
    costIsPlaceholder: !result.usage.priced,
    selfAssessment,
    illusionGap: selfAssessment === null ? null : selfAssessment - (passed ? 1 : 0),
    retention,
    transfer,
  };
}

export interface ConditionSummary {
  condition: Condition;
  disabled: readonly ApparatusFeature[];
  trials: number;
  /**
   * Trials that could not be run: an unusable reply, twice.
   *
   * Its own number, and its own column in the report. A condition with more of these is a
   * worse condition — it is more exposed to the model slipping — and folding them into the
   * pass rate would hide exactly that.
   */
  incomplete: number;
  /** Trials that ran, and are therefore the denominator of `passRate`. */
  completed: number;
  passed: number;
  passRate: number;
  /** Extra calls spent on unusable replies, summed over the condition. */
  retries: number;
  meanCalls: number;
  meanCostUsd: number;
  probeConcerns: number;
  challenges: number;
  /** Mean of the per-trial illusion gaps, or null when nobody reported one. */
  meanIllusionGap: number | null;
  /**
   * ADR 0001's two secondary measures.
   *
   * Rates over the trials that actually had a follow-up, not over all trials — a
   * condition where nobody came back should say "no data", not "0%".
   */
  retentionRate: number | null;
  transferRate: number | null;
  /** Mean elapsed hours the follow-ups were measured over, or null when there were none. */
  meanFollowUpHours: number | null;
  /** True when any follow-up was taken too soon for its name to be honest. */
  followUpTooSoon: boolean;
}

export function summarise(condition: Condition, trials: readonly TrialResult[]): ConditionSummary {
  const mine = trials.filter((trial) => trial.condition === condition);
  // Everything below is measured over the trials that RAN. An incomplete trial has no
  // measurement in it — its zeroes are gaps, not observations — so averaging them in would
  // make a condition look cheaper and worse-measured than the thing it was asked to do.
  const ran = mine.filter((trial) => trial.completed);
  const gaps = ran.map((trial) => trial.illusionGap).filter((gap): gap is number => gap !== null);
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  const rateOf = (pick: (trial: TrialResult) => FollowUpResult | null): number | null => {
    const measured = ran.map(pick).filter((result): result is FollowUpResult => result !== null);
    if (measured.length === 0) return null;
    return measured.filter((result) => result.passed).length / measured.length;
  };

  const followUps = ran
    .flatMap((trial) => [trial.retention, trial.transfer])
    .filter((result): result is FollowUpResult => result !== null);

  return {
    condition,
    disabled: CONDITION_ABLATIONS[condition],
    trials: mine.length,
    incomplete: mine.length - ran.length,
    completed: ran.length,
    passed: ran.filter((trial) => trial.passed).length,
    passRate: ran.length === 0 ? 0 : ran.filter((trial) => trial.passed).length / ran.length,
    retries: mine.reduce((sum, trial) => sum + trial.retries, 0),
    meanCalls: mean(ran.map((trial) => trial.calls)),
    meanCostUsd: mean(ran.map((trial) => trial.costUsd)),
    probeConcerns: ran.reduce((sum, trial) => sum + trial.probeConcerns, 0),
    challenges: ran.filter((trial) => trial.challengeFired).length,
    meanIllusionGap: gaps.length === 0 ? null : mean(gaps),
    retentionRate: rateOf((trial) => trial.retention),
    transferRate: rateOf((trial) => trial.transfer),
    meanFollowUpHours: followUps.length === 0 ? null : mean(followUps.map((result) => result.elapsedHours)),
    followUpTooSoon: followUps.some((result) => !result.meaningful),
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
  /**
   * What the secondary measures say about the primary one, or null when they agree.
   *
   * Kept separate from `reason` because the two answer different questions: the
   * verdict says which condition passed more, the caveat says whether passing more
   * meant learning more.
   */
  caveat: string | null;
}

/**
 * Read ADR 0001's secondary measures against the primary one.
 *
 * The terminal check can improve while retention gets worse, and that combination
 * means the apparatus produced fluency rather than learning — the exact illusion ADR
 * 0001 chose self-assessment to detect. Reporting only the pass rate would call that a
 * win.
 */
function followUpCaveat(baseline: ConditionSummary, apparatus: ConditionSummary, delta: number): string | null {
  const notes: string[] = [];

  // First, because it qualifies everything after it: a condition some of whose trials could
  // not be run is being compared on a smaller sample than it looks, and the missing ones are
  // missing for a reason that has nothing to do with teaching.
  if (baseline.incomplete > 0 || apparatus.incomplete > 0) {
    notes.push(
      `${baseline.incomplete} baseline and ${apparatus.incomplete} apparatus trial(s) could not be run ` +
        "(an unusable reply twice). Every rate above excludes them, so the comparison rests on " +
        `${baseline.completed} against ${apparatus.completed} trials rather than ${baseline.trials} against ${apparatus.trials}`,
    );
  }

  if (baseline.followUpTooSoon || apparatus.followUpTooSoon) {
    const hours = apparatus.meanFollowUpHours ?? baseline.meanFollowUpHours ?? 0;
    notes.push(
      `the follow-ups were taken over about ${hours.toFixed(1)} hours. Below ${MEANINGFUL_RETENTION_HOURS} ` +
        'hours a "retention" measurement is the terminal check again under a different name',
    );
  }

  const regressed = (label: string, before: number | null, after: number | null): void => {
    if (before === null || after === null || after >= before - 0.0001) return;
    notes.push(
      `${label} went DOWN (${(before * 100).toFixed(0)}% to ${(after * 100).toFixed(0)}%) while the terminal ` +
        "check went up — that is fluency, not learning",
    );
  };
  regressed("retention", baseline.retentionRate, apparatus.retentionRate);
  regressed("transfer", baseline.transferRate, apparatus.transferRate);

  // The quieter and more important case: the terminal check improved and the measure
  // that matters did not move. "The apparatus helped, and a day later nobody could
  // tell" is not a win, and the pass rate alone cannot say so.
  const didNotCarry = (label: string, before: number | null, after: number | null): void => {
    if (before === null || after === null || delta <= 0 || after > before + 0.0001) return;
    notes.push(
      `${label} did not move (${(before * 100).toFixed(0)}% to ${(after * 100).toFixed(0)}%), so the ` +
        "terminal-check advantage did not carry past the session",
    );
  };
  didNotCarry("retention", baseline.retentionRate, apparatus.retentionRate);
  didNotCarry("transfer", baseline.transferRate, apparatus.transferRate);

  if (baseline.retentionRate === null && apparatus.retentionRate === null) {
    notes.push("no follow-up was taken, so nothing here says whether any of it lasted");
  }

  return notes.length === 0 ? null : notes.join("; ");
}

export function compare(trials: readonly TrialResult[], minTrialsPerCondition = 3): Comparison {
  const baseline = summarise("baseline", trials);
  const apparatus = summarise("apparatus", trials);
  const delta = apparatus.passRate - baseline.passRate;
  const caveat = followUpCaveat(baseline, apparatus, delta);

  // The count that matters is the trials that RAN. An incomplete trial measured nothing, so
  // treating it as a trial would let a run that mostly failed to execute pass for data.
  if (baseline.completed < minTrialsPerCondition || apparatus.completed < minTrialsPerCondition) {
    return {
      baseline,
      apparatus,
      caveat,
      verdict: "inconclusive",
      reason:
        `fewer than ${minTrialsPerCondition} COMPLETED trials in a condition (baseline ${baseline.completed}, ` +
        `apparatus ${apparatus.completed}) — not enough to say anything`,
    };
  }

  if (Math.abs(delta) < 0.0001) {
    return {
      baseline,
      apparatus,
      caveat,
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
    caveat,
    verdict: delta > 0 ? "apparatus-better" : "baseline-better",
    reason:
      delta > 0
        ? `apparatus pass rate is ${(delta * 100).toFixed(0)} points higher`
        : `baseline pass rate is ${(-delta * 100).toFixed(0)} points higher — the apparatus is costing more and teaching less`,
  };
}
