"""TERM-018 / G-21: the wire <-> dashboard taxonomy handshake, fired THROUGH ITS ROUTE.

`POST /api/push` is the only door to `_check_taxonomy_handshake`. These tests mount the
same `push.router` object `api/main.py` includes (the TERM-018 rail proves that mount
statically, `route` wire kind) and POST to it with the push secret, so the request goes
through FastAPI's dispatch to the real handler. Only the handler's side effects are
redirected: the stored taxonomy version, the persisted wire file, the archive, the
earnings kick and the theme recompute.

The guard decides: a push whose `taxonomy_version` differs from the seeded one raises ONE
`warning` (never a page: a stale deploy on either side is a mismatch to fix, not an
outage), and never blocks the push. The same version, no version, or a rejected secret
raise nothing.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.push as push
from api.services import chart_health_alerts

SECRET = "term018-push-secret"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(push, "PERSISTENT_WIRE_DATA_FILE", str(tmp_path / "wire_data.json"))
    monkeypatch.setattr(push, "_taxonomy_version_stored", lambda: "4.22.0")
    from api.routers import earnings
    from api.services import theme_performance, wire_archive
    monkeypatch.setattr(earnings, "on_wire_push", lambda *a, **k: None)
    monkeypatch.setattr(wire_archive, "record", lambda *a, **k: None)
    monkeypatch.setattr(theme_performance, "trigger_recompute", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(push.router)
    return TestClient(app)


@pytest.fixture
def alerts(monkeypatch):
    seen: list[tuple[str, str]] = []

    def emit(key, severity, message=None, metadata=None, **kw):
        seen.append((key, severity))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", emit)
    return seen


def _push(client, payload, secret=SECRET):
    return client.post("/api/push", json=payload, headers={"Authorization": f"Bearer {secret}"})


def test_a_push_on_a_different_taxonomy_raises_one_warning_and_still_lands(client, alerts):
    r = _push(client, {"date": "2026-10-09", "taxonomy_version": "4.16.0"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert alerts == [("taxonomy_version_mismatch", "warning")]


def test_CONTROL_the_same_taxonomy_raises_nothing(client, alerts):
    assert _push(client, {"date": "2026-10-09", "taxonomy_version": "4.22.0"}).status_code == 200
    assert alerts == []


def test_CONTROL_a_push_carrying_no_version_raises_nothing(client, alerts):
    assert _push(client, {"date": "2026-10-09"}).status_code == 200
    assert alerts == []


def test_CONTROL_a_rejected_secret_never_reaches_the_handshake(client, alerts):
    assert _push(client, {"taxonomy_version": "4.16.0"}, secret="wrong").status_code == 401
    assert alerts == []
