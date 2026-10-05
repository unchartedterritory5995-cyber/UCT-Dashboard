"""FT-006 IV rank with words, FT-020 volatility endpoints, FT-019 option monitor
(api/services/options_analytics/vol.py + routes in api/routers/options_analytics.py).

No network. The options log is seeded with the logger's own columns through
tests/test_iv_history.py's `Seed` (the same layout the R2 store mirrors); bars, the vendor
surface, the front chain and the earnings date are stubs. Expected numbers are hand-computed.
"""
from __future__ import annotations

import datetime as dt
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services import session_calendar
from api.services.options_analytics import vol
from api.services.research import iv_history as ivh
from tests.test_iv_history import NOW, Seed, row

PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
A = math.log(1.1)


def sessions_ending(last: str, n: int) -> list:
    d, out = dt.date.fromisoformat(last), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return out[::-1]


def bars_alternating(n_closes: int, today_bar=True):
    """Completed sessions closing 100, 110, 100, 110 ... (log returns +-ln 1.1), plus a bar for
    today that must be left out of every HV."""
    et = vol._ET
    today = dt.datetime.now(et).date()
    out = []
    for i in range(n_closes):
        d = today - dt.timedelta(days=n_closes - i)
        out.append({"t": int(dt.datetime(d.year, d.month, d.day, 12, tzinfo=et).timestamp() * 1000),
                    "c": 100.0 if i % 2 == 0 else 110.0, "v": 1})
    if today_bar:
        out.append({"t": int(dt.datetime(today.year, today.month, today.day, 12, tzinfo=et).timestamp() * 1000),
                    "c": 500.0, "v": 1})
    return out


def hv_expected(n):
    return round(A * math.sqrt(n / (n - 1)) * math.sqrt(252), 4)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    vol.clear_cache()
    monkeypatch.setattr(vol, "_bars", lambda s: bars_alternating(31))
    yield
    vol.clear_cache()


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


# ── switches: one per surface ──────────────────────────────────────────────────

