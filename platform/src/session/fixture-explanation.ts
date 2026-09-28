/**
 * A recorded Lead Explainer response.
 *
 * This is a FIXTURE, not teaching content anyone should trust: it exists so the
 * Phase 1 pipeline can be exercised offline and deterministically. It is written
 * to satisfy the output contract in `baseline.ts`, and — more usefully — to be
 * wrong in the places a real model would be wrong, so the parser and the
 * renderer are tested against realistic shapes rather than a tidy minimum.
 *
 * It deliberately includes things a lax parser would let through:
 *   - narration and events interleaved, which is the point of the format
 *   - a `point` and a `highlight`, which change focus without adding content
 *   - no `at` fields anywhere, because the timeline is assigned, not claimed
 */
export const EXPLAINER_FIXTURE = JSON.stringify({
  steps: [
    { say: "先说结论：时区不是偏移量。" },
    { event: { kind: "text", id: "t1", body: "时区 ≠ 偏移量" } },
    { say: "偏移量是某一瞬间算出来的结果；时区是算它的那套规则。" },
    { event: { kind: "text", id: "t2", body: "时区 = 一套规则" } },
    { event: { kind: "shape", id: "s1", shape: "arrow", from: "t1", to: "t2" } },
    { say: "夏令时切换正好把这件事露出来。春季前跳，本地时间会缺掉一段——缺口。" },
    { event: { kind: "text", id: "t3", body: "前跳 → 缺口：某些本地时间不存在" } },
    { event: { kind: "highlight", target: "t3" } },
    { say: "秋季回拨反过来：同一段本地时间会出现两次——重叠。这时只有偏移量能区分先后。" },
    { event: { kind: "text", id: "t4", body: "回拨 → 重叠：某些本地时间出现两次" } },
    { event: { kind: "point", target: "t4" } },
    { say: "所以一个 RFC 3339 字符串携带的是偏移量，不是时区标识——它不告诉你是哪套规则产生的。" },
  ],
});
