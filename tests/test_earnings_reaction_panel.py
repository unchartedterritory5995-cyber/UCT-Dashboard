"""FT-005 earnings-reaction panel: hand-checked arithmetic on a built bar series
(the same idiom as tests/test_earnings_reaction.py), the cache-only request
path, the off-request implied-move read, and the dark route. No network."""
from __future__ import annotations

import inspect
import threading
from datetime import date, timedelta

import pytest

from api.services import earnings_reaction_panel as p


def _sessions(n, start=date(2026, 1, 5)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _bars():
    """31 sessions. Closes 100..109 for sessions 0-9; session 10 GAPS to 120 and
    closes 121 (the reacting session); then +1 a day. Every other session opens
    at the prior close, so only session 10 has a gap."""
    days = _sessions(31)
    closes = [100 + i for i in range(10)] + [121 + (i - 10) for i in range(10, 31)]
    bars = []
    for i, d in enumerate(days):
        o = closes[i - 1] if i else closes[0]
        if i == 10:
            o = 120
        bars.append({"t": d, "o": o, "c": closes[i]})
    return bars, days


def _q(label, day, **kw):
    return {"label": label, "report_date": day, "reported": True, "eps_actual": 1.0, "eps_estimate": 0.9, **kw}


class TestRows:
    def test_each_leg_is_measured_on_the_reacting_session(self):
        bars, days = _bars()
        (row,) = p.quarter_rows([_q("Q1", days[10])], bars)
        assert row["session"] == days[10]
        assert row["run_in_pct"] == pytest.approx(round((109 / 104 - 1) * 100, 2))
        assert row["gap_pct"] == pytest.approx(round((120 / 109 - 1) * 100, 2))
        assert row["reaction_pct"] == pytest.approx(round((121 / 109 - 1) * 100, 2))
        assert row["drift_pct"] == pytest.approx(round((126 / 121 - 1) * 100, 2))
        assert row["drift_state"] == "measured"

    def test_a_post_close_report_is_answered_by_the_next_session(self):
        bars, days = _bars()
        (row,) = p.quarter_rows([_q("Q1", days[9])], bars)     # reported the day before the gap
        assert row["session"] == days[10]

    def test_a_drift_that_has_not_traded_yet_is_pending_not_zero(self):
        bars, days = _bars()
        (row,) = p.quarter_rows([_q("Q2", days[28])], bars)
        assert row["drift_pct"] is None and row["drift_state"] == "pending"
        assert row["reaction_pct"] is not None

    def test_R22_a_report_on_the_LAST_session_waits_for_the_next_one(self):
        # An after-close report on the newest bar: that bar is the PRE-print
        # session. It must not be shown as the reaction until the next session
        # has traded.
        bars, days = _bars()
        (row,) = p.quarter_rows([_q("Q3", days[30])], bars)
        assert row["session"] is None and row["reaction_pct"] is None and row["gap_pct"] is None
        assert row["reaction_state"] == "awaiting_next_session"

    def test_R22_once_the_next_session_trades_the_reaction_is_measured(self):
        bars, days = _bars()
        (row,) = p.quarter_rows([_q("Q1", days[9])], bars)
        assert row["reaction_state"] == "measured" and row["session"] == days[10]

    def test_a_quarter_outside_the_bars_keeps_its_slot(self):
        bars, days = _bars()
        rows = p.quarter_rows([_q("Q2", days[10]), _q("Q1", "2019-01-02")], bars)
        assert [r["quarter"] for r in rows] == ["Q1", "Q2"]           # newest LAST
        assert rows[0]["reaction_pct"] is None and rows[0]["session"] is None

    def test_the_summary_carries_its_n(self):
        assert p._stat([1.0, -3.0, None]) == {"n": 2, "avg": -1.0, "avg_abs": 2.0, "median": -1.0, "pct_up": 50}
        assert p._stat([None])["n"] == 0

    def test_realized_vol_needs_a_full_window(self):
        bars, _ = _bars()
        assert p.realized_vol(bars[:5]) is None
        rv = p.realized_vol(bars)
        assert rv["sessions"] == 20 and rv["annualized_pct"] > 0 and rv["through"] == bars[-1]["t"]


class TestPanel:
    def test_cache_miss_schedules_the_rebuild_and_answers_pending(self, monkeypatch):
        from api.services import earnings_intel as ei
        monkeypatch.setattr(ei.cache, "get", lambda k: None)
        monkeypatch.setattr(ei.snap_store, "get", lambda kind, s: None)
        scheduled = []
        monkeypatch.setattr(ei, "_schedule_refresh", lambda s: scheduled.append(s))
        monkeypatch.setattr(p.er, "_daily_bars", lambda *a: pytest.fail("bars read on a cache miss"))
        out = p.panel("nvda")
        assert out["state"] == "pending" and scheduled == ["NVDA"]

    def test_ok_payload_names_its_source_and_method(self, monkeypatch):
        bars, days = _bars()
        monkeypatch.setattr(p, "_cached_earnings", lambda s: {"quarters": [_q("Q1", days[10])],
                                                                "summary": {"next_report_date": "2026-04-30"}})
        monkeypatch.setattr(p.er, "_daily_bars", lambda s, since: bars)
        monkeypatch.setattr(p, "implied_snapshot", lambda s, n: {"state": "pending"})
        out = p.panel("X")
        assert out["state"] == "ok" and out["summary"]["reaction"]["n"] == 1
        assert out["next_report_date"] == "2026-04-30" and out["source"].startswith("UCT daily bar store")
        assert set(out["method"]) == {"run_in", "gap", "reaction", "drift", "reacting_session"}

    def test_no_reported_quarter_is_a_stated_state(self, monkeypatch):
        monkeypatch.setattr(p, "_cached_earnings", lambda s: {"quarters": [{"reported": False}]})
        assert p.panel("X")["state"] == "no_reports"


class TestImplied:
    def test_the_vendor_read_never_runs_in_the_request(self, monkeypatch):
        from api.services import earnings_enrichment as ee
        monkeypatch.setenv("EARNINGS_REACTION_PANEL_ENABLED", "1")
        p._implied.clear()
        p._queued.clear()
        gate, ran_on = threading.Event(), []

        def slow(sym, d, timing=None):
            ran_on.append(threading.current_thread().name)
            gate.wait(5)
            return {"pct": 6.2, "dollar": 8.1, "expiry": "2026-05-01", "strike": 130.0,
                    "spot": 131.0, "call_mark": 4.2, "put_mark": 3.9}
        monkeypatch.setattr(ee, "get_implied_move", slow)
        from api.services import implied_move as im
        monkeypatch.setattr(im, "report_timing", lambda s, d: None)   # no vendor call
        first = p.implied_snapshot("ZZTEST", "2026-04-30")
        assert first["state"] == "pending"
        gate.set()
        p._executor.submit(lambda: None).result(5)       # the worker has drained
        assert ran_on and ran_on[0].startswith("earn-implied")
        got = p.implied_snapshot("ZZTEST", "2026-04-30")
        assert got["state"] == "ok" and got["strike"] == 130.0 and got["read_at"]

    def test_a_failed_read_is_unavailable_with_a_reason(self, monkeypatch):
        p._implied["ZZFAIL"] = (__import__("time").time(), None)
        out = p.implied_snapshot("ZZFAIL", None)
        assert out["state"] == "unavailable" and "option chain" in out["reason"]

    def test_dark_never_queues(self, monkeypatch):
        monkeypatch.delenv("EARNINGS_REACTION_PANEL_ENABLED", raising=False)
        p._implied.pop("ZZDARK", None)
        assert p.implied_snapshot("ZZDARK", None) == {"state": "pending"}
        assert "ZZDARK" not in p._queued


class TestRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("EARNINGS_REACTION_PANEL_ENABLED", raising=False)
        assert c.get("/api/research/earnings-reaction/NVDA").status_code == 404

    def test_armed_serves_the_panel(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("EARNINGS_REACTION_PANEL_ENABLED", "1")
        monkeypatch.setattr(p, "panel", lambda s: {"ticker": s, "state": "pending"})
        r = c.get("/api/research/earnings-reaction/nvda")
        assert r.status_code == 200 and r.json() == {"ticker": "NVDA", "state": "pending"}

    def test_the_handler_is_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.earnings_reaction_route)
        monkeypatch.delenv("EARNINGS_REACTION_PANEL_ENABLED", raising=False)
        assert "earnings_reaction_panel_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("EARNINGS_REACTION_PANEL_ENABLED", "1")
        assert auth._research_depth_flags()["earnings_reaction_panel_enabled"] is True
