"""FT-071 estimates by contributor: periods built from a RECORDED FMP
`/stable/analyst-estimates?period=quarter` answer for AAPL (recorded by lane
cov-05-07-09 at 303c83ea8, copied with provenance to tests/fixtures/
broker_estimates), the contributor refusal, the cache-only request path and the
dark route. No network: the vendor read is replaced by the recording."""
from __future__ import annotations

import inspect
import json
import threading
import time
from pathlib import Path

import pytest

from api.services import broker_estimates as be

FIX = Path(__file__).resolve().parent / "fixtures" / "broker_estimates" / "fmp_analyst_estimates_quarter_AAPL.json"
ROWS = json.loads(FIX.read_text(encoding="utf-8"))
# AAPL reported its quarter ending 2026-03-28 on 2026-04-30.
LAST_REPORT = "2026-04-30"


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    be._cache.clear()
    be._queued.clear()
    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(be, "_fetch_last_report", lambda s: LAST_REPORT)
    monkeypatch.setattr(be, "_fetch_grades", lambda s: None)
    yield
    be._cache.clear()
    be._queued.clear()


class TestPeriods:
    def test_upcoming_quarters_soonest_first_with_n_beside_the_mean(self):
        ps = be.periods(ROWS, today="2026-06-01", last_report=LAST_REPORT)
        assert [p["period_end"] for p in ps][:3] == ["2026-06-27", "2026-09-27", "2026-12-27"]
        first = ps[0]
        assert first["eps"]["mean"] == pytest.approx(1.89188) and first["eps"]["n"] == 20
        assert first["revenue"]["n"] == 17
        assert first["eps"]["dispersion_pct"] == pytest.approx(round((1.9422 - 1.85163) / 1.89188 * 100, 1))

    def test_reported_quarters_are_dropped_and_the_cap_holds(self):
        ps = be.periods(ROWS, today="2026-06-01", limit=3, last_report=LAST_REPORT)
        assert len(ps) == 3 and all(p["period_end"] >= LAST_REPORT for p in ps)

    def test_R3_a_quarter_that_ENDED_but_has_not_reported_stays(self):
        # Mid-July: the June quarter's period end has passed, but AAPL reports
        # it at the end of July. It is the NEXT quarter to report, and the old
        # `end < today` rule dropped it for the whole earnings season.
        ps = be.periods(ROWS, today="2026-07-15", last_report=LAST_REPORT)
        assert ps[0]["period_end"] == "2026-06-27"

    def test_R3_and_it_leaves_once_it_has_reported(self):
        ps = be.periods(ROWS, today="2026-08-05", last_report="2026-07-30")
        assert ps[0]["period_end"] == "2026-09-27"

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
        be._cache["AAPL"] = (time.time(), 600, None)
        assert be.view("AAPL")["state"] == "unavailable"

    def test_the_as_of_is_the_cache_fill_time_never_now(self, monkeypatch):
        """TERM-019: the panel header dates the consensus by when it was READ from FMP."""
        be._cache["AAPL"] = (1790000000.0, 10 ** 9, None)
        out = be.view("AAPL")
        assert out["read_at"] == 1790000000.0
        assert out["as_of"] == "2026-09-21T14:13:20+00:00"
        del be._cache["AAPL"]
        monkeypatch.setattr(be, "_schedule", lambda sym: False)
        assert "as_of" not in be.view("AAPL", today="2026-06-01")      # pending: undated

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


class TestPlanGated:
    """R4: a plan refusal is its own state, held briefly, never `rows=[]`."""

    def _result(self, value, degraded=None):
        from api.services import provider_errors as pe
        return pe.ProviderResult(value=value, provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="t"),
                                 licensing_class=None, freshness="end_of_day", degraded=degraded)

    def test_the_cached_forbidden_window_raises_PlanGated_not_an_empty_list(self, monkeypatch):
        from api.services import fmp_client
        monkeypatch.setattr(fmp_client, "get_analyst_estimates",
                            lambda *a, **k: self._result(None, degraded="cached_forbidden"))
        with pytest.raises(be.PlanGated):
            be._fetch_rows("AAPL")

    def test_a_403_raises_PlanGated(self, monkeypatch):
        from api.services import fmp_client

        def deny(*a, **k):
            raise fmp_client._ERR.auth_error("FMP rejected (403)", status=403)
        monkeypatch.setattr(fmp_client, "get_analyst_estimates", deny)
        with pytest.raises(be.PlanGated):
            be._fetch_rows("AAPL")

    def test_an_answered_empty_symbol_is_an_empty_list(self, monkeypatch):
        from api.services import fmp_client

        def nf(*a, **k):
            raise fmp_client._ERR.not_found("no data")
        monkeypatch.setattr(fmp_client, "get_analyst_estimates", nf)
        assert be._fetch_rows("ZZZZ") == []

    def test_plan_gated_is_stored_briefly_and_shown_with_its_reason(self, monkeypatch):
        def gated(sym):
            raise be.PlanGated("403")
        monkeypatch.setattr(be, "_fetch_rows", gated)
        be._read("AAPL")
        read_at, ttl, payload = be._cache["AAPL"]
        assert ttl == be._TTL_FAIL and payload["state"] == "plan_gated"
        out = be.view("AAPL")
        assert out["state"] == "plan_gated" and out["reason"] == be.PLAN_GATED_REASON
        assert "periods" not in out

    def test_the_estimates_gate_off_never_reads_and_says_so(self, monkeypatch):
        monkeypatch.setenv("BROKER_ESTIMATES_ENABLED", "1")
        monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "0")
        monkeypatch.setattr(be, "_fetch_rows", lambda s: pytest.fail("vendor read with the gate off"))
        out = be.view("AAPL")
        assert out["state"] == "gated" and out["queued"] is False and out["reason"] == be.GATED_REASON


class TestOwnFirmsRead:
    """R5: BRKE reads the firms itself instead of waiting for ANR to fill a key."""

    def test_the_worker_reads_grades_and_the_view_shows_them_with_a_cold_shared_cache(self, monkeypatch):
        from api.services import cache as cache_mod
        monkeypatch.setattr(cache_mod.cache, "get", lambda k: None)
        monkeypatch.setattr(be, "_fetch_rows", lambda s: ROWS)
        monkeypatch.setattr(be, "_fetch_grades", lambda s: {"recent_actions": {"items": [
            {"date": "2026-09-30", "company": "Jefferies", "action": "up"}]}})
        be._read("AAPL")
        out = be.view("AAPL", today="2026-06-01")
        assert out["state"] == "ok"
        assert out["firms"]["state"] == "ok" and out["firms"]["actions"][0]["firm"] == "Jefferies"

    def test_a_failed_grades_read_does_not_fail_the_consensus(self, monkeypatch):
        monkeypatch.setattr(be, "_fetch_rows", lambda s: ROWS)

        def boom(s):
            raise RuntimeError("grades down")
        monkeypatch.setattr(be, "_fetch_grades", boom)
        be._read("AAPL")
        assert be.view("AAPL", today="2026-06-01")["state"] == "ok"

    def test_without_a_report_date_the_answer_is_held_only_briefly(self, monkeypatch):
        monkeypatch.setattr(be, "_fetch_rows", lambda s: ROWS)
        monkeypatch.setattr(be, "_fetch_last_report", lambda s: None)
        be._read("AAPL")
        assert be._cache["AAPL"][1] == be._TTL_FAIL


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
