"""IV history from OUR options log (RM-L01) and BRK-10's first slice (RM-L02).

`api/services/research/iv_history.py` + `api/routers/iv_history.py`, over a SEEDED
local copy of the log's layout (`options_log/<YYYY>/<date>.{manifest.json,
underlyings.csv.gz}`), written with the logger's own column list. No network.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
import os
import sys
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.services import options_universe_log as log  # noqa: E402
from api.services import session_calendar  # noqa: E402
from api.services.research import iv_history as svc  # noqa: E402
from tests.authclients import FREE_MEMBER, PAID_MEMBER, signed_in_as  # noqa: E402

ET = ZoneInfo("America/New_York")
FLAG = "IV_HISTORY_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
#: Friday 2026-10-02, after the day's log is due
NOW = dt.datetime(2026, 10, 2, 18, 0, tzinfo=ET)


def trading_days(start: str, n: int) -> list:
    d, out = dt.date.fromisoformat(start), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


class Seed:
    def __init__(self, root):
        self.root = str(root)
        self.store = svc.LocalStore(self.root)

    def day(self, session, rows, *, complete=True, legacy=False):
        ydir = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(ydir, exist_ok=True)
        fields = log.UNDERLYING_FIELDS
        if legacy:   # the first run's summary: no atm_dte, no front columns
            fields = ("underlying", "contracts", "call_oi", "put_oi", "underlying_price",
                      "atm_iv", "atm_expiration", "atm_strike")
        with gzip.open(os.path.join(ydir, f"{session}.underlyings.csv.gz"), "wt",
                       newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            for r in sorted(rows, key=lambda r: r["underlying"]):
                w.writerow(r)
        with open(os.path.join(ydir, f"{session}.manifest.json"), "w", encoding="utf-8") as fh:
            json.dump({"session": session, "complete": complete,
                       "reason": None if complete else "time budget 2400s reached"}, fh)


def row(sym, iv, *, px=100.0, dte=30, exp="2026-10-30", straddle=None, fexp=None, fdte=None):
    return {"underlying": sym, "contracts": 10, "call_oi": 1, "put_oi": 1,
            "underlying_price": px, "atm_iv": iv, "atm_expiration": exp, "atm_strike": px,
            "atm_dte": dte, "front_expiration": fexp, "front_dte": fdte,
            "front_strike": px if straddle else None, "front_straddle": straddle}


@pytest.fixture
def seed(tmp_path, monkeypatch):
    s = Seed(tmp_path)
    monkeypatch.setattr(svc, "_store_override", s.store)
    svc._ROW_CACHE.clear()
    return s


# ── the IV series ───────────────────────────────────────────────────────────────

def test_every_point_carries_its_date_and_atm_dte_and_coverage_is_stated(seed):
    for d, iv, dte in (("2026-09-30", 0.30, 30), ("2026-10-01", 0.31, 29), ("2026-10-02", 0.33, 28)):
        seed.day(d, [row("AAPL", iv, dte=dte), row("MSFT", 0.2)])
    out = svc.iv_history("AAPL", now=NOW)
    assert out["status"] == "ok"
    assert [(p["date"], p["atm_iv"], p["atm_dte"]) for p in out["points"]] == [
        ("2026-09-30", 0.30, 30), ("2026-10-01", 0.31, 29), ("2026-10-02", 0.33, 28)]
    assert out["logging_began"] == "2026-09-30" and out["covers_from"] == "2026-09-30"
    assert out["covers_to"] == "2026-10-02" and out["n"] == 3
    assert out["missing_sessions"] == [] and out["partial"] is False


def test_below_20_sessions_there_is_NO_rank_only_the_sentence(seed):
    days = trading_days("2026-09-01", 19)
    for i, d in enumerate(days):
        seed.day(d, [row("AAPL", 0.20 + i / 100)])
    out = svc.iv_history("AAPL", now=dt.datetime(2026, 9, 28, 18, 0, tzinfo=ET))
    assert out["n"] == 19
    assert out["rank"] is None
    assert out["rank_note"] == "19 sessions logged, rank needs 20."


def test_at_20_sessions_the_rank_and_percentile_are_served(seed):
    days = trading_days("2026-09-01", 20)
    ivs = [0.30, 0.20] + [0.25] * 17 + [0.28]     # current 0.28 between low 0.20 and high 0.30
    for d, iv in zip(days, ivs):
        seed.day(d, [row("AAPL", iv)])
    out = svc.iv_history("AAPL", now=dt.datetime(2026, 9, 29, 18, 0, tzinfo=ET))
    assert out["rank_note"] is None
    r = out["rank"]
    assert r["window_sessions"] == 20 and r["current"] == 0.28
    assert r["iv_rank"] == pytest.approx(80.0)                  # (0.28-0.20)/(0.30-0.20)
    assert r["iv_percentile"] == pytest.approx(18 / 19 * 100, abs=0.1)   # 18 of 19 prior below


def test_a_session_the_log_missed_is_a_GAP_named_in_words_never_filled(seed):
    seed.day("2026-09-30", [row("AAPL", 0.30)])
    seed.day("2026-10-02", [row("AAPL", 0.32)])
    out = svc.iv_history("AAPL", now=NOW)
    assert [p["date"] for p in out["points"]] == ["2026-09-30", "2026-10-02"]
    assert out["missing_sessions"] == ["2026-10-01"]
    assert out["partial"] is True
    assert any("2026-10-01" in s and "not logged" in s for s in out["partial_reasons"])


def test_todays_session_is_not_owed_before_the_log_is_due(seed):
    seed.day("2026-09-30", [row("AAPL", 0.30)])
    seed.day("2026-10-01", [row("AAPL", 0.31)])
    noon = dt.datetime(2026, 10, 2, 12, 0, tzinfo=ET)
    assert svc.iv_history("AAPL", now=noon)["missing_sessions"] == []
    assert svc.iv_history("AAPL", now=NOW)["missing_sessions"] == ["2026-10-02"]


def test_a_legacy_20_45_day_keeps_its_exact_dte_and_stays_OUT_of_the_rank(seed):
    seed.day("2026-09-30", [{"underlying": "AAPL", "contracts": 1, "call_oi": 1, "put_oi": 1,
                             "underlying_price": 333.8, "atm_iv": 0.238,
                             "atm_expiration": "2026-10-23", "atm_strike": 335}], legacy=True)
    seed.day("2026-10-01", [row("AAPL", 0.26)])
    seed.day("2026-10-02", [row("AAPL", 0.27)])
    out = svc.iv_history("AAPL", now=NOW)
    first = out["points"][0]
    assert first["rule"] == "legacy-20-45" and first["atm_dte"] == 23
    assert out["rank_note"] == "2 sessions logged, rank needs 20."      # the legacy day not counted
    assert any("20-45 day rule" in s for s in out["partial_reasons"])


def test_an_incomplete_day_is_said_and_a_symbol_with_no_iv_is_not_in_log(seed):
    seed.day("2026-09-30", [row("AAPL", 0.30)], complete=False)
    seed.day("2026-10-01", [row("AAPL", 0.31)])
    seed.day("2026-10-02", [row("AAPL", 0.32)])
    out = svc.iv_history("AAPL", now=NOW)
    assert any("incomplete on 2026-09-30" in s for s in out["partial_reasons"])
    gone = svc.iv_history("ZZZZ", now=NOW)
    assert gone["status"] == "not_in_log" and gone["points"] == [] and gone["partial"] is True
    assert "no ATM IV for ZZZZ" in gone["partial_reasons"][0]


def test_an_empty_log_says_so(seed):
    out = svc.iv_history("AAPL", now=NOW)
    assert out["status"] == "no_log" and out["rank"] is None and out["partial"] is True


# ── BRK-10: implied vs realized ─────────────────────────────────────────────────

def _prints(*dates):
    return lambda sym: [{"reportedDate": d, "reportTime": ""} for d in dates]


def test_with_no_logged_print_it_says_when_the_first_comparison_comes(seed):
    seed.day("2026-09-30", [row("AAPL", 0.30, straddle=5.0, fexp="2026-10-02", fdte=2)])
    called = []
    out = svc.implied_vs_realized(
        "AAPL", now=NOW, prints=_prints("2026-07-30", "2026-04-30"),
        realized=lambda s, q: called.append(1) or [3.0, 2.0])
    assert out["calibration"] is None and out["paired"] == 0
    assert out["calibration_note"] == "Logging began 2026-09-30; first comparison after the next print."
    assert out["prints_before_log"] == 2
    assert called == []          # nothing pairable: the realized source is never asked


def test_one_paired_print_is_listed_but_NO_calibration_is_drawn(seed):
    # print announced 2026-10-01 (timing unknown): the pre-print close is 09-30, the
    # front expiry (10-02) covers the after-hours reaction session (10-02)
    seed.day("2026-09-30", [row("AAPL", 0.30, px=200.0, straddle=8.0, fexp="2026-10-02", fdte=2)])
    seed.day("2026-10-01", [row("AAPL", 0.31)])
    seed.day("2026-10-02", [row("AAPL", 0.32)])
    out = svc.implied_vs_realized("AAPL", now=NOW, prints=_prints("2026-10-01"),
                                  realized=lambda s, q: [-5.0])
    (p,) = out["prints"]
    assert p["pre_print_session"] == "2026-09-30"
    assert p["implied_move_pct"] == 4.0 and p["realized_move_pct"] == -5.0
    assert p["ratio"] == 1.25 and p["inside"] is False
    assert out["paired"] == 1 and out["calibration"] is None
    assert out["calibration_note"] == "1 print compared; a reliability read needs 4."


def test_a_print_with_no_front_straddle_in_the_log_is_never_paired(seed):
    seed.day("2026-09-30", [row("AAPL", 0.30)])            # IV, but no two-sided straddle
    out = svc.implied_vs_realized("AAPL", now=NOW, prints=_prints("2026-10-01"),
                                  realized=lambda s, q: [2.0])
    (p,) = out["prints"]
    assert p["implied_move_pct"] is None and p["ratio"] is None
    assert "no two-sided front straddle" in p["note"]
    assert out["paired"] == 0 and out["calibration"] is None


def test_four_paired_prints_draw_the_reliability_summary(seed):
    days = trading_days("2026-06-01", 90)
    reports = [days[10], days[30], days[50], days[70]]
    for rd in reports:
        pre = days[days.index(rd) - 1]
        seed.day(pre, [row("AAPL", 0.3, px=100.0, straddle=5.0, fexp=days[days.index(rd) + 2], fdte=3)])
    moves = [2.0, -6.0, 4.0, -10.0]                       # newest-first, aligned with prints
    out = svc.implied_vs_realized("AAPL", now=NOW, prints=_prints(*reversed(reports)),
                                  realized=lambda s, q: moves)
    assert out["paired"] == 4
    cal = out["calibration"]
    assert cal["prints"] == 4
    assert cal["mean_ratio"] == pytest.approx((0.4 + 1.2 + 0.8 + 2.0) / 4, abs=0.01)
    assert cal["inside_share"] == 50.0
    assert out["calibration_note"] is None


# ── the doors ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


def test_dark_by_default_both_routes_answer_404(client, monkeypatch, seed):
    monkeypatch.delenv(FLAG, raising=False)
    with signed_in_as(PAID_MEMBER):
        for url in ("/api/research/iv-history/AAPL",
                    "/api/research/iv-history/AAPL/implied-vs-realized"):
            r = client.get(url)
            assert r.status_code == 404 and r.content == FASTAPI_404


def test_armed_it_is_paid_only_and_read_per_request(client, monkeypatch, seed):
    seed.day("2026-09-30", [row("AAPL", 0.30)])
    monkeypatch.setenv(FLAG, "1")
    with signed_in_as(FREE_MEMBER):
        assert client.get("/api/research/iv-history/AAPL").status_code == 402
    with signed_in_as(PAID_MEMBER):
        r = client.get("/api/research/iv-history/aapl")
        assert r.status_code == 200 and r.json()["symbol"] == "AAPL"
        assert client.get("/api/research/iv-history/$$$").status_code == 422
        monkeypatch.setenv(FLAG, "0")
        assert client.get("/api/research/iv-history/AAPL").status_code == 404


def test_an_unreadable_store_is_a_503_never_an_empty_history(client, monkeypatch):
    class Broken(svc.LocalStore):
        def sessions(self):
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    monkeypatch.setattr(svc, "_store_override", Broken("x"))
    monkeypatch.setenv(FLAG, "1")
    with signed_in_as(PAID_MEMBER):
        r = client.get("/api/research/iv-history/AAPL")
    assert r.status_code == 503 and "options log is unavailable" in r.json()["detail"]
