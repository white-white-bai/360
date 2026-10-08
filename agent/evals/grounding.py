"""The grounded agent, scored — the seed of ADR 0001's acceptance measurement.

Runs a small question set through the REAL graph — provider, retrieval, verifier, challenger —
and reports what the experiment will eventually measure at scale: how often the first answer
survives the verifier, what the revision did, whether a question the corpus cannot answer
produces honesty instead of a confident sentence, and what each answered question cost.

This spends real money; it is not a pytest. `python evals/grounding.py`.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent.bootstrap import NoProvider, checkpointer, live_stack  # noqa: E402
from agent.console import utf8_console  # noqa: E402
from agent.graph.graph import build_graph, fresh_turn  # noqa: E402

# (question, kind). "unanswerable" is a real test too: the corpus does not cover the invention
# history of daylight saving time, so a confident sentence would be the failure being measured.
CASES: list[tuple[str, str]] = [
    ("时区为什么会出现缺口", "answerable"),
    ("偏移量是怎么算出来的，正负号是什么意思", "answerable"),
    ("MCP 的工具描述可以直接信任吗", "answerable"),
    ("夏令时最早是哪个国家发明的", "unanswerable"),
]


def main() -> int:
    utf8_console()
    try:
        _, ledger, model, toolbox = live_stack()
    except NoProvider as error:
        print(str(error))
        return 1

    agent = build_graph(model, toolbox, max_steps=4, checkpointer=checkpointer("evals.sqlite"))
    stamp = int(time.time())

    rows: list[dict] = []
    for index, (question, kind) in enumerate(CASES):
        started = time.time()
        final = agent.invoke(
            fresh_turn(question, "grounded"),
            {"configurable": {"thread_id": f"eval-{index}-{stamp}"}},
        )
        elapsed = time.time() - started
        verdicts = final.get("verdicts", [])
        rows.append(
            {
                "question": question,
                "kind": kind,
                "verified": final.get("verified"),
                "revised": bool(final.get("revised")),
                "claims": len(verdicts),
                "unsupported": len([item for item in verdicts if not item.get("supported")]),
                "hits": len(final.get("hits", [])),
                "challenge": bool(final.get("challenge")),
                "seconds": round(elapsed, 1),
                "answer": final.get("answer", "").strip(),
                "note": final.get("verify_note", ""),
            }
        )

    print("\n== grounded eval ==")
    for row in rows:
        state = "✓" if row["verified"] else ("✗" if row["verified"] is False else "—")
        process = ""
        if row["verified"] and row["revised"]:
            process = "（首考被打回，重写后通过）"
        elif row["verified"] is False:
            process = "（重写后仍未通过）"
        print(f"\n[{row['kind']}] {state}{process}  {row['question']}")
        print(
            f"   断言 {row['claims']} 条（未支持 {row['unsupported']}）· 语料 {row['hits']} 段 · "
            f"质疑者{'上场' if row['challenge'] else '未上场'} · {row['seconds']}s"
        )
        print(f"   回答：{row['answer'][:240]}{'…' if len(row['answer']) > 240 else ''}")
        if row["note"]:
            print(f"   备注：{row['note']}")

    total = ledger.total()
    answerable = [row for row in rows if row["kind"] == "answerable"]
    passed = [row for row in answerable if row["verified"]]
    first_pass = [row for row in answerable if row["verified"] and not row["revised"]]
    print("\n== 数字 ==")
    print(f"可回答题通过：{len(passed)}/{len(answerable)}（其中首考通过 {len(first_pass)}）")
    print(
        f"调用 {total.calls} 次 · {total.input_tokens}+{total.output_tokens} tok · "
        f"${total.cost_usd:.4f}{'' if total.priced else '（价表未知）'}"
    )
    for row in ledger.rows():
        print(f"   {row.actor:14} {row.calls} 次  {row.input_tokens}+{row.output_tokens} tok")

    return 1 if [row for row in rows if row["verified"] is False] else 0


if __name__ == "__main__":
    sys.exit(main())
