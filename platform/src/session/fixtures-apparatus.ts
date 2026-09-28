/**
 * Recorded responses for the apparatus, so the whole loop can be exercised
 * offline and deterministically.
 *
 * These are FIXTURES, not teaching content anyone should trust. They exist to be
 * awkward in the places a model would be awkward: the list mixes grounded claims
 * with a scaffold, the narration places probes it did not write, and the
 * challenge is a refutation rather than a second lesson.
 */

/** The claims. Every citation must be a real passage of the time-zones corpus. */
export const APPARATUS_LIST = JSON.stringify({
  assertions: [
    {
      id: "A1",
      kind: "grounded",
      statement: "时区是一套规则，不是一个固定偏移量",
      sources: ["P-zone-is-a-set-of-rules"],
    },
    {
      id: "A2",
      kind: "grounded",
      statement: "夏令时切换会让某些本地墙上时间不存在，或出现两次",
      sources: ["P-gap-and-overlap"],
    },
    {
      id: "A3",
      kind: "grounded",
      statement: "RFC 3339 字符串携带的是偏移量，不是时区标识",
      sources: ["P-rfc3339-carries-offset-not-zone"],
    },
    {
      id: "A4",
      kind: "scaffold",
      statement: "把它想成两座钟：一座走规则，一座读结果",
      sources: [],
    },
  ],
});

export const APPARATUS_VERDICTS_OK = JSON.stringify({
  verdicts: [
    { id: "A1", ok: true, reason: "" },
    { id: "A2", ok: true, reason: "" },
    { id: "A3", ok: true, reason: "" },
    { id: "A4", ok: true, reason: "scaffold, nothing to support" },
  ],
});

/** One claim that the cited passage does not actually support. */
export const APPARATUS_VERDICTS_UNSUPPORTED = JSON.stringify({
  verdicts: [
    { id: "A1", ok: true, reason: "" },
    { id: "A2", ok: true, reason: "" },
    {
      id: "A3",
      ok: false,
      reason: "the grammar shows an offset is carried, but nothing there says a timestamp cannot also be read as a zone",
    },
    { id: "A4", ok: true, reason: "scaffold" },
  ],
});

export const APPARATUS_PROBES = JSON.stringify({
  probes: [
    { id: "Q1", afterAssertion: "A1", prompt: "用你自己的话说说：时区和偏移量的区别是什么？" },
    { id: "Q2", afterAssertion: "A2", prompt: "如果本地时间 02:30 根本不存在，你会怎么跟别人解释？" },
  ],
});

export const APPARATUS_NARRATION = JSON.stringify({
  steps: [
    { say: "先说结论：时区是一套规则。" },
    { event: { kind: "text", id: "t1", body: "时区 = 一套规则" } },
    { probe: "Q1" },
    { say: "规则决定每一瞬间用哪个偏移量，所以它比偏移量更根本。" },
    { event: { kind: "text", id: "t2", body: "规则 → 偏移量" } },
    { event: { kind: "shape", id: "s1", shape: "arrow", from: "t1", to: "t2" } },
    { say: "夏令时切换把这件事露出来：有些本地时间不存在，有些出现两次。" },
    {
      event: {
        kind: "axis",
        id: "ax-day",
        label: "纽约本地时间 2026-03-08（时）",
        from: 0,
        to: 6,
        marks: [{ value: 1 }, { value: 2 }, { value: 3 }],
      },
    },
    {
      event: {
        kind: "band",
        id: "b-gap",
        axis: "ax-day",
        from: 2,
        to: 3,
        label: "缺口：02:00–03:00 这段本地时间不存在",
        emphasis: "attention",
      },
    },
    { probe: "Q2" },
    { say: "最后：字符串携带的是偏移量，不是时区标识。" },
    { event: { kind: "text", id: "t3", body: "字符串 → 偏移量，不是时区" } },
  ],
});

export const APPARATUS_CHALLENGE = JSON.stringify({
  steps: [
    { say: "打住一下。你刚才的说法里有一个错误的想法。" },
    { event: { kind: "text", id: "c1", body: "✗ 夏令时只是把偏移量改一下" } },
    { say: "夏令时不是「改一个数字」，它会让一段本地时间根本不存在，或者出现两次。" },
    { event: { kind: "text", id: "c2", body: "✓ 缺口：不存在；重叠：两次" } },
    { event: { kind: "highlight", target: "c2" } },
  ],
});

export const APPARATUS_RETRY = JSON.stringify({
  steps: [
    { say: "换个说法。把本地时间想成一张时刻表，而时区是印这张表的规则。" },
    { event: { kind: "table", id: "tb", columns: ["", "缺口", "重叠"], rows: [["本地时间", "不存在", "出现两次"]] } },
    { say: "换表不改规则；规则一改，表上的某些格子就空了，或者被填了两次。" },
  ],
});

export const PROBE_NO_CONCERN = JSON.stringify({
  concern: false,
  reason: "用自己的话说对了",
  misconceptionId: null,
});

export const PROBE_CONCERN_MISCONCEPTION = JSON.stringify({
  concern: true,
  reason: "把夏令时说成「统一挪一小时」，没有提到缺口与重叠",
  misconceptionId: "M-dst-is-just-a-shift",
});

/** A script where everything passes: no probe raises a concern and the check passes. */
export function cleanScript(): Record<string, string | string[]> {
  return {
    "lead-explainer": [APPARATUS_LIST, APPARATUS_NARRATION, APPARATUS_RETRY],
    "grounding-verifier": APPARATUS_VERDICTS_OK,
    "probe-author": APPARATUS_PROBES,
    "probe-evaluator": [PROBE_NO_CONCERN, PROBE_NO_CONCERN],
    challenger: APPARATUS_CHALLENGE,
  };
}

/** The same lesson, but the first probe exposes a catalogued misconception. */
export function misconceptionScript(): Record<string, string | string[]> {
  return {
    ...cleanScript(),
    "probe-evaluator": [PROBE_CONCERN_MISCONCEPTION, PROBE_NO_CONCERN],
  };
}
