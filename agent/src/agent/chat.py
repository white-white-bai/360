"""`python -m agent.chat "<question>"` — the agent, in a terminal (stage 2's first door).

grounded (the default) answers from the corpus, cites passage ids, and has a separate actor
check those citations; chat is ADR 0011's direct classroom — no tools, no retrieval, no verdict.
`--thread <id>` keeps the conversation in a SQLite checkpoint, so the next run continues it.
"""

from __future__ import annotations

import argparse
import sys

from .bootstrap import NoProvider, checkpointer, live_stack
from .console import utf8_console
from .graph.graph import build_graph, fresh_turn
from .model import ProviderError
from .tools import parse_tool_names


def main() -> int:
    utf8_console()
    parser = argparse.ArgumentParser(description="The agent, in a terminal")
    parser.add_argument("question")
    parser.add_argument("--mode", choices=["chat", "grounded"], default="grounded")
    parser.add_argument("--thread", default="terminal", help="the session id; repeating one continues it")
    parser.add_argument("--max-steps", type=int, default=4, help="model calls a turn may spend")
    parser.add_argument("--no-rerank", action="store_true", help="keep the fused order for searches")
    parser.add_argument("--tools", default=None, help="逗号分隔的会话白名单，如 search_corpus,read_domain")
    args = parser.parse_args()

    try:
        allowed = parse_tool_names(args.tools) if args.tools else None
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    try:
        _, ledger, model, toolbox = live_stack(rerank=not args.no_rerank, tools=allowed)
    except NoProvider as error:
        print(str(error), file=sys.stderr)
        return 1

    agent = build_graph(
        model, toolbox, max_steps=args.max_steps, checkpointer=checkpointer()
    )

    try:
        final = agent.invoke(fresh_turn(args.question, args.mode), {"configurable": {"thread_id": args.thread}})
    except ProviderError as error:
        print(f"provider 出错：{error}", file=sys.stderr)
        return 1

    print(f"\n【主讲】{final.get('answer', '').strip() or '（没有回答）'}")

    if final.get("challenge"):
        print(f"\n【质疑者】{final['challenge']}")

    if args.mode == "grounded":
        verdicts = final.get("verdicts", [])
        state = "通过" if final.get("verified") else ("未通过" if final.get("verified") is False else "未判定")
        print(f"\n【校验】{state}（{len(verdicts)} 条断言）")
        for item in verdicts:
            mark = "✓" if item.get("supported") else "✗"
            print(f"  {mark} {item.get('claim', '')}  [{item.get('passage') or '—'}]")
            if not item.get("supported"):
                print(f"      理由：{item.get('reason', '')}")
        if final.get("verify_note"):
            print(f"  （{final['verify_note']}）")
        ids = sorted({str(hit.get("id", "")) for hit in final.get("hits", [])})
        print(f"\n【语料】{len(final.get('hits', []))} 段：{', '.join(ids) or '（没有检索到）'}")

    rows = ledger.rows()
    if rows:
        print("\n【账本】")
        for row in rows:
            marker = "" if row.priced else "（价表未知）"
            print(
                f"  {row.actor:14} {row.calls} 次  {row.input_tokens}+{row.output_tokens} tok  "
                f"${row.cost_usd:.4f}{marker}"
            )

    return 0 if args.mode == "chat" or final.get("verified") is not False else 1


if __name__ == "__main__":
    sys.exit(main())
