"""/r/buzz data endpoint: token gate and payload shape."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "secret-token")
    from api.services import buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    from api.main import app
    return TestClient(app), buzz_store


def test_requires_the_render_token(client):
    c, _ = client
    assert c.get("/api/r/buzz").status_code in (401, 403)
    assert c.get("/api/r/buzz", params={"token": "wrong"}).status_code in (401, 403)


def test_returns_rows_and_coverage(client):
    c, store = client
    import time
    ts = int(time.time()) - 60
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(4)])
    r = c.get("/api/r/buzz", params={"token": "secret-token", "window": "today"})
    assert r.status_code == 200
    body = r.json()
    assert body["rows"][0]["ticker"] == "NVDA"
    assert body["rows"][0]["people"] == 4
    assert isinstance(body["rows"][0]["spark"], list)
    assert "coverage" in body and "label" in body


def test_empty_store_returns_an_empty_list_not_an_error(client):
    c, _ = client
    r = c.get("/api/r/buzz", params={"token": "secret-token"})
    assert r.status_code == 200 and r.json()["rows"] == []
