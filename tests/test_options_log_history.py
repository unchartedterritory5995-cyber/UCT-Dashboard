"""FT-009 straddle history, FT-007 daily implied vs actual, FT-010 IV crush — all read from OUR
options log (api/services/options_analytics/log_history.py + routes).

No network. The log is seeded with the logger's own columns through tests/test_iv_history.py's
`Seed` (the layout the R2 store mirrors). Expected numbers are hand-computed beside each assert.
"""
from __future__ import annotations

import datetime as dt
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services import session_calendar
from api.services.options_analytics import log_history as lh
from api.services.research import iv_history as ivh
from tests.test_iv_history import ET, NOW, Seed, row

PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
IV_2PCT = round(0.02 * math.sqrt(252), 6)        # an ATM IV whose 1-day move is exactly 2%


def sessions_from(first: str, n: int) -> list:
    d, out = dt.date.fromisoformat(first), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


@pytest.fixture
def seed(tmp_path, monkeypatch):
    s = Seed(tmp_path)
    monkeypatch.setattr(ivh, "_store_override", s.store)
    return s


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize("flag,route", [
    ("OPTIONS_STRADDLE_HISTORY_ENABLED", "/api/research/options-history/TST/straddle"),
    ("OPTIONS_DAILY_MOVE_ENABLED", "/api/research/options-history/TST/daily-move"),
    ("OPTIONS_IV_CRUSH_ENABLED", "/api/research/options-history/TST/iv-crush"),
])
def test_each_history_surface_is_dark_until_its_own_switch(flag, route, monkeypatch, seed):
    for f in ("OPTIONS_STRADDLE_HISTORY_ENABLED", "OPTIONS_DAILY_MOVE_ENABLED", "OPTIONS_IV_CRUSH_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setattr(lh, "_prints", lambda s: [])
    c = _client(PAID, monkeypatch)
    assert c.get(route).status_code == 404
    monkeypatch.setenv(flag, "1")
    assert c.get(route).status_code == 200
    assert _client(FREE, monkeypatch).get(route).status_code == 402


def test_an_unreadable_log_is_a_503(monkeypatch):
    monkeypatch.setenv("OPTIONS_STRADDLE_HISTORY_ENABLED", "1")

    class Broken:
        def sessions(self):
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    monkeypatch.setattr(ivh, "_store_override", Broken())
    r = _client(PAID, monkeypatch).get("/api/research/options-history/TST/straddle")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]


# ── FT-009 ─────────────────────────────────────────────────────────────────────

def test_straddle_history_is_dollars_and_percent_with_its_dte(seed):
    d1, d2, d3 = sessions_from("2026-09-30", 3)
    seed.day(d1, [row("TST", 0.3, px=100.0, straddle=4.0, fexp="2026-10-02", fdte=2)])
    seed.day(d2, [row("TST", 0.3, px=80.0, straddle=4.0, fexp="2026-10-02", fdte=1)])
    seed.day(d3, [row("TST", 0.3, px=100.0)])                          # no two-sided straddle
    h = lh.straddle_history("TST", now=NOW)
    assert [(p["date"], p["straddle_pct"], p["front_dte"]) for p in h["points"]] == \
        [(d1, 4.0, 2), (d2, 5.0, 1)]                                      # 4/100, 4/80
    assert h["n"] == 2 and h["sessions_without_straddle"] == [d3]
    assert h["logging_began"] == d1


# ── FT-007 ─────────────────────────────────────────────────────────────────────

def test_daily_move_pairs_consecutive_sessions_and_withholds_the_summary(seed):
    d1, d2, d3 = sessions_from("2026-09-30", 3)
    seed.day(d1, [row("TST", IV_2PCT, px=100.0)])
    seed.day(d2, [row("TST", IV_2PCT, px=101.0)])
    seed.day(d3, [row("TST", IV_2PCT, px=97.0)])
    m = lh.daily_move("TST", now=NOW)
    a, b = m["pairs"]
    assert (a["date"], a["next"], a["implied_move_pct"], a["actual_move_pct"], a["inside"]) == \
        (d1, d2, 2.0, 1.0, True)
    assert (b["actual_move_pct"], b["inside"], b["ratio"]) == (-3.96, False, 1.98)   # 97/101-1
    assert m["n"] == 2 and m["summary"] is None
    first = sessions_from("2026-10-05", 18)[-1]                       # 18 more pairs after 10/02
    assert m["summary_note"] == ("2 pairs so far; how often the move stayed inside the implied move "
                                 f"needs 20 (first possible {first}).")


