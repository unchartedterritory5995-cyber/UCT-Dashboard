"""Lane S alert routes: every one is DARK (404) by default, and armed it works
end to end (FT-034 rating-change, FT-035 remind/read-state, AC-7 ops monitor)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import predicates, rating_change, remind, ops_monitor

FLAGS = (rating_change.FLAG, remind.FLAG, ops_monitor.FLAG)
DARK = [
    ("post", "/api/alerts/taxonomy/rating-change", {"ticker": "NVDA"}),
    ("get", "/api/alerts/taxonomy/rating-change", None),
    ("delete", "/api/alerts/taxonomy/rating-change/x", None),
    ("post", "/api/admin/alerts/taxonomy/run-rating-change-sweep", None),
    ("put", "/api/alerts/taxonomy/predicates/x/remind", {"minutes": 30}),
    ("post", "/api/alerts/taxonomy/fires/1/read", {"channel": "push"}),
    ("get", "/api/alerts/taxonomy/fires/1/read-state", None),
    ("get", "/api/admin/alerts/ops-monitor", None),
]


@pytest.fixture
def client(tmp_path, monkeypatch):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user, require_admin
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setattr(predicates, "resolve_entity_scope",
                        lambda t, **k: {"kind": "entity", "id": t.upper(), "asOf": None,
                                        "entity_status": "unresolved", "symbol": t.upper()})
    for f in FLAGS:
        monkeypatch.delenv(f, raising=False)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "admin"}
    app.dependency_overrides[require_admin] = lambda: {"id": "u1", "role": "admin"}
    try:
        yield TestClient(app), monkeypatch
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("method,path,body", DARK)
def test_every_lane_s_alert_route_404s_while_dark(client, method, path, body):
    c, _ = client
    kw = {"json": body} if body is not None else {}
    assert getattr(c, method)(path, **kw).status_code == 404


def test_armed_rating_change_round_trip_and_ops_monitor(client):
    c, mp = client
    for f in FLAGS:
        mp.setenv(f, "1")
    mp.setattr(rating_change, "_default_fetch", lambda t: {"items": [
        {"date": "2026-09-01", "company": "UBS", "action": "maintain",
         "from_grade": "Buy", "to_grade": "Buy"}]})
    r = c.post("/api/alerts/taxonomy/rating-change", json={"ticker": "nvda"})
    assert r.status_code == 200, r.text
    pid = r.json()["predicate_id"]
    assert pid in [p["id"] for p in c.get("/api/alerts/taxonomy/rating-change").json()["predicates"]]
    assert c.post("/api/admin/alerts/taxonomy/run-rating-change-sweep").json()["checked"] == 1
    assert c.put(f"/api/alerts/taxonomy/predicates/{pid}/remind", json={"minutes": 30}).status_code == 200
    assert c.put(f"/api/alerts/taxonomy/predicates/{pid}/remind", json={"minutes": 1}).status_code == 400
    mon = c.get("/api/admin/alerts/ops-monitor").json()
    assert mon["trigger_types"]["rating-change"]["runs"] == 1
    assert {ch["kind"] for ch in mon["channels"]} >= {"in_app", "email", "discord"}
    assert mon["queue"]["total"] > 0
    assert c.delete(f"/api/alerts/taxonomy/rating-change/{pid}").json()["suspended"] is True
    assert predicates.get_predicate(pid) is not None
