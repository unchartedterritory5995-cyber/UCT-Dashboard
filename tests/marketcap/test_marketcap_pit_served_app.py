"""The Market Cap V1 member routes THROUGH THE REAL PRODUCTION APP (api.main.app: its middleware stack, its auth
surface, its mounting) -- not a test app. Lifespan/startup does not run under a plain TestClient, so no scheduler
starts. Only the session lookup is substituted; require_bars_access and meets_plan_gate run for real."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api.bars_auth as BA
from api.services.marketcap import publication as P, pit_serving as S

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation

BID = "MCAP_V1-20261002T050000Z"
USERS = {"tok-free": {"id": 1, "role": "user", "plan": "free"}, "tok-pro": {"id": 3, "role": "user", "plan": "pro"}}


@pytest.fixture
def served(tmp_path, monkeypatch):
    root = str(tmp_path / "bucket")
    t = P.LocalTarget(root)
    prices = make_prices(str(tmp_path / "prices.db"))
    db = make_build(str(tmp_path / "b.db"), BID, last_day=20261001)
    r = P.publish_build(t, build_db=db, prices_db=prices, manifest_fields=manifest_fields(BID, P.file_sha(db)[0]),
                        validation=passing_validation())
    P.advance(t, BID, r["manifest_sha256"], expect_current=None, by="test", reason="served-app test", acceptance="HUMAN_CUTOVER")
    monkeypatch.setenv("MCAP_PIT_SOURCE", "local")
    monkeypatch.setenv("MCAP_PIT_LOCAL_ROOT", root)
    monkeypatch.delenv("MCAP_PIT_PIN", raising=False)
    monkeypatch.setenv("PUSH_SECRET", "svc-secret-for-test")
    S.clear_cache()
    monkeypatch.setattr(BA, "validate_session",
                        lambda tok: ({k: v for k, v in USERS[tok].items() if k != "plan"} if tok in USERS else None))
    monkeypatch.setattr(BA, "get_user_plan", lambda uid: next(u["plan"] for u in USERS.values() if u["id"] == uid))
    from api.main import app
    yield TestClient(app)
    S.clear_cache()


def test_routes_are_mounted_in_the_production_app():
    from api.main import app
    paths = {getattr(r, "path", None) for r in app.routes}
    assert {"/api/marketcap/pit/{ticker}", "/api/marketcap/pit/{ticker}/latest", "/api/marketcap/pit-status"} <= paths


def test_dark_by_default_in_the_production_app(served, monkeypatch):
    monkeypatch.delenv("MCAP_PIT_ENABLED", raising=False)
    assert served.get("/api/marketcap/pit/GOOGL", headers={"Authorization": "Bearer svc-secret-for-test"}).status_code == 404


def test_entitlement_matrix_in_the_production_app(served, monkeypatch):
    monkeypatch.setenv("MCAP_PIT_ENABLED", "1")
    c = served
    assert c.get("/api/marketcap/pit/GOOGL").status_code == 401
    assert c.get("/api/marketcap/pit/NOSUCH").status_code == 401
    c.cookies.set("uct_session", "tok-free")
    r_free = c.get("/api/marketcap/pit/GOOGL")
    assert r_free.status_code == 403 and c.get("/api/marketcap/pit/NOSUCH").json() == r_free.json()
    c.cookies.set("uct_session", "tok-pro")
    r = c.get("/api/marketcap/pit/GOOGL")
    assert r.status_code == 200 and r.json()["build_id"] == BID and r.headers["x-mcap-build"] == BID
    assert r.headers["cache-control"] == "private, no-cache"
    c.cookies.clear()
    assert c.get("/api/marketcap/pit/GOOGL/latest", headers={"Authorization": "Bearer svc-secret-for-test"}).status_code == 200
    assert c.get("/api/marketcap/pit-status", headers={"Authorization": "Bearer nope"}).status_code == 401
