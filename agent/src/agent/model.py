"""The model side of the graph: one interface, a live implementation, and a scripted one.

Deliberately NOT langchain-openai. The call carries two things that are ours and that a general
client would drop: the ZDR header (zero retention, or fail — ADR 0002's material) and the ledger
(per-actor cost). A graph framework is a fine dependency; the boundary where the learner's words
leave the machine is not a place to inherit someone else's defaults.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence

import httpx

from .config import Config
from .ledger import PRICES, Ledger
from .telemetry import span


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ModelReply:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)


class Model(Protocol):
    """What a node may assume about its brain. Scripted in tests, live in production."""

    name: str
    ledger: Ledger

    def call(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        actor: str,
        tools: Sequence[dict[str, Any]] | None = None,
        temperature: float = 0.2,
    ) -> ModelReply: ...


class ProviderError(RuntimeError):
    """The provider could not be reached or refused the request; the caller surfaces this."""


class ProviderModel:
    """The live model: the OpenAI-compatible chat route this project already speaks."""

    def __init__(self, config: Config, ledger: Ledger | None = None, *, timeout: float = 120.0) -> None:
        self.name = config.model
        self.config = config
        self.ledger = ledger if ledger is not None else Ledger()
        self.timeout = timeout
        if config.price_in is not None and config.price_out is not None:
            # The same contract the TypeScript provider keeps: a price the operator wrote turns
            # the ledger's tokens into money; without one, the row stays honestly unpriced.
            PRICES[config.model] = (config.price_in, config.price_out)

    def call(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        actor: str,
        tools: Sequence[dict[str, Any]] | None = None,
        temperature: float = 0.2,
    ) -> ModelReply:
        body: dict[str, Any] = {
            "model": self.config.model,
            "messages": list(messages),
            "temperature": temperature,
        }
        if tools:
            body["tools"] = list(tools)

        try:
            with span("model.call", actor=actor, model=self.config.model):
                response = httpx.post(
                    self.config.chat_url,
                    headers={**self.config.auth_headers(), "content-type": "application/json"},
                    json=body,
                    timeout=self.timeout,
                )
        except httpx.RequestError as error:
            raise ProviderError(f"provider unreachable: {error}") from error

        if response.status_code != 200:
            raise ProviderError(
                f"provider returned HTTP {response.status_code} at {self.config.chat_url}: {response.text[:300]}"
            )

        try:
            payload = response.json()
            message = payload["choices"][0]["message"]
        except (KeyError, IndexError, ValueError) as error:
            raise ProviderError(f"provider reply was not a completion: {response.text[:300]}") from error

        usage = payload.get("usage") or {}
        self.ledger.record(
            actor,
            self.config.model,
            int(usage.get("prompt_tokens") or 0),
            int(usage.get("completion_tokens") or 0),
        )

        calls: list[ToolCall] = []
        for call in message.get("tool_calls") or []:
            arguments = call.get("function", {}).get("arguments") or "{}"
            try:
                parsed = json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
            except (json.JSONDecodeError, TypeError):
                parsed = {}
            calls.append(
                ToolCall(id=str(call.get("id", "")), name=str(call.get("function", {}).get("name", "")), arguments=parsed)
            )

        return ModelReply(text=str(message.get("content") or ""), tool_calls=calls)


class ScriptedModel:
    """A recorded model, so the graph — routing, bounds, verification — is testable offline.

    Running past the script is an error, exactly like the TypeScript platform's ScriptedProvider:
    a fixture that repeats itself lets a runaway loop look like a passing test.
    """

    def __init__(self, replies: Sequence[ModelReply], ledger: Ledger | None = None) -> None:
        self.name = "scripted"
        self.ledger = ledger if ledger is not None else Ledger()
        self._replies = list(replies)
        self._used = 0
        self.seen: list[dict[str, Any]] = []

    def call(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        actor: str,
        tools: Sequence[dict[str, Any]] | None = None,
        temperature: float = 0.2,
    ) -> ModelReply:
        self.seen.append({"actor": actor, "messages": list(messages), "tools": list(tools or [])})
        if self._used >= len(self._replies):
            raise AssertionError(
                f"the scripted model was called {self._used + 1} times but has {len(self._replies)} replies"
            )
        reply = self._replies[self._used]
        self._used += 1
        self.ledger.record(actor, "scripted", 10, 10)
        return reply
