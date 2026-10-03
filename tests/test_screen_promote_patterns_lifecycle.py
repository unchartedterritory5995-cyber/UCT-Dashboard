"""FT-027 scan -> watchlist, FT-022 chart-pattern presets, FT-035 alert expiry.

Recorded fixtures: a five-row temp screener.db, the isolated auth.db the test
suite already pins, and a temp alert_taxonomy.db."""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import screen_promote as rx
from api.services.screener import saved_screens
from api.services.screener import snapshot_db as sdb

ROWS = [{"ticker": t, "price": p, "snapshot_date": "2026-10-01"}
        for t, p in [("AAA", 100.0), ("BBB", 50.0), ("CCC", 10.0), ("DDD", 5.0), ("EEE", 300.0)]]


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    sdb.init_db()
    sdb.upsert_rows([dict(r) for r in ROWS])
    import uuid
    from api.services import auth_db, auth_service
    auth_db.init_db()                 # the suite-isolated auth.db (tests/conftest.py)
    mk = lambda tag: auth_service.create_user(  # noqa: E731
        f"{tag}-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    return {"u1": mk("promo1"), "u2": mk("promo2")}


def _client(monkeypatch, *, armed=True, paid=True, uid="nobody"):
    from api.middleware.auth_middleware import get_current_user_with_plan
    if armed:
        monkeypatch.setenv(rx.FLAG, "1")
    else:
        monkeypatch.delenv(rx.FLAG, raising=False)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: paid)
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": uid, "plan": "pro"}
    return TestClient(app)


# ── FT-027 ──────────────────────────────────────────────────────────────────

def test_promote_is_dark_and_paid(snap, monkeypatch):
    assert _client(monkeypatch, armed=False).get("/api/screener/to-watchlist").status_code == 404
    assert _client(monkeypatch, paid=False).post(
        "/api/screener/to-watchlist", json={"spec": {}}).status_code == 402


