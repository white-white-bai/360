"""The nodes: the teacher, the tools, and the verifier — three actors, not one.

ADR 0004's rule is the reason the verifier is a node of its own: no actor verifies its own
output. The teacher may call tools and answer; whether the answer is SUPPORTED is another
actor's question, and the teacher hears that verdict as feedback it must address once.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..model import Model, ProviderError
from ..tools import Toolbox, tool_schemas
from .state import AgentState

# --------------------------------------------------------------------------------- the teacher --

_CHAT_SYSTEM = """You are the teacher in a one-on-one classroom, and you have no fixed material.

# How you teach
- Teach from what you know, and say plainly when you are unsure instead of guessing.
- One knowledge point per reply; a few sentences, the length of a spoken turn.
- End most replies by asking the learner to say the point back in their own words.
- If their answer shows a wrong idea, correct it without belittling the person holding it.
- Delivery language: zh."""

_GROUNDED_SYSTEM = """You are the teacher in a one-on-one classroom, working from a signed corpus.

# The rule that outranks every other
You answer FROM THE CORPUS, never from memory. Before you say anything about the subject, call
`search_corpus`; build the answer on the passages it returns, and cite the passage ids in your
text like [P-gap-and-overlap]. If the passages do not answer the question, say plainly that the
corpus does not cover it — that is a complete answer, not a failure, and it is always better than
a confident sentence with nothing behind it.

# How you teach
- One knowledge point per reply; a few sentences, the length of a spoken turn.
- End most replies by asking the learner to say the point back in their own words.
- Delivery language: zh.

# Tools
Use `search_corpus` for anything about the subject. Use `list_catalogue` when the learner asks
what can be taught here, and `read_domain` when they ask about a course itself."""

_REVISION = """主讲人：你的上一条回答里，下面这些断言没有可追溯的出处。

{reasons}

可用的段落 id（必须照抄，不要改写、不要凭记忆拼）：{ids}

请重写回答：只保留有出处的内容，并标注段落 id；没有出处的部分要么删掉，要么明说语料没有覆盖。
直接输出重写后的回答本身——不要提及这次修订，学习者是第一次看到它。"""

_CITATION = re.compile(r"\[([A-Za-z0-9][A-Za-z0-9\-_.]*)\]")


def unknown_citations(answer: str, hits: list[dict[str, Any]]) -> list[str]:
    """Cited passage ids that are not among the retrieved ones.

    A citation the corpus cannot back is the failure this whole mode exists to prevent — and the
    live eval showed the model is happy to invent a plausible id (`P-tool-annotations-untrusted`
    for `P-mcp-untrusted-annotations`). The prompt cannot enforce an id; the kernel can check
    one. This is the same move as the builder's quote proof (ADR 0010), at speech time.
    """
    known = {str(hit.get("id", "")) for hit in hits}
    return sorted({name for name in _CITATION.findall(answer) if name not in known})


def make_lead_node(model: Model, toolbox: Toolbox, *, max_steps: int):
    """The teacher: search if it must, answer if it can, stop when the bound says stop."""

    def lead(state: AgentState) -> AgentState:
        grounded = state.get("mode") == "grounded"
        messages = list(state.get("messages", []))
        if not messages:
            messages = [
                {"role": "system", "content": _GROUNDED_SYSTEM if grounded else _CHAT_SYSTEM},
                {"role": "user", "content": state.get("question", "")},
            ]

        steps = int(state.get("steps", 0))
        tools = tool_schemas() if grounded and steps < max_steps else None
        reply = model.call(messages, actor="lead-explainer", tools=tools)

        assistant: dict[str, Any] = {"role": "assistant", "content": reply.text}
        if reply.tool_calls:
            assistant["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": json.dumps(call.arguments, ensure_ascii=False)},
                }
                for call in reply.tool_calls
            ]
        messages.append(assistant)

        next_state: AgentState = {"messages": messages, "steps": steps + 1}
        if not reply.tool_calls:
            next_state["answer"] = reply.text
        return next_state

    return lead


# ------------------------------------------------------------------------------------ the tools --


def make_tools_node(toolbox: Toolbox):
    """Runs what the teacher asked for; a search result is also kept for the verifier."""

    def run_tools(state: AgentState) -> AgentState:
        messages = list(state.get("messages", []))
        assistant = messages[-1] if messages else {}
        hits = list(state.get("hits", []))

        for call in assistant.get("tool_calls", []):
            name = call.get("function", {}).get("name", "")
            try:
                arguments = json.loads(call.get("function", {}).get("arguments") or "{}")
            except json.JSONDecodeError:
                arguments = {}
            result = toolbox.run(name, arguments if isinstance(arguments, dict) else {})
            if name == "search_corpus":
                try:
                    hits.extend(json.loads(result).get("hits", []))
                except json.JSONDecodeError:
                    pass
            messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})

        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for hit in hits:
            key = f"{hit.get('domain')}·{hit.get('id')}"
            if key not in seen:
                seen.add(key)
                unique.append(hit)
        return {"messages": messages, "hits": unique}

    return run_tools


# --------------------------------------------------------------------------------- the verifier --

_VERIFIER_SYSTEM = """You are the verifier — a different actor from the teacher. You are given a
question, the teacher's answer, and the passages the teacher retrieved. For every statement in
the answer that claims something about the world, decide whether the passages support it.

