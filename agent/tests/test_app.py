from pathlib import Path

from fastapi.testclient import TestClient

from agent.app import create_app


def test_health_says_what_it_can_see(tmp_path: Path) -> None:
    domains = tmp_path / "domains"
    (domains / "time-zones").mkdir(parents=True)
    (domains / "time-zones" / "meta.md").write_text("id: time-zones\n", encoding="utf-8")
    (domains / "not-a-domain").mkdir()

    client = TestClient(create_app(domains=domains))
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["stage"] == "0"
    assert body["domains"] == 1, "only directories with a meta.md are Domains"
    assert body["domainsDir"] == str(domains)


def test_health_reports_the_provider_without_leaking_the_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ATP_API_KEY", "top-secret-key")
    monkeypatch.setenv("ATP_MODEL", "m-one")
    client = TestClient(create_app(domains=tmp_path))
    body = client.get("/health").json()
    assert body["provider"] is not None
    assert "top-secret-key" not in body["provider"]
    assert "m-one" in body["provider"]
