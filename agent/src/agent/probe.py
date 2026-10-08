"""``python -m agent.probe`` — the self-test ``npm run probe`` runs, in the new stack (ADR 0013).

Prints the endpoint, the models and the key's LENGTH (never the key), then fires one minimal chat
call and one embedding call. The failure this repository has been chasing — HTTP 403 on an
OpenAI-compatible endpoint — shows up here first, in one command, without the board.
"""

from __future__ import annotations

import sys

import httpx

from .config import Config, config_from_env


def body_note(response: httpx.Response, limit: int = 300) -> str:
    text = response.text.strip().replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")


def probe_chat(client: httpx.Client, config: Config) -> bool:
    try:
        response = client.post(
            config.chat_url,
            headers={"authorization": f"Bearer {config.api_key}"},
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": "回答一个字：好"}],
                "max_tokens": 8,
            },
        )
    except httpx.RequestError as error:
        print(f"chat      unreachable: {error}")
        return False

    if response.status_code != 200:
        print(f"chat      HTTP {response.status_code} at {config.chat_url}: {body_note(response)}")
        return False

    try:
        content = response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError):
        print(f"chat      HTTP 200 but not a completion: {body_note(response)}")
        return False
    print(f"chat      ok — the model answered ({len(content)} chars)")
    return True


def probe_embeddings(client: httpx.Client, config: Config) -> bool:
    try:
        response = client.post(
            config.embeddings_url,
            headers={"authorization": f"Bearer {config.api_key}"},
            json={"model": config.embed_model, "input": "好"},
        )
    except httpx.RequestError as error:
        print(f"embed     unreachable: {error}")
        return False

    if response.status_code != 200:
        note = f"HTTP {response.status_code} at {config.embeddings_url}: {body_note(response)}"
        if response.status_code == 404:
            note += " — this endpoint has no embeddings route; the RAG stage needs one (or its local fallback)"
        print(f"embed     {note}")
        return False

    try:
        vector = response.json()["data"][0]["embedding"]
    except (KeyError, IndexError, ValueError):
        print(f"embed     HTTP 200 but not an embedding: {body_note(response)}")
        return False
    print(f"embed     ok — {len(vector)} dimensions")
    return True


def main() -> int:
    config = config_from_env()
    if config is None:
        print("ATP_API_KEY / ATP_MODEL are not set in this process — nothing to probe.")
        print("Set them (Windows: setx, then a NEW terminal) and try again.")
        return 1

    print(f"endpoint  {config.base_url}")
    print(f"chat      {config.model}")
    print(f"embed     {config.embed_model}")
    print(f"key       {len(config.api_key)} chars (the key itself is never printed)")

    ok = True
    with httpx.Client(timeout=30) as client:
        ok = probe_chat(client, config) and ok
        ok = probe_embeddings(client, config) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
