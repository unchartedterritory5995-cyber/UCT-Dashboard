"""FT-056 Market Tide (api/services/options_analytics/market_tide.py + the route in
api/routers/options_analytics.py).

No network. The tape is read through `market_tide._read`, replaced here by a reader over
tests/fixtures/options_analytics/tape_{stocks,etfs}.csv. Those files are SCHEMA-SHAPED, not a
live recording: the header is the tape's own column order (api/flow_db.py COLUMNS), the time
format is the BBS export's "9:30:15 AM", and every number below is hand-computed from them.
"""
from __future__ import annotations

import csv
import pathlib
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import market_tide as mt

FIX = pathlib.Path(__file__).parent / "fixtures" / "options_analytics"
FLAG = "OPTIONS_MARKET_TIDE_ENABLED"
PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}


def _fixture_reader(fail=()):
    calls = []

    def read(path, add):
        name = "stocks" if path.endswith("/data") else "etfs"
        calls.append(name)
        if name in fail:
            return False
        with open(FIX / f"tape_{name}.csv", encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                add(row)
        return True
    read.calls = calls
    return read


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    mt.clear_cache()
    # The fixture tape is the 2026-10-02 session: the clock is pinned inside it (L3's rule
    # tides TODAY once today's session has opened).
    import datetime as _d
    monkeypatch.setattr(mt, "_now", lambda: _d.datetime(2026, 10, 2, 12, 6, tzinfo=mt._ET))
    monkeypatch.setattr(mt, "_read", _fixture_reader())
    yield
    mt.clear_cache()


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


# ── the dark gate and the paid gate ─────────────────────────────────────────────

def test_dark_by_default_answers_404(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert _client(PAID, monkeypatch).get("/api/options/market-tide").status_code == 404


def test_armed_serves_paid_and_refuses_free(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    assert _client(PAID, monkeypatch).get("/api/options/market-tide").status_code == 200
    assert _client(FREE, monkeypatch).get("/api/options/market-tide").status_code == 402


def test_an_unknown_scope_is_refused(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    assert _client(PAID, monkeypatch).get("/api/options/market-tide?scope=crypto").status_code == 422


# ── the arithmetic, hand-computed from the fixture ──────────────────────────────

def test_the_tide_signs_premium_by_side_and_minute(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    b = _client(PAID, monkeypatch).get("/api/options/market-tide").json()
    assert b["session"] == "2026-10-02"
    assert b["older_sessions_dropped"] == ["2026-10-01"]       # AAPL's 10/1 print is not today's tide
    by_t = {m["t"]: m for m in b["minutes"]}
    assert [m["t"] for m in b["minutes"]] == ["09:30", "09:31", "12:05"]
    # 09:30 -- NVDA call at ask +50,000, TSLA call at bid -30,000; AMD put at bid -12,000, SPY put at ask +50,000
    assert by_t["09:30"]["net_call_premium"] == 20_000
    assert by_t["09:30"]["net_put_premium"] == 38_000
    assert by_t["09:30"]["prints"] == 4
    # 09:31 -- MSFT at the mid: counted, never signed
    assert by_t["09:31"]["net_call_premium"] == 0 and by_t["09:31"]["prints"] == 1
    # 12:05 PM is 12:05, not 00:05 -- META put at ask +40,000, QQQ call at ask +20,000
    assert by_t["12:05"]["net_call_premium"] == 20_000 and by_t["12:05"]["net_put_premium"] == 40_000
    assert by_t["12:05"]["cum_net_call_premium"] == 40_000
    assert by_t["12:05"]["cum_net_put_premium"] == 78_000
    assert by_t["12:05"]["cum_net_premium"] == -38_000
    assert b["totals"] == {"net_call_premium": 40_000, "net_put_premium": 78_000, "net_premium": -38_000}
    assert b["prints_counted"] == 7 and b["prints_unsigned"] == 1


def test_every_answer_states_the_tape_filters_and_is_labelled_computed(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    b = _client(PAID, monkeypatch).get("/api/options/market-tide").json()
    assert "50+ contracts" in b["filters"] and "$10K+" in b["filters"]
    assert b["label"] == "computed"
    assert "Eastern" in b["method"]


def test_an_unreadable_print_is_counted_and_named_never_silently_dropped(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    b = _client(PAID, monkeypatch).get("/api/options/market-tide").json()
    assert b["prints_unreadable"] == 1                            # XYZ has no time
    assert b["partial"] is True
    assert any("1 prints had no readable time" in r for r in b["partial_reasons"])


def test_scope_etfs_reads_only_the_etf_tape(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    reader = _fixture_reader()
    monkeypatch.setattr(mt, "_read", reader)
    b = _client(PAID, monkeypatch).get("/api/options/market-tide?scope=etfs").json()
    assert reader.calls == ["etfs"]
    assert b["totals"] == {"net_call_premium": 20_000, "net_put_premium": 50_000, "net_premium": -30_000}


# ── failure is named, never a quiet tape ────────────────────────────────────────

def test_a_failed_source_is_named_and_the_answer_is_partial(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(mt, "_read", _fixture_reader(fail=("etfs",)))
    b = _client(PAID, monkeypatch).get("/api/options/market-tide").json()
    assert b["sources"] == {"stocks": "ok", "etfs": "failed"}
    assert b["partial"] is True
    assert any("etfs tape could not be read" in r for r in b["partial_reasons"])
    assert b["totals"]["net_put_premium"] == 28_000              # without SPY's +50,000


def test_no_readable_source_is_a_503_in_words(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(mt, "_read", _fixture_reader(fail=("stocks", "etfs")))
    r = _client(PAID, monkeypatch).get("/api/options/market-tide")
    assert r.status_code == 503 and "could not be read" in r.json()["detail"]


def test_a_read_that_dies_half_way_contributes_nothing(monkeypatch):
    """A source that streamed some rows then failed is reported failed AND its rows are gone:
    half a tape is not presented as the tape."""
    monkeypatch.setenv(FLAG, "1")

    def read(path, add):
        if path.endswith("/data"):
            add({"CreatedDate": "10/2/2026", "CreatedTime": "9:45:00 AM", "Premium": "999999",
                 "CallPut": "CALL", "Side": "AA"})
            return False
        return True
    monkeypatch.setattr(mt, "_read", read)
    b = _client(PAID, monkeypatch).get("/api/options/market-tide").json()
    assert b["sources"]["stocks"] == "failed"
    assert all(m["t"] != "09:45" for m in b["minutes"])


# ── off the request path: one build per TTL, stale served while one thread refreshes ──

def test_a_fresh_answer_is_served_from_cache(monkeypatch):
    reader = _fixture_reader()
    monkeypatch.setattr(mt, "_read", reader)
    mt.get("all")
    mt.get("all")
    assert reader.calls == ["stocks", "etfs"]                     # one build, two answers


def test_a_stale_answer_is_served_at_once_and_refreshed_in_the_background(monkeypatch):
    reader = _fixture_reader()
    monkeypatch.setattr(mt, "_read", reader)
    mt.get("all")
    monkeypatch.setattr(mt, "TTL_S", 0.0)
    started = []
    real_thread = threading.Thread

    class Spy(real_thread):
        def start(self):
            started.append(self.name)
            super().start()
    monkeypatch.setattr(mt.threading, "Thread", Spy)
    out = mt.get("all")
    assert out["stale"] is True and out["session"] == "2026-10-02"
    assert started == ["market-tide-all"]
    for t in threading.enumerate():
        if t.name == "market-tide-all":
            t.join(5)
    assert reader.calls.count("stocks") == 2                      # the refresh really rebuilt


def test_time_parsing_covers_both_tape_formats():
    assert mt._minute("9:30:15 AM") == "09:30"
    assert mt._minute("12:05:00 PM") == "12:05"
    assert mt._minute("12:01:00 AM") == "00:01"
    assert mt._minute("13:04:59") == "13:04"
    assert mt._minute("") is None and mt._minute("noon") is None


# ── L3: a scope with no prints today tides TODAY (empty), never an old session as current ─────

def _at(monkeypatch, *ymdhm):
    import datetime as _d
    monkeypatch.setattr(mt, "_now", lambda: _d.datetime(*ymdhm, tzinfo=mt._ET))


def test_after_the_open_a_tape_without_todays_prints_is_an_empty_today(monkeypatch):
    _at(monkeypatch, 2026, 10, 5, 15, 40)                  # Monday; the fixture tape is Friday's
    t = mt.build("etfs")
    assert t["session"] == "2026-10-05" and t["session_status"] == "no_prints_today"
    assert t["minutes"] == [] and t["totals"]["net_premium"] == 0 and t["data_through"] is None
    assert t["latest_session_on_tape"] == "2026-10-02"
    assert t["partial"] is True and any("no prints for today" in r for r in t["partial_reasons"])


def test_before_the_open_the_last_session_is_served_and_labelled_prior(monkeypatch):
    _at(monkeypatch, 2026, 10, 5, 8, 0)
    t = mt.build("all")
    assert t["session"] == "2026-10-02" and t["session_status"] == "prior_session"
    assert t["minutes"] and t["data_through"] == "12:05"


def test_inside_todays_session_it_is_today(monkeypatch):
    t = mt.build("all")                                     # the pinned clock: 2026-10-02 12:06
    assert t["session"] == "2026-10-02" and t["session_status"] == "today"
    assert t["data_through"] == "12:05" and t["tape_behind"] is False


# ── L2: a tape that runs behind the clock is named and retried soon ───────────────────────────

def test_a_tape_behind_the_clock_is_named_and_retried_sooner(monkeypatch):
    _at(monkeypatch, 2026, 10, 2, 15, 40)                   # the tape stops at 12:05
    t = mt.build("all")
    assert t["tape_behind"] is True and t["data_through"] == "12:05"
    assert any("runs only to 12:05" in r for r in t["partial_reasons"])
    assert mt._ttl(t) == mt.RETRY_BEHIND_S < mt.TTL_S


def test_the_tapes_own_version_is_reported_per_source(monkeypatch):
    base = mt._read

    def read(path, add):
        ok = base(path, add)
        mt._TL.meta = {"version": "29811234" if path.endswith("/data") else "29811200"}
        return ok
    monkeypatch.setattr(mt, "_read", read)
    t = mt.build("all")
    assert t["tape_versions"] == {"stocks": "29811234", "etfs": "29811200"}


def test_a_failed_refresh_is_reported_not_swallowed(monkeypatch):
    mt.get("all")
    monkeypatch.setattr(mt, "TTL_S", 0.0)

    def boom(path, add):
        raise RuntimeError("tape read timed out")
    monkeypatch.setattr(mt, "_read", boom)
    mt.get("all")                                           # starts the background refresh
    for t in threading.enumerate():
        if t.name == "market-tide-all":
            t.join(5)
    out = mt.get("all")
    assert out["stale"] is True and "tape read timed out" in out["refresh_error"]["error"]
