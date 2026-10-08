"""Configuration — the same names the TypeScript platform already uses.

One environment, two stacks (ADR 0013): ``ATP_API_KEY`` / ``ATP_MODEL`` / ``ATP_BASE_URL`` mean
exactly what they mean under ``platform/``, and ``ATP_EMBED_MODEL`` names the embedding model the
RAG stage will need. Nothing here ever puts the key itself into a message: it is read once, kept,
and reported only as a length.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, MutableMapping

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_EMBED_MODEL = "text-embedding-3-small"

_FLAG_ON = {"1", "true", "yes", "on"}


def repo_env_path() -> Path:
    """The repository root's .env — the same file the TypeScript stack reads (ADR 0013)."""
    return Path(__file__).resolve().parents[3] / ".env"


def load_local_env(path: Path | None = None, target: MutableMapping[str, str] | None = None) -> None:
    """Fill in what the target does not already have. The process environment wins, always.

    The file is gitignored, and the key's value is never printed — this only moves it into an
    environment the process already keeps private. Why a file at all: `setx` only reaches
    terminals opened afterwards, and a person who sets a key and then reads "not set"
    reasonably concludes the machine is broken.
    """
    file = path if path is not None else repo_env_path()
    environ = target if target is not None else os.environ
    if not file.is_file():
        return
    for raw in file.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line == "" or line.startswith("#"):
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) is None or value == "":
            continue
        if not environ.get(name):
            environ[name] = value


def env_flag(env: Mapping[str, str], name: str) -> bool:
    """A switch. `1`/`true`/`yes`/`on` — any case — mean on; anything else means off.

    Unlike a number, a flag has a meaningful default, so a typo is not worth failing the
    process over; and unlike the TypeScript side, this returns a plain bool.
    """
    return (env.get(name) or "").strip().lower() in _FLAG_ON


@dataclass(frozen=True)
class Config:
    api_key: str
    model: str
    base_url: str
    embed_model: str
    zdr: bool

    @property
    def chat_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    @property
    def embeddings_url(self) -> str:
        return f"{self.base_url}/embeddings"

    def describe(self) -> str:
        """What is safe to print: the endpoint, the models, and the key's LENGTH."""
        return f"{self.model} at {self.base_url} · key {len(self.api_key)} chars"

    def auth_headers(self) -> dict[str, str]:
        """The headers every request shares; the ZDR opt-in rides along when it is on."""
        headers = {"authorization": f"Bearer {self.api_key}"}
        if self.zdr:
            headers["x-cmd-zdr"] = "1"
        return headers


def config_from_env(env: Mapping[str, str] | None = None) -> Config | None:
    """The provider this process can reach, or None.

    Both a key AND a model are required, exactly as the terminal instructions have said all
    along — a key with no model is a machine that does not know what it would run.
    """
    if env is None:
        # The repo's local .env first, so a key that lives there is found before anything asks.
        load_local_env()
        source: Mapping[str, str] = os.environ
    else:
        source = env
    api_key = (source.get("ATP_API_KEY") or source.get("OPENAI_API_KEY") or "").strip()
    model = (source.get("ATP_MODEL") or "").strip()
    if api_key == "" or model == "":
        return None
    base_url = (source.get("ATP_BASE_URL") or "").strip().rstrip("/") or DEFAULT_BASE_URL
    embed_model = (source.get("ATP_EMBED_MODEL") or "").strip() or DEFAULT_EMBED_MODEL
    return Config(
        api_key=api_key,
        model=model,
        base_url=base_url,
        embed_model=embed_model,
        zdr=env_flag(source, "ATP_ZDR"),
    )