@pytest.mark.parametrize("flag,route", [
    ("OPTIONS_IV_RANK_ENABLED", "/api/options/vol/TST/iv-rank"),
    ("OPTIONS_VOL_ENDPOINTS_ENABLED", "/api/options/vol/TST/realized"),
    ("OPTIONS_MONITOR_ENABLED", "/api/research/options/TST/monitor"),
])
def test_each_vol_surface_is_dark_until_its_own_switch(flag, route, monkeypatch, seed):
    for f in ("OPTIONS_IV_RANK_ENABLED", "OPTIONS_VOL_ENDPOINTS_ENABLED", "OPTIONS_MONITOR_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setattr(vol, "_next_earnings", lambda s: None)
    monkeypatch.setattr(vol, "_front_chain", lambda s: {"error": "x"})
    c = _client(PAID, monkeypatch)
    assert c.get(route).status_code == 404
    monkeypatch.setenv(flag, "1")
    assert c.get(route).status_code == 200
    assert _client(FREE, monkeypatch).get(route).status_code == 402


# ── FT-006 IV rank ─────────────────────────────────────────────────────────────

def test_iv_rank_below_20_sessions_is_a_sentence_with_n_and_a_date(seed):
    days = sessions_ending("2026-10-02", 3)
    for i, d in enumerate(days):
        seed.day(d, [row("TST", 0.30 + i / 100)])
    r = vol.iv_rank("TST", now=NOW)
    assert r["iv_rank"] is None and r["rank_word"] is None
    assert r["n"] == 3 and r["rank_min_sessions"] == 20
    after = sessions_ending("2026-12-31", 200)
    expected = [d for d in after if d > "2026-10-02"][16]           # the 17th session after the last
    assert r["meaningful_from"] == expected
    assert r["sentence"] == f"IV rank: 3 sessions logged, needs 20 (first possible {expected})."


def test_iv_rank_at_20_sessions_carries_a_plain_word(seed):
    days = sessions_ending("2026-10-02", 25)
    for i, d in enumerate(days):
        seed.day(d, [row("TST", 0.20 + i / 100)])                     # today is the high
    r = vol.iv_rank("TST", now=NOW)
    assert r["iv_rank"] == 100.0 and r["rank_word"] == "High"
    assert r["sentence"] == "IV rank 100 High"
    assert r["n"] == 25 and r["label"] == "computed"


@pytest.mark.parametrize("rank,word", [(0, "Very low"), (19.9, "Very low"), (20, "Low"),
                                       (49, "Moderate"), (60, "Elevated"), (80, "High")])
def test_rank_words(rank, word):
    assert vol.rank_label(rank) == word


# ── FT-020 realized, interpolated, VRP ─────────────────────────────────────────

def test_realized_vol_from_completed_sessions_only():
    r = vol.realized("TST")
    assert r["hv"] == {"hv10": hv_expected(10), "hv20": hv_expected(20), "hv30": hv_expected(30)}
    assert r["sessions"] == 31                                         # today's 500 close left out
    assert r["label"] == "computed"


def test_an_empty_bar_read_is_unavailable_not_zero(monkeypatch):
    monkeypatch.setattr(vol, "_bars", lambda s: [])
    r = vol.realized("TST")
    assert r["available"] is False and r["hv"] == {} and "not zero" in r["note"]


def test_constant_maturity_iv_interpolates_total_variance_and_never_extrapolates():
    pts = [{"dte": 20, "atm_iv": 0.30}, {"dte": 40, "atm_iv": 0.40}]
    assert vol.interpolate_iv(pts, 30)["iv"] == 0.3697                # sqrt(4.1/30)
    assert vol.interpolate_iv(pts, 20)["iv"] == 0.30
    out = vol.interpolate_iv(pts, 60)
    assert out["iv"] is None and "not extrapolated" in out["reason"]
    assert vol.interpolate_iv(pts[:1], 30)["iv"] is None


def test_vrp_is_iv30_minus_hv30(monkeypatch):
    from api.services import vol_surface
    monkeypatch.setattr(vol_surface, "get_surface", lambda s, selected="": {
        "spot": 100, "iv_source_text": "vendor", "basis": "today",
        "term": {"points": [{"expiration": "2026-10-22", "dte": 20, "atm_iv": 0.30},
                            {"expiration": "2026-11-11", "dte": 40, "atm_iv": 0.40}]}})
    r = vol.vrp("TST")
    assert r["iv30"] == 0.3697 and r["hv30"] == hv_expected(30)
    assert r["vrp_points"] == round(0.3697 - hv_expected(30), 4)


def test_a_vendor_surface_failure_is_a_503(monkeypatch):
    from api.services import vol_surface
    monkeypatch.setenv("OPTIONS_VOL_ENDPOINTS_ENABLED", "1")
    monkeypatch.setattr(vol_surface, "get_surface", lambda s, selected="": {"error": "no listed expirations"})
    r = _client(PAID, monkeypatch).get("/api/options/vol/TST/term-structure")
    assert r.status_code == 503 and "no listed expirations" in r.json()["detail"]


# ── FT-019 monitor ─────────────────────────────────────────────────────────────

def test_monitor_carries_hv_events_and_vendor_volume(monkeypatch):
    monkeypatch.setattr(vol, "_next_earnings", lambda s: "2026-10-28")
    monkeypatch.setattr(vol, "_front_chain", lambda s: {
        "expiration": "2026-10-09",
        "calls": [{"day_volume": 300}, {"day_volume": None}, {"day_volume": 100}],
        "puts": [{"day_volume": 200}]})
    m = vol.monitor("TST", today=dt.date(2026, 10, 2))
    assert m["hv"]["hv20"] == hv_expected(20) and m["hv_label"] == "computed"
    assert m["events"] == {"next_earnings": "2026-10-28", "days_to_earnings": 26, "note": None}
    assert m["volume"]["call_volume"] == 400 and m["volume"]["put_volume"] == 200
    assert m["volume"]["put_call_ratio"] == 0.5 and m["volume"]["label"] == "vendor"


def test_monitor_says_when_there_is_no_date_and_when_the_chain_failed(monkeypatch):
    monkeypatch.setattr(vol, "_next_earnings", lambda s: None)
    monkeypatch.setattr(vol, "_front_chain", lambda s: {"error": "polygon request failed"})
    m = vol.monitor("TST", today=dt.date(2026, 10, 2))
    assert m["events"]["note"] == "No scheduled earnings date on file."
    assert m["volume"]["put_call_ratio"] is None and "unavailable" in m["volume"]["note"]
