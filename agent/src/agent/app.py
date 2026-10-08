"""The full-stack service (stage 0): a FastAPI skeleton with an honest /health.

Stage 0 is deliberately thin. The point is that the new stack runs, is tested, and is
containerized BEFORE it claims any capability; /chat arrives with the agent graph in stage 2.
/health says what this process can actually see — whether a provider is configured (described,
never leaked) and how many Domains are on disk — because "the service is up" and "the service
can teach" are different claims, and only the first one is true today.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from .config import config_from_env

# Repo layout: agent/src/agent/app.py -> parents[3] is the repository root.
DEFAULT_DOMAINS_DIR = Path(__file__).resolve().parents[3] / "domains"


def domains_dir() -> Path:
    """Where the knowledge assets live — the one thing the two stacks share (ADR 0013).

    The environment override exists for the container, where the repository root is not on the
    path and the assets arrive as a mounted volume.
    """
    override = os.environ.get("ATP_DOMAINS_DIR", "").strip()
    return Path(override) if override != "" else DEFAULT_DOMAINS_DIR


def domain_count(directory: Path) -> int:
    if not directory.is_dir():
        return 0
    return sum(1 for entry in directory.iterdir() if (entry / "meta.md").is_file())


def create_app(domains: Path | None = None) -> FastAPI:
    app = FastAPI(title="ATP agent service", version="0.0.0")

    @app.get("/health")
    def health() -> dict:
        config = config_from_env()
        directory = domains if domains is not None else domains_dir()
        return {
            "status": "ok",
            "stage": "0",
            "provider": config.describe() if config is not None else None,
            "domainsDir": str(directory),
            "domains": domain_count(directory),
        }

    return app


app = create_app()
