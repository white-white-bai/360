/**
 * Recorded responses for the ablation experiment.
 *
 * A caveat that matters more than the fixtures: because both conditions are driven
 * by recorded responses, the numbers this produces are ILLUSTRATIVE, not
 * evidential. What it demonstrates is that the harness works and that the
 * measurement is wired to the right thing. Real numbers need a real provider,
 * and until then "the apparatus helped" is not a finding.
 *
 * The two conditions get different narration, and they have to: the apparatus
 * places probes inside the narration, so its script contains `probe` steps and the
 * baseline's must not. Same claims, different realisation — which is exactly the
 * variable the experiment is about, but it does mean the two narrations are not
 * word-for-word identical.
 */

export const EXPERIMENT_LIST = JSON.stringify({
  assertions: [
    { id: "A1", kind: "grounded", statement: "时区是一套规则，不是一个固定偏移量", sources: ["P-zone-is-a-set-of-rules"] },
    { id: "A2", kind: "grounded", statement: "夏令时切换会让某些本地墙上时间不存在或出现两次", sources: ["P-gap-and-overlap"] },
  ],
});

export const EXPERIMENT_VERDICTS = JSON.stringify({
  verdicts: [
    { id: "A1", ok: true, reason: "" },
    { id: "A2", ok: true, reason: "" },
  ],
});

export const EXPERIMENT_PROBES = JSON.stringify({
  probes: [{ id: "Q1", afterAssertion: "A1", prompt: "用你自己的话说说：时区和偏移量的区别？" }],
});

/** The apparatus condition: the probe is placed inside the narration. */
export const NARRATION_WITH_PROBES = JSON.stringify({
  steps: [
    { say: "先说结论：时区是一套规则。" },
    { event: { kind: "text", id: "t1", body: "时区 = 一套规则" } },
    { probe: "Q1" },
    { say: "规则决定每一瞬间用哪个偏移量。" },
  ],
});

/** The baseline condition: the same claims, no probes to place. */
export const NARRATION_PLAIN = JSON.stringify({
  steps: [
    { say: "先说结论：时区是一套规则。" },
    { event: { kind: "text", id: "t1", body: "时区 = 一套规则" } },
    { say: "规则决定每一瞬间用哪个偏移量。" },
  ],
});

export const CHALLENGE = JSON.stringify({
  steps: [
    { say: "打住一下，这里有个错误的想法。" },
    { event: { kind: "text", id: "c1", body: "✗ 夏令时只是把偏移量改一下" } },
  ],
});

export const RETRY = JSON.stringify({
  steps: [
    { say: "换个说法：把本地时间想成一张时刻表，时区是印表的规则。" },
    { event: { kind: "text", id: "r1", body: "规则改 → 表上出现缺口或重复" } },
  ],
});

export const PROBE_OK = JSON.stringify({ concern: false, reason: "说对了", misconceptionId: null });
export const PROBE_MISCONCEPTION = JSON.stringify({
  concern: true,
  reason: "把夏令时说成统一挪一小时",
  misconceptionId: "M-dst-is-just-a-shift",
});

export interface LearnerProfile {
  name: string;
  /** The probe answer, in the order the probes were authored. */
  probeAnswers: string[];
  terminalAnswer: string;
  /** What the learner said they felt they understood, 0-1. */
  selfAssessment: number;
}

/**
 * Three learners, chosen so the conditions can actually diverge: one who gets it,
 * one who holds a catalogued misconception, and one nobody anticipated.
 */
export const PROFILES: readonly LearnerProfile[] = [
  {
    name: "gets it",
    probeAnswers: ["时区是规则，偏移量是某一瞬间的结果"],
    terminalAnswer: "这个本地时间不存在，因为前跳形成了缺口",
    selfAssessment: 0.9,
  },
  {
    name: "catalogued misconception",
    probeAnswers: ["夏令时就是把偏移量改一下"],
    terminalAnswer: "这个本地时间正常存在，只是偏移量不同",
    selfAssessment: 0.8,
  },
  {
    name: "unanticipated",
    probeAnswers: ["大概就是时间不一样吧"],
    terminalAnswer: "我猜是下午两点半左右",
    selfAssessment: 0.4,
  },
];

/** Script for one apparatus trial. */
export function apparatusTrialScript(profile: LearnerProfile): Record<string, string | string[]> {
  return {
    "lead-explainer": [NARRATION_WITH_PROBES, RETRY],
    "grounding-verifier": EXPERIMENT_VERDICTS,
    "probe-author": EXPERIMENT_PROBES,
    "probe-evaluator": [profile.probeAnswers[0]?.includes("偏移量改一下") ? PROBE_MISCONCEPTION : PROBE_OK],
    challenger: CHALLENGE,
  };
}

/** Script for one baseline trial: no verifier, no probes, no challenger. */
export function baselineTrialScript(): Record<string, string | string[]> {
  return { "lead-explainer": [NARRATION_PLAIN] };
}
