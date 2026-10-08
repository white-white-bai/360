"""`python -m agent.chat "<question>"` — the agent, in a terminal (stage 2's first door).

grounded (the default) answers from the corpus, cites passage ids, and has a separate actor
check those citations; chat is ADR 0011's direct classroom — no tools, no retrieval, no verdict.
`--thread <id>` keeps the conversation in a SQLite checkpoint, so the next run continues it.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

from .app import domains_dir
from .config import config_from_env
from .console import utf8_console
from .graph.graph import build_graph, fresh_turn
from .ledger import Ledger
from .model import ProviderError, ProviderModel
from .rag.assets import load_passages
from .rag.embed import embedder_from_env
from .rag.store import Retriever
from .tools import Toolbox

# agent/.state — gitignored, and where a resumable thread actually lives.
STATE_DIR = Path(__file__).resolve().parents[2] / ".state"


def main() -> int:
    utf8_console()
    parser = argparse.ArgumentParser(description="The agent, in a terminal")
    parser.add_argument("question")
    parser.add_argument("--mode", choices=["grounded", "chat"], default="grounded")
    parser.add_argument("--thread", default="terminal", help="the session id; repeating one continues it")
    parser.add_argument("--max-steps", type=int, default=4, help="model calls a turn may spend")
    parser.add_argument("--no-rerank", action="store_true", help="keep the fused order for searches")
    args = parser.parse_args()

    config = config_from_env()
    if config is None:
        print("没有配置 provider（ATP_API_KEY / ATP_MODEL；也可写进仓库根目录的 .env）。", file=sys.stderr)
        return 1

    ledger = Ledger()
    model = ProviderModel(config, ledger)
    retriever = Retriever(load_passages(domains_dir()), embedder_from_env())
    toolbox = Toolbox(
        retriever=retriever,
        domains_dir=domains_dir(),
        rerank_config=None if args.no_rerank else config,
    )

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(STATE_DIR / "checkpoints.sqlite", check_same_thread=False)
    agent = build_graph(model, toolbox, max_steps=args.max_steps, checkpointer=SqliteSaver(connection))

    try:
        final = agent.invoke(fresh_turn(args.question, args.mode), {"configurable": {"thread_id": args.thread}})
    except ProviderError as error:
        print(f"provider 出错：{error}", file=sys.stderr)
        return 1

    print(f"\n【主讲】{final.get('answer', '').strip() or '（没有回答）'}")

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
