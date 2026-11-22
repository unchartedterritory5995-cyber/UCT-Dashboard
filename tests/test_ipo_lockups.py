"""IPO LOCKUP: `api/services/ipo_lockups.py`, the listing-date sources and held answer it reads from
`api/services/scan_ipo.py`, and its route `GET /api/scans/ipo-lockups`.

Every symbol, name, date and price is invented. No network: the listings, the names and the closes are the
server's held reads, replaced here; anything that would ask a vendor raises.
"""
from __future__ import annotations

import datetime as dt
import time
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import scans as scans_mod
from api.services import held_reads, ipo_lockups as lk, local_bars, scan_ipo
from tests.authclients import FREE_MEMBER, PAID_MEMBER, signed_in_as

ET = ZoneInfo("America/New_York")
NOW = dt.datetime(2026, 11, 20, 10, 0, tzinfo=ET)          # a Friday morning
BASIS = "estimated: 180 days after listing; the prospectus sets the actual date"


def listing_for(expiry: str) -> str:
    """The YYYYMMDD listing date 180 calendar days before `expiry`."""
    return (dt.date.fromisoformat(expiry) - dt.timedelta(days=180)).strftime("%Y%m%d")


LIVE = {"status": "ok", "as_of": "2026-11-20T09:58:00-05:00", "count": 7, "results": [
    {"sym": "AQXA", "ipo_date": int(listing_for("2026-11-24")), "price": 30.0},   # in 4 days
    {"sym": "BQXB", "ipo_date": int(listing_for("2026-11-16")), "price": 12.0},   # 4 days ago
    {"sym": "CQXC", "ipo_date": int(listing_for("2026-12-21")), "price": 8.0},    # in 31 days: out
    {"sym": "DQXD", "ipo_date": int(listing_for("2026-11-12")), "price": 9.0},    # 8 days ago: out
    {"sym": "EQXE", "ipo_date": int(listing_for("2026-12-20")), "price": 5.0},    # a Sunday: rolled to Mon Dec 21: out
    {"sym": "FQXF", "ipo_date": None, "price": 5.0},                              # no listing date
    {"sym": "GQXG", "ipo_date": int(listing_for("2026-11-26")), "price": 44.0},   # Thanksgiving: rolled to Fri Nov 27
]}
SOURCES = {"AQXA": "first_bar", "BQXB": "reference", "GQXG": "relisting", "CQXC": "first_bar"}


def bar(day: str, close: float) -> dict:
    return {"t": day.replace("-", ""), "o": close, "h": close, "l": close, "c": close, "v": 1000}


@pytest.fixture
def held(monkeypatch):
    """The server's held reads, replaced with invented ones; every vendor door raises."""
    state = {"live": LIVE, "sources": dict(SOURCES), "date": "2026-11-20", "built_at": 1.0, "building": False}
    monkeypatch.setattr(scan_ipo, "held_listings", lambda: dict(state))
    names = {"AQXA": "Aqxa Robotics Inc", "GQXG": "Gqxg Therapeutics"}
    monkeypatch.setattr(held_reads, "held_name", lambda s: names.get(s))
    closes = {
        "AQXA": [bar("2026-05-27", 9.0), bar(dt.date.fromisoformat("2026-05-28").isoformat(), 20.0),
                 bar("2026-11-19", 25.0)],
        "BQXB": [bar("2026-06-02", 11.0)],            # its closes start 13 days after it listed
        "GQXG": [bar("2026-05-30", 40.0)],            # one close only (a Saturday listing date in the invented data)
    }

    def read_bars(sym, tf, want):
        assert tf == local_bars.DAILY_TF and want == lk.BARS_WANT
        if sym == "CQXC":
            raise RuntimeError("bars.db locked")
        return list(closes.get(sym, []))
    monkeypatch.setattr(local_bars, "read_bars", read_bars)

    def vendor(*a, **k):
        raise AssertionError("a vendor or a build was asked")
    for name in ("_ensure_ipo_set", "_build_ipo_set", "full_market_snapshot", "_etf_symbols"):
        monkeypatch.setattr(scan_ipo, name, vendor)
    monkeypatch.setattr(lk, "now_et", lambda: NOW)                  # never the real date: the window is fixed
    lk.reset_for_tests()
    yield state
    lk.reset_for_tests()


# ── the estimate ────────────────────────────────────────────────────────────────────────────────

