"""Phase One Track C — `delivery_configured` on `POST /api/indicator-alerts`.

⛔ UNIT-LEVEL, DELIBERATELY. The real admission chain (`ias.create` ->
`alert_user_series`/`indicator_alert_evaluator`) has its own substantial,
already-tested precondition surface (`test_indicator_alert_service.py`,
`test_indicator_alert_evaluator.py`) that this file has no need to
re-satisfy. What is new here is a single conditional: fire
`delivery_configured` iff the alert names a USER-AUTHORED address AND the
admission chain actually accepted it. Stubbing the chain's two collaborators
isolates exactly that branch.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import indicator_alerts as router_mod
from api.services import alert_user_series, auth_db, indicator_alert_service as ias


@pytest.fixture
def telemetry_db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    return tmp_path


@pytest.fixture
def app(telemetry_db):
    a = FastAPI()
    a.include_router(router_mod.router)
    a.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    return a


def _rows(event: str, user_id: str = "u1") -> list[dict]:
    conn = auth_db.get_connection()
    try:
        return [
            json.loads(r[0]) if r[0] else {}
            for r in conn.execute(
                "SELECT props FROM landing_events WHERE visitor_id = ? AND event = ?"
                " ORDER BY id", (user_id, event))
        ]
    finally:
        conn.close()


def _body(indicator="rsi", sym="NVDA", condition=">", threshold=70.0, tf="1D"):
    return {"sym": sym, "indicator": indicator, "condition": condition,
            "threshold": threshold, "tf": tf}


def test_delivery_configured_fires_for_a_user_authored_address(app, monkeypatch):
    monkeypatch.setattr(router_mod.ias, "refusal_for", lambda *a, **k: None)
    monkeypatch.setattr(router_mod.ias, "create", lambda **k: 42)
    monkeypatch.setattr(router_mod.alert_user_series, "is_user_address", lambda addr: True)
    c = TestClient(app)
    resp = c.post("/api/indicator-alerts", json=_body(indicator="u_abc123.value"))
    assert resp.status_code == 200, resp.text
    rows = _rows("delivery_configured")
    assert len(rows) == 1
    assert rows[0]["surface"] == "alert"
    assert rows[0]["indicator"] == "u_abc123.value"
    assert rows[0]["sym"] == "NVDA"


def test_delivery_configured_does_NOT_fire_for_a_native_indicator(app, monkeypatch):
    """A native `rsi`/`macd` alert is not part of the imported-definition
    journey `delivery_configured` traces."""
    monkeypatch.setattr(router_mod.ias, "refusal_for", lambda *a, **k: None)
    monkeypatch.setattr(router_mod.ias, "create", lambda **k: 43)
    monkeypatch.setattr(router_mod.alert_user_series, "is_user_address", lambda addr: False)
    monkeypatch.setattr(router_mod.indicator_alert_evaluator, "value_function", lambda addr: object())
    c = TestClient(app)
    resp = c.post("/api/indicator-alerts", json=_body(indicator="rsi"))
    assert resp.status_code == 200, resp.text
    assert _rows("delivery_configured") == []


def test_delivery_configured_does_NOT_fire_on_a_refused_admission(app, monkeypatch):
    """The admission chain refuses (e.g. a repaint/budget gate) — nothing was
    actually armed, so nothing was delivered."""
    monkeypatch.setattr(router_mod.alert_user_series, "is_user_address", lambda addr: True)

    def _boom(**k):
        raise alert_user_series.AdmissionRefused("repaint", "refused")
    monkeypatch.setattr(router_mod.ias, "refusal_for", lambda *a, **k: None)
    monkeypatch.setattr(router_mod.ias, "create", _boom)
    c = TestClient(app)
    resp = c.post("/api/indicator-alerts", json=_body(indicator="u_abc123.value"))
    assert resp.status_code == 400
    assert _rows("delivery_configured") == []
