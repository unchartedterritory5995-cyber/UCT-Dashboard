"""FT-071 estimates by contributor: periods built from a RECORDED FMP
`/stable/analyst-estimates?period=quarter` answer for AAPL (recorded by lane
cov-05-07-09 at 303c83ea8, copied with provenance to tests/fixtures/
broker_estimates), the contributor refusal, the cache-only request path and the
dark route. No network: the vendor read is replaced by the recording."""
from __future__ import annotations

import inspect
import json
import threading
from pathlib import Path

import pytest

from api.services import broker_estimates as be

FIX = Path(__file__).resolve().parent / "fixtures" / "broker_estimates" / "fmp_analyst_estimates_quarter_AAPL.json"
ROWS = json.loads(FIX.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def clean():
    be._cache.clear()
    be._queued.clear()
    yield
    be._cache.clear()
    be._queued.clear()


class TestPeriods:
    def test_upcoming_quarters_soonest_first_with_n_beside_the_mean(self):
        ps = be.periods(ROWS, today="2026-06-01")
        assert [p["period_end"] for p in ps][:3] == ["2026-06-27", "2026-09-27", "2026-12-27"]
        first = ps[0]
        assert first["eps"]["mean"] == pytest.approx(1.89188) and first["eps"]["n"] == 20
        assert first["revenue"]["n"] == 17
        assert first["eps"]["dispersion_pct"] == pytest.approx(round((1.9422 - 1.85163) / 1.89188 * 100, 1))

    def test_past_quarters_are_dropped_and_the_cap_holds(self):
        ps = be.periods(ROWS, today="2026-06-01", limit=3)
        assert len(ps) == 3 and all(p["period_end"] >= "2026-06-01" for p in ps)

    def test_a_zero_mean_has_no_dispersion(self):
        assert be._dispersion(-0.1, 0.1, 0.0) is None


class TestView:
    def test_a_miss_is_pending_and_the_read_runs_off_the_request(self, monkeypatch):
        monkeypatch.setenv("BROKER_ESTIMATES_ENABLED", "1")
        gate, ran_on = threading.Event(), []

        def slow(sym):
            ran_on.append(threading.current_thread().name)
            gate.wait(5)
            return ROWS
        monkeypatch.setattr(be, "_fetch_rows", slow)
        first = be.view("aapl", today="2026-06-01")
        assert first["state"] == "pending" and first["queued"] is True
        gate.set()
        be._executor.submit(lambda: None).result(5)
        assert ran_on[0].startswith("broker-estimates")
        got = be.view("AAPL", today="2026-06-01")
        assert got["state"] == "ok" and got["periods"][0]["eps"]["n"] == 20 and got["read_at"]

    def test_contributors_are_refused_with_the_reason_and_the_merge_point_is_named(self, monkeypatch):
        out = be.view("AAPL")
        assert out["contributors"] == {"state": "unavailable", "reason": be.CONTRIBUTORS_REASON}
        assert "estimate_history" in out["merge_point"]

    def test_a_failed_read_is_unavailable(self, monkeypatch):
        import time
        be._cache["AAPL"] = (time.time(), 600, None)
        assert be.view("AAPL")["state"] == "unavailable"

    def test_named_firms_come_from_the_cached_ratings_read_only(self, monkeypatch):
        from api.services import cache as cache_mod
        store = {"analyst_grades_AAPL": {"recent_actions": {"items": [
            {"date": "2026-09-30", "company": "Morgan Stanley", "action": "maintain", "from_grade": "Overweight",
             "to_grade": "Overweight"},
            {"date": "2026-09-29", "company": "", "action": "up"}]}}}
        monkeypatch.setattr(cache_mod.cache, "get", lambda k: store.get(k))
        firms = be._firms("AAPL")
        assert firms["state"] == "ok" and [a["firm"] for a in firms["actions"]] == ["Morgan Stanley"]
        assert be._firms("MSFT")["state"] == "not_loaded"

    def test_dark_never_queues(self, monkeypatch):
        monkeypatch.delenv("BROKER_ESTIMATES_ENABLED", raising=False)
        monkeypatch.setattr(be, "_fetch_rows", lambda s: pytest.fail("vendor read while dark"))
        assert be.view("AAPL")["queued"] is False


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
        monkeypatch.delenv("BROKER_ESTIMATES_ENABLED", raising=False)
        assert c.get("/api/research/broker-estimates/AAPL").status_code == 404

    def test_armed_serves_the_view(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("BROKER_ESTIMATES_ENABLED", "1")
        monkeypatch.setattr(be, "view", lambda s: {"ticker": s, "state": "pending"})
        r = c.get("/api/research/broker-estimates/aapl")
        assert r.status_code == 200 and r.json()["ticker"] == "AAPL"

    def test_the_handler_is_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.broker_estimates_route)
        monkeypatch.delenv("BROKER_ESTIMATES_ENABLED", raising=False)
        assert "broker_estimates_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("BROKER_ESTIMATES_ENABLED", "1")
        assert auth._research_depth_flags()["broker_estimates_enabled"] is True