def test_the_estimate_is_180_calendar_days_rolled_to_the_next_session():
    assert lk.estimated_expiry(dt.date(2026, 5, 28)) == dt.date(2026, 11, 24)     # a Tuesday: as is
    assert lk.estimated_expiry(dt.date(2026, 6, 1)) == dt.date(2026, 11, 30)      # a Saturday: the Monday
    assert lk.estimated_expiry(dt.date(2026, 5, 30)) == dt.date(2026, 11, 27)     # Thanksgiving: the Friday
    assert lk.LOCKUP_DAYS == 180 and lk.BASIS == "estimated" and lk.BASIS_WORDS == BASIS


def test_the_window_is_the_next_30_days_and_the_past_7_soonest_first_every_row_estimated(held):
    out, _note = lk.build(now=NOW)
    assert out["status"] == "ok"
    assert [(r["symbol"], r["estimated_expiry"], r["days_to_go"]) for r in out["rows"]] == [
        ("BQXB", "2026-11-16", -4), ("AQXA", "2026-11-24", 4), ("GQXG", "2026-11-27", 7)]
    assert all(r["basis"] == "estimated" and r["basis_words"] == BASIS for r in out["rows"])
    assert out["basis_words"] == BASIS and out["lockup_days"] == 180
    assert out["window"] == {"behind_days": 7, "ahead_days": 30, "from": "2026-11-13", "to": "2026-12-20"}
    assert out["counts"] == {"listings": 7, "with_listing_date": 6, "without_listing_date": 1, "in_window": 3,
                             "by_source": {"reference": 1, "first_bar": 1, "relisting": 1}}
    assert out["listings_as_of"] == LIVE["as_of"]


def test_each_row_says_where_its_listing_date_came_from_and_names_the_company_only_when_held(held):
    rows = {r["symbol"]: r for r in lk.build(now=NOW)[0]["rows"]}
    assert rows["AQXA"]["listing_source"] == "first_bar"
    assert rows["AQXA"]["listing_source_words"] == "its first daily bar in the site's bar store"
    assert rows["BQXB"]["listing_source_words"] == "the listing date in Massive's reference data"
    assert rows["AQXA"]["company"] == "Aqxa Robotics Inc" and rows["BQXB"]["company"] is None
    held["sources"] = {}
    rows = {r["symbol"]: r for r in lk.build(now=NOW)[0]["rows"]}
    assert rows["AQXA"]["listing_source"] is None and rows["AQXA"]["listing_source_words"] is None


def test_the_change_since_listing_is_the_latest_close_against_the_first_days_close_or_says_why(held):
    rows = {r["symbol"]: r["change_since_listing"] for r in lk.build(now=NOW)[0]["rows"]}
    # AQXA: a bar before the listing date (a reused ticker's older security) is never its first close
    assert rows["AQXA"] == {"pct": 25.0, "first_close": 20.0, "first_date": "2026-05-28", "last_close": 25.0,
                            "last_date": "2026-11-19", "reason": None}
    assert rows["BQXB"]["pct"] is None and rows["BQXB"]["reason"] == "no_first_day"
    assert rows["GQXG"]["pct"] is None and rows["GQXG"]["reason"] == "no_later_close"
    assert lk.change_since_listing("ZQXZ", dt.date(2026, 5, 1))["reason"] == "no_closes"
    assert lk.change_since_listing("CQXC", dt.date(2026, 5, 1))["reason"] == "bars_unreadable"


def test_before_the_listings_scan_has_answered_it_is_warming_never_an_empty_list(held):
    held["live"] = None
    out, note = lk.build(now=NOW)
    assert out["status"] == "warming" and out["rows"] == [] and "warming" in note


# ── held, built once, never on the request, never a vendor ──────────────────────────────────────

def test_a_request_gets_the_held_answer_and_the_build_runs_once(held, monkeypatch):
    calls = []
    real = lk.build

    def counted(previous=None, *, now=None):
        calls.append(1)
        return real(previous, now=NOW)
    monkeypatch.setattr(lk, "build", counted)
    first = lk.get_lockups()
    second = lk.get_lockups()
    assert first["status"] == "ok" and "v" not in first and [r["symbol"] for r in first["rows"]] == ["BQXB", "AQXA", "GQXG"]
    assert second["rows"] == first["rows"] and len(calls) == 1


def test_a_build_that_has_not_finished_answers_computing(held, monkeypatch):
    real = lk.build

    def slow(previous=None, *, now=None):
        time.sleep(0.5)
        return real(previous, now=NOW)
    monkeypatch.setattr(lk, "build", slow)
    out = lk._HELD.get(wait_s=0.01)
    assert out == {"status": "computing"}
    lk._HELD.drain(2.0)


