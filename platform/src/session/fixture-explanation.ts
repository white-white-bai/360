/**
 * A recorded Lead Explainer response.
 *
 * This is a FIXTURE, not teaching content anyone should trust: it exists so the
 * pipeline can be exercised offline and deterministically. It is written to
 * satisfy the output contract in `baseline.ts` and, more usefully, to be awkward
 * in the places a real model would be awkward.
 *
 * It deliberately exercises every primitive in the vocabulary:
 *   - `axis` twice, including one with fractional marks, because an offset axis
 *     that only has whole hours is the most common wrong mental model
 *   - `band` twice on the same axis, which is how a gap and an overlap are told
 *     apart, plus `emphasis` so the renderer has something to act on
 *   - `table`, the layout-heaviest primitive, to check it survives replay
 *   - `rich`, the escape hatch, which had never been exercised before Phase 2
 *   - narration and events interleaved throughout, which is the point of the format
 *   - no `at` fields anywhere, because the timeline is assigned, not claimed
 */
export const EXPLAINER_FIXTURE = JSON.stringify({
  steps: [
    { say: "先说结论：时区不是偏移量。这两件事被混为一谈，后面全错。" },
    { event: { kind: "text", id: "t1", body: "时区 ≠ 偏移量" } },
    { say: "偏移量是某一瞬间算出来的结果；时区是算它的那套规则。同一套规则，不同瞬间可以给出不同偏移量。" },
    { event: { kind: "text", id: "t2", body: "时区 = 一套规则" } },
    { event: { kind: "shape", id: "s1", shape: "arrow", from: "t1", to: "t2" } },

    { say: "先看偏移量本身。它不是只有整点——现实里有半小时，甚至 45 分钟的偏移量。" },
    {
      event: {
        kind: "axis",
        id: "ax-offset",
        label: "UTC 偏移量（小时）",
        from: -12,
        to: 14,
        marks: [
          { value: -5, label: "-05:00" },
          { value: 0, label: "UTC" },
          { value: 5.5, label: "+05:30" },
          { value: 5.75, label: "+05:45" },
          { value: 8, label: "+08:00" },
        ],
      },
    },

    { say: "夏令时切换正好把「规则」这件事露出来。看纽约 2026-03-08 这一天。" },
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
    { event: { kind: "highlight", target: "b-gap" } },
    { say: "秋季回拨则相反：同一段本地时间出现两次。注意它和缺口是两个不同的区间。" },
    {
      event: {
        kind: "band",
        id: "b-overlap",
        axis: "ax-day",
        from: 1,
        to: 2,
        label: "重叠：01:00–02:00 这段本地时间出现两次",
        emphasis: "attention",
      },
    },

    { say: "把两者摆在一起看差别：" },
    {
      event: {
        kind: "table",
        id: "tbl-diff",
        columns: ["", "缺口", "重叠"],
        rows: [
          ["怎么来的", "春季前跳", "秋季回拨"],
          ["本地时间", "不存在", "出现两次"],
          ["靠什么区分", "无需区分", "只有偏移量能区分先后"],
        ],
      },
    },

    { say: "所以一个 RFC 3339 字符串携带的是偏移量，不是时区标识——它不告诉你是哪套规则产生的。" },
    {
      event: {
        kind: "rich",
        id: "rich-tz",
        format: "mermaid",
        body: "timeline\n    title 2026-03-08 纽约\n    01:59 : 正常\n    03:00 : 前跳之后",
        declared: true,
      },
    },
    { event: { kind: "point", target: "t2" } },
  ],
});