Rules:
- Supported means a passage STATES it. A passage that merely mentions the topic does not support
  a claim about it.
- Teaching moves — questions to the learner, framings, promises — are not claims. Skip them.
- A claim that is true but absent from the passages is NOT supported. You verify provenance, not
  truth.
- Pruning an unsupported claim is a good outcome; inventing support is not.

Answer with one JSON object, nothing else:
{"claims": [{"claim": "...", "supported": true|false, "passage": "<passage id>"|null, "reason": "..."}]}"""


def make_verify_node(model: Model):
    """A second actor judges the answer; one revision is allowed, and the verdict stands after."""

    def verify(state: AgentState) -> AgentState:
        answer = state.get("answer", "").strip()
        hits = state.get("hits", [])
        if answer == "":
            return {"verified": None, "verify_note": "the teacher produced no answer to verify"}

        # The kernel's check comes first: every cited id must be one of the retrieved ones. A
        # fabricated id is a fabricated source, there is nothing left for the verifier to judge,
        # and paying for that call would be paying to ask a model about an id that does not exist.
        invented = unknown_citations(answer, hits)
        if invented:
            verdicts: list[dict[str, Any]] = [
                {
                    "claim": f"引用了检索结果里不存在的段落 id：{name}",
                    "supported": False,
                    "passage": name,
                    "reason": "引用必须照抄检索结果里的 id——凭记忆拼出来的 id 与伪造出处没有区别",
                }
                for name in invented
            ]
        else:
            passages = "\n\n".join(
                f"[{hit.get('id')}]\n{hit.get('text', '')}" for hit in hits
            ) or "(none — the teacher retrieved nothing)"
            prompt = (
                f"# The question\n{state.get('question', '')}\n\n"
                f"# The teacher's answer\n{answer}\n\n"
                f"# The retrieved passages\n{passages}"
            )
            reply = model.call(
                [{"role": "system", "content": _VERIFIER_SYSTEM}, {"role": "user", "content": prompt}],
                actor="verifier",
                temperature=0,
            )

            text = reply.text.strip()
            if text.startswith("```"):
                text = text.strip("`")
                if text.startswith("json"):
                    text = text[4:]
            try:
                verdicts = json.loads(text).get("claims", [])
            except (json.JSONDecodeError, AttributeError):
                return {
                    "verified": None,
                    "verdicts": [],
                    "verify_note": f"the verifier's reply could not be parsed: {reply.text[:200]}",
                }

        unsupported = [item for item in verdicts if isinstance(item, dict) and not item.get("supported")]
        next_state: AgentState = {
            "verdicts": verdicts,
            "verified": len(unsupported) == 0,
            # Cleared every time and set only when a revision is actually being requested: a flag
            # that survives the revision would send the graph around a second time — the bug a
            # 6th scripted call caught.
            "revision_requested": False,
        }

        # One revision, and only one: a teacher that keeps failing the verifier is a teacher
        # whose material needs a person, not a third attempt.
        if unsupported and not state.get("revised"):
            reasons = "\n".join(
                f"- {item.get('claim', '(unnamed claim)')} — {item.get('reason', 'no reason given')}"
                for item in unsupported
            )
            ids = ", ".join(sorted({str(hit.get("id", "")) for hit in hits})) or "（这次没有检索到任何段落）"
            messages = list(state.get("messages", []))
            messages.append({"role": "user", "content": _REVISION.format(reasons=reasons, ids=ids)})
            next_state["messages"] = messages
            next_state["revised"] = True
            next_state["revision_requested"] = True
        return next_state

    return verify


# ------------------------------------------------------------------------------- the challenger --

_CHALLENGER_SYSTEM = """你是质疑者——一个位置，不是第二个主讲（ADR 0003 的职责）。你会拿到：学习者的问题、主讲的回答、以及这门教材「误解目录」里点名的常见错误。

