"""GET /api/calendar/wire — a pure table read.

No provider fan-out on the request path: the detector job owns all provider
work. That keeps `first_seen_at` accurate when nobody has the page open and
keeps the request path off the anyio threadpool (the 2026-07-01 524 class).
"""
import importlib
from unittest import mock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    import api.routers.wire as w
    importlib.reload(w)
    from api.main import app
    return TestClient(app, raise_server_exceptions=False), s, w


def _r(sym, seen, **kw):
    base = dict(market_date="2026-07-31", sym=sym, timing="amc",
                first_seen_at=seen, trigger="price", eps_act=None, eps_est=1.0,
                rev_act=None, rev_est=1e9, eps_src=None, rev_src=None,
                confirmed=0, peak_move_pct=5.0)
    base.update(kw)
    return base


def test_returns_rows_in_arrival_order(client):
    c, store, w = client
    for sym, seen in (("AMD", 3000.0), ("NVDA", 1000.0), ("SBUX", 2000.0)):
        store.upsert_print(_r(sym, seen))
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=37):
        r = c.get("/api/calendar/wire?date=2026-07-31")
    assert r.status_code == 200
    body = r.json()
    assert [row["sym"] for row in body["rows"]] == ["NVDA", "SBUX", "AMD"]
    assert body["expected"] == 37


def test_empty_session_still_reports_what_is_expected(client):
    """Before the first print the view must say '37 reporters', not render blank."""
    c, _, w = client
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=37):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["rows"] == []
    assert body["expected"] == 37


def test_live_move_is_overlaid_not_stored(client):
    c, store, w = client
    store.upsert_print(_r("NVDA", 1000.0))
    with mock.patch.object(w, "_live_moves", return_value={"NVDA": 6.4}), \
         mock.patch.object(w, "_expected_count", return_value=1):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["rows"][0]["move_pct"] == 6.4
    # and it was never persisted
    assert "move_pct" not in store.get_print("2026-07-31", "NVDA")


def test_a_price_outage_leaves_rows_intact_without_a_move(client):
    """Degrade, never blank: the row and its numbers still render."""
    c, store, w = client
    store.upsert_print(_r("NVDA", 1000.0, eps_act=1.24, confirmed=1))
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=1):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["rows"][0]["move_pct"] is None
    assert body["rows"][0]["eps_act"] == 1.24


def test_a_malformed_date_does_not_500(client):
    """Flagship public surface — a bad param is an empty answer, not a crash."""
    c, _, w = client
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=0):
        r = c.get("/api/calendar/wire?date=notadate")
    assert r.status_code == 200
    assert r.json()["rows"] == []


def test_the_public_date_param_is_still_named_date(client):
    """The Python arg is date_str to avoid shadowing datetime.date — the exact
    bug that 500ed calendar reactions for three weeks. The QUERY param must not
    change with it."""
    c, store, w = client
    store.upsert_print(_r("NVDA", 1000.0))
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=1):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["market_date"] == "2026-07-31"
    assert len(body["rows"]) == 1


# ── wire-status: the measurement Phase 2 is aimed by ─────────────────────────

def test_status_counts_how_many_arrived_on_price_before_numbers(client):
    """price_first vs actuals_first answers the spec's open question — how far
    behind the structured providers land after a print."""
    c, store, _ = client
    store.upsert_print(_r("NVDA", 1000.0, trigger="price"))
    store.upsert_print(_r("AMD", 1100.0, trigger="actuals", eps_act=1.0, confirmed=1))
    store.upsert_print(_r("SBUX", 1200.0, trigger="price", eps_act=0.71, confirmed=1))
    body = c.get("/api/calendar/wire-status?date=2026-07-31").json()
    assert body["rows"] == 3
    assert body["price_first"] == 2
    assert body["actuals_first"] == 1
    assert body["with_actuals"] == 2
    assert body["still_pending"] == 1


def test_status_on_an_empty_session_is_zeros_not_an_error(client):
    c, _, _ = client
    body = c.get("/api/calendar/wire-status?date=2026-07-31").json()
    assert body["rows"] == 0
    assert body["price_first"] == 0


def test_status_reports_liveness_so_enabled_but_never_ticked_is_visible(client):
    """The state worth catching on an earnings morning: flag on, detector dead."""
    import os
    from unittest import mock as _m
    from api.services.wire import detector
    c, _, _w = client
    detector.LAST_TICK.update({"at": None, "scanned": 0, "written": 0, "error": None})
    with _m.patch.dict(os.environ, {"WIRE_ENABLED": "1"}):
        body = c.get("/api/calendar/wire-status").json()
    assert body["enabled"] is True
    assert body["last_tick_age_s"] is None, "never ticked must read as None, not 0"
    assert body["last_tick"] is None


def test_status_reports_a_recent_tick(client):
    import time as _t
    from api.services.wire import detector
    c, _, _w = client
    detector.LAST_TICK.update({"at": _t.time(), "scanned": 37, "written": 2, "error": None})
    try:
        body = c.get("/api/calendar/wire-status").json()
        assert body["last_tick_age_s"] is not None and body["last_tick_age_s"] < 5
        assert body["last_tick"]["scanned"] == 37
        assert body["last_tick"]["written"] == 2
    finally:
        detector.LAST_TICK.update({"at": None, "scanned": 0, "written": 0, "error": None})
