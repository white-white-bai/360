import json
from pathlib import Path

from agent.memory import learner_brief, load_briefs
from agent.tools import Toolbox

from test_mcp_server import StubRetriever


def write_session(directory: Path, session_id: str, **overrides) -> None:
    payload = {
        "sessionId": session_id,
        "startedAt": overrides.get("startedAt", "2026-10-01T10:00:00.000Z"),
        "domainId": overrides.get("domainId", "time-zones"),
        "narration": [],
        "events": [],
        "answers": overrides.get("answers", [{"at": 0, "probeId": "probe-1", "text": "…"}]),
        "questions": overrides.get("questions", []),
        "followUps": overrides.get("followUps", []),
    }
    (directory / f"{session_id}.json").write_text(json.dumps(payload), encoding="utf-8")


def test_a_record_is_read_for_what_memory_needs(tmp_path: Path) -> None:
    write_session(
        tmp_path,
        "a",
        questions=[
            {"at": 1, "text": "为什么会有缺口", "outcome": "answered"},
            {"at": 2, "text": "夏令时是谁发明的", "outcome": "refused"},
        ],
        followUps=[
            {"at": 3, "kind": "retention", "checkId": "C-gap", "answer": "…", "verdict": "pass", "elapsedHours": 22}
        ],
    )
    brief = load_briefs(tmp_path)[0]
    assert brief.session_id == "a"
    assert brief.domain == "time-zones"
    assert brief.questions[1]["outcome"] == "refused", "a refusal is evidence about the boundary"
    assert brief.follow_ups[0]["verdict"] == "pass"
    assert brief.answers == 1


def test_records_are_newest_first_and_broken_files_are_skipped(tmp_path: Path) -> None:
    write_session(tmp_path, "old", startedAt="2026-09-01T00:00:00.000Z")
    write_session(tmp_path, "new", startedAt="2026-10-07T00:00:00.000Z")
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    (tmp_path / "not-a-record.json").write_text('{"hello": 1}', encoding="utf-8")

    assert [brief.session_id for brief in load_briefs(tmp_path)] == ["new", "old"]


def test_no_records_is_said_rather_than_guessed(tmp_path: Path) -> None:
    payload = json.loads(learner_brief(tmp_path / "missing"))
    assert payload["sessions"] == []
    assert "第一次" in payload["note"]
    assert json.loads(learner_brief(None))["sessions"] == []


def test_the_tool_answers_with_the_learners_own_record(tmp_path: Path) -> None:
    write_session(tmp_path, "a")
    toolbox = Toolbox(retriever=StubRetriever(), domains_dir=Path("unused"), sessions_dir=tmp_path)
    payload = json.loads(toolbox.run("recall_learner", {}))
    assert payload["sessions"][0]["sessionId"] == "a"
    assert "questionsAsked" in payload["sessions"][0]