def test_the_answer_is_refreshed_when_the_day_turns_or_the_listings_change(held, monkeypatch):
    answer, _ = lk.build(now=NOW)
    monkeypatch.setattr(lk, "now_et", lambda: NOW)
    fresh = time.time()
    assert lk._due(answer, fresh) is False
    assert lk._due(answer, fresh - lk.REFRESH_S - 1) is True
    assert lk._due({**answer, "today": "2026-11-19"}, fresh) is True
    held["live"] = {**LIVE, "as_of": "2026-11-20T10:30:00-05:00"}
    assert lk._due(answer, fresh) is False and lk._due(answer, fresh - 61) is True
    assert lk._due({"v": 1, "status": "warming", "rows": []}, fresh - lk.WARMING_RETRY_S - 1) is True


# ── scan_ipo: where each listing date came from, and the held live answer ───────────────────────

def test_the_listings_scan_records_where_each_date_came_from_in_its_own_order(monkeypatch):
    monkeypatch.setattr(scan_ipo._sqlite, "recent_first_trade", lambda since: {"AQXA": 20260528, "BQXB": 20260610})
    monkeypatch.setattr(scan_ipo, "_recent_relistings", lambda since: {"GQXG": 20260530})
    monkeypatch.setattr(scan_ipo, "_whole_market_ipos", lambda since: {"BQXB": 20260605, "HQXH": 20260701})
    src: dict = {}
    m = scan_ipo._build_ipo_set(src)
    assert m == {"AQXA": 20260528, "BQXB": 20260605, "GQXG": 20260530, "HQXH": 20260701}
    assert src == {"AQXA": "first_bar", "BQXB": "reference", "GQXG": "relisting", "HQXH": "reference"}
    assert scan_ipo._build_ipo_set() == m                          # without the dict: the map, unchanged


def test_the_held_listings_read_never_builds_and_keeps_only_a_non_empty_live_answer(monkeypatch):
    from api.services.cache import cache
    saved = dict(scan_ipo._state)
    try:
        cache.delete_prefix("scan_ipo1y")
        with scan_ipo._LOCK:
            scan_ipo._state.update(live=None, sources={"AQXA": "first_bar"})
        monkeypatch.setattr(scan_ipo, "_ensure_ipo_set", lambda: (_ for _ in ()).throw(AssertionError("built")))
        got = scan_ipo.held_listings()
        assert got["live"] is None and got["sources"] == {"AQXA": "first_bar"}
        got["sources"]["ZZZ"] = "x"                                 # a copy: the held map is not changed by a reader
        assert "ZZZ" not in scan_ipo.held_listings()["sources"]
        monkeypatch.setattr(scan_ipo, "_ensure_ipo_set", lambda: {"AQXA": 20260528})
        monkeypatch.setattr(scan_ipo, "full_market_snapshot", lambda: {"AQXA": {"last_price": 25.0, "prev_close": 24.0}})
        monkeypatch.setattr(scan_ipo, "_etf_symbols", lambda: set())
        monkeypatch.setattr(scan_ipo, "_avg_dollar_volume", lambda: {})
        monkeypatch.setattr(scan_ipo, "_tradable", lambda *a, **k: True)
        out = scan_ipo.get_ipo_last_1y()
        assert out["results"] and scan_ipo.held_listings()["live"] is out
        cache.delete_prefix("scan_ipo1y")
        monkeypatch.setattr(scan_ipo, "_ensure_ipo_set", lambda: {})
        empty = scan_ipo.get_ipo_last_1y()
        assert empty["results"] == [] and scan_ipo.held_listings()["live"] is out   # an empty pass never replaces it
    finally:
        cache.delete_prefix("scan_ipo1y")
        with scan_ipo._LOCK:
            scan_ipo._state.clear()
            scan_ipo._state.update(saved)


# ── the door ────────────────────────────────────────────────────────────────────────────────────

def test_the_route_is_paid_and_answers_the_held_list(held):
    app = FastAPI()
    app.include_router(scans_mod.router)
    client = TestClient(app, raise_server_exceptions=False)
    url = "/api/scans/ipo-lockups"
    assert client.get(url).status_code == 401
    with signed_in_as(FREE_MEMBER, app=app):
        r = client.get(url)
        assert r.status_code == 402 and r.json()["detail"] == "Scanner presets require a paid plan"
    with signed_in_as(PAID_MEMBER, app=app):
        body = client.get(url).json()
    assert body["status"] == "ok" and body["basis_words"] == BASIS
    assert all(r["basis"] == "estimated" for r in body["rows"])