只做一个判断：
- 如果学习者的问题（或其中隐含的理解）落在这本误解目录里的某一条上（或它的近邻）：先把那个错误理解按学习者持有的样子说出来，再用两三句话驳倒它。只用给定的语料段落，并标注段落 id。
- 如果没有：只输出 NONE。

不要问候，不要解释你在做什么，不要重复主讲的讲法。最多三句话。"""

_NONE = {"", "none", "无", "没有"}


def make_challenge_node(model: Model, toolbox: Toolbox):
    """ADR 0003's position inside the graph: name a wrong intuition, refute it, else stay out."""

    def challenge(state: AgentState) -> AgentState:
        hits = state.get("hits", [])
        if not hits:
            # No corpus behind this answer means no misconception catalogue to check against —
            # and a challenger with no target is a second explainer, which ADR 0003 refused.
            return {"challenge": ""}

        domains = sorted({str(hit.get("domain", "")) for hit in hits if hit.get("domain")})
        material: list[str] = []
        for domain in domains:
            payload = json.loads(toolbox.read_domain(domain))
            misconceptions = payload.get("misconceptions")
            if misconceptions:
                material.append(f"# {domain} 的误解目录\n{misconceptions}")
        if not material:
            return {"challenge": ""}

        passages = "\n\n".join(f"[{hit.get('id')}]\n{hit.get('text', '')}" for hit in hits)
        prompt = (
            f"# 学习者的问题\n{state.get('question', '')}\n\n"
            f"# 主讲的回答\n{state.get('answer', '')}\n\n"
            f"# 语料段落\n{passages}\n\n" + "\n\n".join(material)
        )
        reply = model.call(
            [{"role": "system", "content": _CHALLENGER_SYSTEM}, {"role": "user", "content": prompt}],
            actor="challenger",
            temperature=0.3,
        )
        text = reply.text.strip()
        return {"challenge": "" if text.lower() in _NONE or text.upper().startswith("NONE") else text}

    return challenge


# ----------------------------------------------------------------------------------- routing ----


def route_after_lead(state: AgentState, *, max_steps: int) -> str:
    messages = state.get("messages", [])
    assistant = messages[-1] if messages else {}
    wants_tools = bool(assistant.get("tool_calls"))
    if wants_tools and int(state.get("steps", 0)) < max_steps:
        return "tools"
    if state.get("mode") == "grounded" and state.get("answer", "").strip() != "":
        return "verify"
    return "end"


def route_after_verify(state: AgentState) -> str:
    """The revision pass runs when the verifier JUST asked for one; a second refusal is final."""
    if state.get("verified") is False and state.get("revision_requested") is True:
        return "lead"
    if state.get("mode") == "grounded" and state.get("answer", "").strip() != "":
        return "challenge"
    return "end"


__all__ = [
    "make_challenge_node",
    "make_lead_node",
    "make_tools_node",
    "make_verify_node",
    "route_after_lead",
    "route_after_verify",
]
