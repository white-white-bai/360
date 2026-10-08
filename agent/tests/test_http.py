import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from agent.app import create_app
from agent.bootstrap import NoProvider
from agent.graph.graph import build_graph
from agent.model import ModelReply, ScriptedModel, ToolCall
from agent.rag.assets import Passage
from agent.rag.store import Hit
from agent.tools import Toolbox


def hit() -> Hit:
    return Hit(
        passage=Passage(
            domain="time-zones",
            domain_name="时区",
            passage_id="P-gap-and-overlap",
            source="RFC 9557 §1.2",
            url="https://example.test/rfc9557",
            sha256=None,
            fetched_at=None,
            text="A gap exists when clocks move forward over a local time.",
        ),
        score=0.03,
        vector_rank=1,
        lexical_rank=1,
    )


class StubRetriever:
    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        return [hit()]


def stub_toolbox() -> Toolbox:
    return Toolbox(retriever=StubRetriever(), domains_dir=Path("unused"))


def grounded_script() -> ScriptedModel:
    return ScriptedModel(
        [
            ModelReply("", [ToolCall(id="call-1", name="search_corpus", arguments={"query": "缺口"})]),
            ModelReply("缺口是时钟前拨时被跳过的本地时刻。[P-gap-and-overlap]"),
            ModelReply(json.dumps({"claims": [{"claim": "缺口存在", "supported": True, "passage": "P-gap-and-overlap", "reason": "ok"}]})),
        ]
    )


def test_the_http_door_streams_the_graphs_own_events(tmp_path: Path) -> None:
    model = grounded_script()
    agent = build_graph(model, stub_toolbox(), max_steps=4)
    client = TestClient(create_app(domains=tmp_path, agent_factory=lambda: (agent, model.ledger)))

    response = client.get("/chat", params={"message": "时区为什么有缺口", "mode": "grounded", "thread": "t1"})
    assert response.status_code == 200
    body = response.text

    for event in ("event: meta", "event: tool", "event: answer", "event: verdicts", "event: done"):
        assert event in body, f"{event} must reach the page"
    done = body.split("event: done\ndata: ", 1)[1].strip()
    payload = json.loads(done)
    assert payload["verified"] is True
    assert payload["calls"] == 3
    assert "P-gap-and-overlap" in payload["answer"]


def test_chat_mode_streams_no_verdicts(tmp_path: Path) -> None:
    model = ScriptedModel([ModelReply("先讲第一点：时区是一套规则。")])
    agent = build_graph(model, stub_toolbox(), max_steps=4)
    client = TestClient(create_app(domains=tmp_path, agent_factory=lambda: (agent, model.ledger)))

    body = client.get("/chat", params={"message": "时区是什么", "mode": "chat"}).text
    assert "event: answer" in body
    assert "event: verdicts" not in body, "chat mode has nobody judging"
    assert "event: tool" not in body


def test_a_service_without_a_provider_says_so_as_503(tmp_path: Path) -> None:
    def refusing():
        raise NoProvider("没有配置 provider")

    client = TestClient(create_app(domains=tmp_path, agent_factory=refusing))
    response = client.get("/chat", params={"message": "你好"})
    assert response.status_code == 503
    assert "没有配置 provider" in response.text


def test_the_door_refuses_bad_input_before_it_spends_anything(tmp_path: Path) -> None:
    client = TestClient(create_app(domains=tmp_path, agent_factory=lambda: (None, None)))
    assert client.get("/chat", params={"message": "  "}).status_code == 400
    assert client.get("/chat", params={"message": "hi", "mode": "socratic"}).status_code == 400
    assert client.get("/search", params={"q": "  "}).status_code == 400