def test_a_missed_session_breaks_the_pair_it_is_never_bridged(seed):
    d1, d2, d3 = sessions_from("2026-09-30", 3)
    seed.day(d1, [row("TST", IV_2PCT, px=100.0)])
    seed.day(d3, [row("TST", IV_2PCT, px=110.0)])                       # d2 was not logged
    m = lh.daily_move("TST", now=NOW)
    assert m["pairs"] == []
    assert m["broken_pairs"] == [{"date": d1, "next": d2, "reason": "the next session was not logged"}]
    assert d2 in m["missing_sessions"]


def test_daily_move_summary_exists_at_20_pairs(seed):
    days = sessions_from("2026-09-30", 21)
    for i, d in enumerate(days):
        seed.day(d, [row("TST", IV_2PCT, px=100.0 if i % 2 == 0 else 101.0)])
    m = lh.daily_move("TST", now=dt.datetime(2026, 10, 30, 18, 0, tzinfo=ET))
    assert m["n"] == 20 and m["summary_note"] is None
    assert m["summary"]["pairs"] == 20 and m["summary"]["inside_share"] == 100.0


# ── FT-010 ─────────────────────────────────────────────────────────────────────

def test_iv_crush_reads_eleven_sessions_around_an_after_close_print(seed, monkeypatch):
    days = sessions_from("2026-09-30", 13)                            # 9/30 .. 10/16
    for d in days:
        iv = 0.60 if d == "2026-10-08" else (0.35 if d > "2026-10-08" else 0.50)
        seed.day(d, [row("TST", iv)])
    monkeypatch.setattr(lh, "_prints", lambda s: [
        {"reportedDate": "2026-10-08", "reportTime": "post"},
        {"reportedDate": "2026-07-30", "reportTime": "post"},          # before the log began
    ])
    c = lh.iv_crush("TST", now=dt.datetime(2026, 10, 16, 18, 0, tzinfo=ET))
    p = c["prints"][0]
    assert p["session_0"] == "2026-10-08" and p["complete"] is True
    assert p["iv"]["-5"] == 0.50 and p["iv"]["0"] == 0.60 and p["iv"]["1"] == 0.35
    assert p["crush_pct"] == -41.7                                      # .35/.60 - 1
    assert c["prints_before_log"] == 1
    assert c["summary"] is None and "need 4" in c["summary_note"]


def test_iv_crush_leaves_unlogged_and_future_sessions_blank(seed, monkeypatch):
    for d in sessions_from("2026-09-30", 3):
        seed.day(d, [row("TST", 0.4)])
    monkeypatch.setattr(lh, "_prints", lambda s: [{"reportedDate": "2026-10-05", "reportTime": ""}])
    c = lh.iv_crush("TST", now=NOW)
    p = c["prints"][0]
    assert p["session_0"] == "2026-10-02"                                # unknown timing: the session before
    assert p["iv"]["0"] == 0.4 and p["iv"]["1"] is None and p["complete"] is False
    assert p["iv"]["-5"] is None                                          # 9/25: before the log


def test_iv_crush_summary_rows_at_four_complete_prints(seed, monkeypatch):
    days = sessions_from("2026-09-01", 60)
    for i, d in enumerate(days):
        seed.day(d, [row("TST", 0.30 + (i % 3) / 100)])
    anchors = [days[10], days[22], days[34], days[46]]
    monkeypatch.setattr(lh, "_prints", lambda s: [{"reportedDate": a, "reportTime": "post"} for a in anchors])
    c = lh.iv_crush("TST", now=dt.datetime(2026, 12, 31, 18, 0, tzinfo=ET))
    assert c["complete_prints"] == 4 and c["summary_note"] is None
    assert set(c["summary"]) == {"average", "max", "min"}
    assert c["summary"]["max"]["0"] >= c["summary"]["average"]["0"] >= c["summary"]["min"]["0"]
