"""COV-01 seasonality: the computation (hand-checked) and the dark route."""
import datetime as dt

import pytest

from api.services import seasonality as svc


def _bars(pairs):
    return [{"t": d, "c": c} for d, c in pairs]


def _month_ends(start_year, months, closes):
    """One bar on the 15th and one on the 28th of each month (the 28th is the month-end)."""
    out = []
    y, m = start_year, 1
    for i in range(months):
        out.append((f"{y:04d}-{m:02d}-15", closes[i] * 0.99))
        out.append((f"{y:04d}-{m:02d}-28", closes[i]))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


class TestCompute:
    def test_monthly_returns_are_month_end_to_month_end(self):
        # Jan 100, Feb 110, Mar 99, Apr 100 (Apr is the last month held: not counted)
        out = svc.compute(_bars(_month_ends(2020, 4, [100, 110, 99, 100])))
        by = {r["label"]: r for r in out["months"]}
        assert by["Feb"]["n"] == 1 and by["Feb"]["avg_pct"] == pytest.approx(10.0)
        assert by["Mar"]["avg_pct"] == pytest.approx(-10.0)
        assert by["Jan"]["n"] == 0          # the first month is only a base, never a return
        assert by["Apr"]["n"] == 0          # the last month held is not counted
        assert out["full_months"] == 2

    def test_thin_months_are_marked_not_dropped(self):
        out = svc.compute(_bars(_month_ends(2020, 4, [100, 110, 99, 100])))
        assert all(r["thin"] for r in out["months"])     # 1 year < MIN_YEARS
        assert len(out["months"]) == 12

    def test_a_gap_in_the_record_is_not_a_monthly_return(self):
        pairs = [("2020-01-28", 100), ("2020-03-28", 150), ("2020-04-28", 150), ("2020-05-28", 150)]
        out = svc.compute(_bars(pairs))
        by = {r["label"]: r for r in out["months"]}
        assert by["Mar"]["n"] == 0          # Jan -> Mar skips Feb: not a one-month return
        assert by["Apr"]["n"] == 1

    def test_weekday_returns_and_pct_up(self):
        # Mon 2026-09-28 .. Fri 2026-10-02, preceded by Fri 09-25
        pairs = [("2026-09-25", 100), ("2026-09-28", 101), ("2026-09-29", 100), ("2026-09-30", 100),
                 ("2026-10-01", 102), ("2026-10-02", 102)]
        out = svc.compute(_bars(pairs))
        wd = {r["label"]: r for r in out["weekdays"]}
        assert wd["Mon"]["n"] == 1 and wd["Mon"]["avg_pct"] == pytest.approx(1.0)
        assert wd["Mon"]["pct_up"] == 100 and wd["Wed"]["pct_up"] == 0
        assert out["covered_from"] == "2026-09-25" and out["covered_to"] == "2026-10-02"

    def test_yyyymmdd_ints_and_junk_are_handled(self):
        out = svc.compute([{"t": 20260925, "c": 100}, {"t": 20260928, "c": 101},
                           {"t": "nonsense", "c": 5}, {"t": "2026-09-29", "c": None}])
        assert out["covered_from"] == "2026-09-25" and out["covered_to"] == "2026-09-28"

    def test_short_or_empty_series_never_raises(self):
        assert svc.compute([])["months"] == []
        assert svc.compute(None)["weekdays"] == []
        assert svc.compute([{"t": "2026-09-25", "c": 1}])["covered_from"] is None


class TestRoute:
    @pytest.fixture
    def client(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import seasonality as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        route, c = client
        monkeypatch.delenv("SEASONALITY_ENABLED", raising=False)
        assert c.get("/api/research/seasonality/NVDA").status_code == 404

    def test_armed_serves_the_computation_with_its_source(self, client, monkeypatch):
        route, c = client
        monkeypatch.setenv("SEASONALITY_ENABLED", "1")
        monkeypatch.setattr(route, "_daily_bars",
                            lambda s: _bars(_month_ends(2020, 4, [100, 110, 99, 100])))
        r = c.get("/api/research/seasonality/nvda")
        assert r.status_code == 200
        body = r.json()
        assert body["ticker"] == "NVDA" and body["source"].startswith("UCT daily bar store")
        assert len(body["months"]) == 12 and len(body["weekdays"]) == 5

    def test_no_bars_is_unavailable_not_an_empty_table(self, client, monkeypatch):
        route, c = client
        monkeypatch.setenv("SEASONALITY_ENABLED", "1")
        monkeypatch.setattr(route, "_daily_bars", lambda s: [])
        r = c.get("/api/research/seasonality/NVDA")
        assert r.status_code == 503 and "unavailable" in r.json()["detail"]

    def test_a_non_ticker_is_refused(self, client, monkeypatch):
        route, c = client
        monkeypatch.setenv("SEASONALITY_ENABLED", "1")
        assert c.get("/api/research/seasonality/NV%3BDA").status_code == 400

    def test_the_handler_is_sync(self, client):
        import inspect
        route, _ = client
        assert not inspect.iscoroutinefunction(route.seasonality)

    def test_the_auth_payload_reads_the_same_switch(self, monkeypatch):
        from api.routers import auth
        monkeypatch.setenv("SEASONALITY_ENABLED", "1")
        assert auth._seasonality_enabled() is True
        monkeypatch.setenv("SEASONALITY_ENABLED", "0")
        assert auth._seasonality_enabled() is False


class TestPartialColdRead:
    """L8: a cold read handed back the store's shallow tail (covered_from 2024-09-16,
    n=2) while the warm call covers 2021+. That partial read is never computed."""

    def _serve(self, monkeypatch, n):
        import json as _json
        from api.routers import bars as bars_router

        class _Resp:
            status_code = 200
            body = _json.dumps({"bars": _bars(_month_ends(2024, n, [100 + i for i in range(n)]))}).encode()
        monkeypatch.setattr(bars_router, "serve_bars", lambda *a, **k: _Resp())

    def test_a_partial_read_without_the_complete_marker_is_pending(self, monkeypatch):
        from api.routers import seasonality as route
        from api.services import bars_fetch
        self._serve(monkeypatch, 12)
        monkeypatch.setattr(bars_fetch, "_history_complete", lambda t, tf: False)
        with pytest.raises(route.HistoryPending):
            route._daily_bars("NVDA")

    def test_a_short_listing_whose_full_history_is_read_is_served(self, monkeypatch):
        from api.routers import seasonality as route
        from api.services import bars_fetch
        self._serve(monkeypatch, 12)
        monkeypatch.setattr(bars_fetch, "_history_complete", lambda t, tf: (t, tf) == ("NVDA", "D"))
        assert len(route._daily_bars("NVDA")) == 24          # two bars a month

    def test_the_route_answers_503_with_retry_after_and_says_why(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import seasonality as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        monkeypatch.setenv("SEASONALITY_ENABLED", "1")

        def pending(s):
            raise route.HistoryPending(s)
        monkeypatch.setattr(route, "_daily_bars", pending)
        r = TestClient(app).get("/api/research/seasonality/NVDA")
        assert r.status_code == 503 and r.headers.get("retry-after") == "15"
        assert "still being read" in r.json()["detail"]