def test_the_whole_result_set_becomes_a_new_list_in_screen_order(snap, monkeypatch):
    from api.services import watchlist_service
    c = _client(monkeypatch, uid=snap["u1"])
    spec = {"filters": [{"key": "price", "op": "gte", "min": 20}],
            "sort": {"key": "price", "dir": "desc"}}
    r = c.post("/api/screener/to-watchlist", json={"spec": spec, "name": "Over $20"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["created"] is True and b["added"] == 3 and b["matched"] == 3 and not b["truncated"]
    wl = watchlist_service.get_watchlist(b["watchlist_id"], snap["u1"])
    assert wl["name"] == "Over $20"
    assert [i["sym"] for i in wl["items"]] == ["EEE", "AAA", "BBB"]


def test_append_to_an_owned_list_skips_duplicates_and_refuses_someone_elses(snap, monkeypatch):
    from api.services import watchlist_service
    mine = watchlist_service.create_watchlist(snap["u1"], "Mine")
    watchlist_service.bulk_add_items(snap["u1"], mine["id"], ["AAA"])
    c = _client(monkeypatch, uid=snap["u1"])
    r = c.post("/api/screener/to-watchlist", json={"spec": {}, "watchlist_id": mine["id"]})
    assert r.json()["added"] == 4                      # five matched, AAA was already there
    other = _client(monkeypatch, uid=snap["u2"])
    assert other.post("/api/screener/to-watchlist",
                      json={"spec": {}, "watchlist_id": mine["id"]}).status_code == 404


def test_limit_truncates_and_says_so(snap, monkeypatch):
    r = _client(monkeypatch, uid=snap["u1"]).post("/api/screener/to-watchlist", json={"spec": {}, "limit": 2})
    b = r.json()
    assert b["taken"] == 2 and b["matched"] == 5 and b["truncated"] is True


def test_an_empty_screen_adds_nothing_and_says_why(snap, monkeypatch):
    r = _client(monkeypatch).post("/api/screener/to-watchlist", json={
        "spec": {"filters": [{"key": "price", "op": "gte", "min": 10_000}]}})
    assert r.status_code == 400 and "matches nothing" in r.json()["detail"]


# ── FT-022 ──────────────────────────────────────────────────────────────────

def test_pattern_presets_are_dark_by_default(monkeypatch):
    monkeypatch.delenv(saved_screens.PATTERN_PRESETS_FLAG, raising=False)
    assert not [s for s in saved_screens.starters() if s["id"].startswith("starter_pattern_")]


def test_pattern_presets_name_real_detectors(monkeypatch):
    monkeypatch.setenv(saved_screens.PATTERN_PRESETS_FLAG, "1")
    import api.routers.patterns  # noqa: F401 -- registers the detectors
    from api.services.pattern_engine.detectors.registry import list_pattern_ids
    known = set(list_pattern_ids())
    presets = [s for s in saved_screens.starters() if s["id"].startswith("starter_pattern_")]
    assert len(presets) == len(saved_screens.PATTERN_PRESETS) >= 15
    for s in presets:
        (f,) = s["spec"]["filters"]
        token = f["value"].strip(",")
        assert f["value"] == f",{token},", "an unwrapped token is a substring test"
        assert token in known, f"{s['name']} names no detector: {token}"


def test_a_pattern_preset_matches_the_exact_token_only(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "p.db"))
    sdb.init_db()
    sdb.upsert_rows([
        {"ticker": "HS", "pattern_engine_ids": ",head_shoulders,", "snapshot_date": "2026-10-01"},
        {"ticker": "IHS", "pattern_engine_ids": ",inverse_head_shoulders,", "snapshot_date": "2026-10-01"},
    ])
    from api.services.screener import query
    spec = dict(next(s for s in saved_screens.pattern_starters()
                     if s["id"] == "starter_pattern_head_shoulders")["spec"])
    spec.pop("sort")
    assert [r["ticker"] for r in query.run_scan(spec)["rows"]] == ["HS"]


# ── FT-035 ──────────────────────────────────────────────────────────────────

@pytest.fixture
def alerts_db(tmp_path, monkeypatch):
    from api.services.alert_taxonomy import db as adb
    monkeypatch.setattr(adb, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    c = adb.init_db()
    now = time.time()
    c.execute("INSERT INTO alert_trigger_registry VALUES ('document-arrival','{}','m',?)", (now,))
    for pid, uid in [("p1", "u1"), ("p2", "u2")]:
        c.execute("INSERT INTO alert_predicates (id, type_id, user_id, entity_scope, params,"
                  " created_at, updated_at) VALUES (?, 'document-arrival', ?, '{\"id\":\"AAPL\"}', '{}', ?, ?)",
                  (pid, uid, now, now))
    c.commit()
    c.close()
    return adb


def _pred(adb, pid):
    c = adb.connect()
    try:
        return dict(c.execute("SELECT * FROM alert_predicates WHERE id = ?", (pid,)).fetchone())
    finally:
        c.close()


def test_expiry_suspends_never_deletes(alerts_db, monkeypatch):
    from api.services.alert_taxonomy import lifecycle
    monkeypatch.setenv(lifecycle.FLAG, "1")
    t = time.time()
    assert lifecycle.set_expiry("u1", "p1", t + 60, now=t)["expires_at"] == t + 60
    assert lifecycle.expire_due(now=t + 30) == 0
    assert lifecycle.expire_due(now=t + 61) == 1
    row = _pred(alerts_db, "p1")
    assert row["suspended_at"] == t + 61 and row["params"] == "{}"     # kept, suspended
    assert _pred(alerts_db, "p2")["suspended_at"] is None


def test_expiry_is_owner_scoped_and_must_be_future(alerts_db):
    from api.services.alert_taxonomy import lifecycle
    t = time.time()
    assert lifecycle.set_expiry("u2", "p1", t + 60, now=t) is None
    with pytest.raises(lifecycle.LifecycleError, match="future"):
        lifecycle.set_expiry("u1", "p1", t - 1, now=t)
    with pytest.raises(lifecycle.LifecycleError, match="a year"):
        lifecycle.set_expiry("u1", "p1", t + 400 * 86400, now=t)


def test_dark_lifecycle_expires_nothing(alerts_db, monkeypatch):
    from api.services.alert_taxonomy import lifecycle
    monkeypatch.delenv(lifecycle.FLAG, raising=False)
    t = time.time()
    lifecycle.set_expiry("u1", "p1", t + 1, now=t)
    assert lifecycle.expire_due(now=t + 10) == 0
    assert _pred(alerts_db, "p1")["suspended_at"] is None


def test_expiry_route(alerts_db, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import alert_outbound
    from api.services.alert_taxonomy import lifecycle
    monkeypatch.setattr(alert_outbound, "is_paid_user", lambda u: True)
    app = FastAPI()
    app.include_router(alert_outbound.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "plan": "pro"}
    c = TestClient(app)
    path = "/api/alerts/predicates/p1/expiry"
    assert c.put(path, json={"expires_at": time.time() + 3600}).status_code == 404   # dark
    monkeypatch.setenv(lifecycle.FLAG, "1")
    assert c.put(path, json={"expires_at": time.time() + 3600}).status_code == 200
    assert c.put(path, json={"expires_at": 1}).status_code == 400
    assert c.put("/api/alerts/predicates/p2/expiry", json={"expires_at": None}).status_code == 404
