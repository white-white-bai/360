"""What this learner's own record says — the knowledge system's Memory, over a record that
already exists.

The TypeScript platform has been writing `platform/.sessions/<id>.json` the whole time: which
Domain taught, what the learner asked (and which questions were REFUSED — evidence about the
boundary), and the retention and transfer measurements taken later. The agent stack had no way to
open it, and ADR 0013's "shared assets" stop being shared the moment one side cannot read them.

Read-only, deliberately: nothing here writes a session record, because a conversation is not a
measurement — the retention numbers mean what they mean because the measurement flow owns them.
Privacy is not a new question either: the learner's words already went to the model in the
session that produced the record (ADR 0002's lifecycle). What is new is that they can come back,
which is the entire point of memory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SessionBrief:
    session_id: str
    started_at: str | None
    domain: str | None
    questions: list[dict] = field(default_factory=list)
    follow_ups: list[dict] = field(default_factory=list)
    answers: int = 0


def _as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def parse_session(text: str) -> SessionBrief | None:
    """One record, or None when it is not one. A file that will not parse is skipped, not fatal."""
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("sessionId"), str):
        return None

    questions = [
        {
            "text": str(item.get("text", "")),
            "outcome": str(item.get("outcome", "")),
        }
        for item in raw.get("questions", [])
        if isinstance(item, dict) and str(item.get("text", "")).strip() != ""
    ]
    follow_ups = [
        {
            "kind": str(item.get("kind", "")),
            "checkId": str(item.get("checkId", "")),
            "verdict": str(item.get("verdict", "")),
            "elapsedHours": item.get("elapsedHours"),
        }
        for item in raw.get("followUps", [])
        if isinstance(item, dict)
    ]
    answers = raw.get("answers", [])

    return SessionBrief(
        session_id=raw["sessionId"],
        started_at=str(raw["startedAt"]) if isinstance(raw.get("startedAt"), str) else None,
        domain=str(raw["domainId"]) if isinstance(raw.get("domainId"), str) else None,
        questions=questions,
        follow_ups=follow_ups,
        answers=len(answers) if isinstance(answers, list) else 0,
    )


def load_briefs(sessions_dir: Path | None, limit: int = 3) -> list[SessionBrief]:
    """The most recent records, newest first (by startedAt, falling back to file time)."""
    if sessions_dir is None or not sessions_dir.is_dir():
        return []
    briefs: list[tuple[float, SessionBrief]] = []
    for path in sessions_dir.glob("*.json"):
        brief = parse_session(path.read_text(encoding="utf-8", errors="replace"))
        if brief is None:
            continue
        try:
            stamp = path.stat().st_mtime
        except OSError:
            stamp = 0.0
        briefs.append((stamp, brief))
    # startedAt is the record's own claim; mtime is the filesystem's. Sort on the claim when it
    # exists, and keep mtime as the tiebreaker — a clock that disagrees with the record is the
    # record's business, not this module's.
    briefs.sort(key=lambda pair: (pair[1].started_at or "", pair[0]), reverse=True)
    return [brief for _, brief in briefs[:limit]]


def learner_brief(sessions_dir: Path | None, limit: int = 3) -> str:
    """The tool-shaped answer: JSON a model can read, never more than it needs."""
    briefs = load_briefs(sessions_dir, limit)
    if not briefs:
        return json.dumps(
            {"sessions": [], "note": "没有找到这位学习者的已保存课堂记录——就当作你们的第一次。"},
            ensure_ascii=False,
        )
    return json.dumps(
        {
            "sessions": [
                {
                    "sessionId": brief.session_id,
                    "startedAt": brief.started_at,
                    "domain": brief.domain,
                    "questionsAsked": brief.questions,
                    "answersGiven": brief.answers,
                    "followUps": brief.follow_ups,
                }
                for brief in briefs
            ],
            "note": "这是这位学习者自己保存的课堂记录；questions 里 outcome=refused 的是当时语料没有覆盖的问题。",
        },
        ensure_ascii=False,
    )
