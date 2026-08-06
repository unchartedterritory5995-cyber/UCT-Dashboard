"""Tests for the research estimates service + router."""
import pandas as pd

from api.services.research import estimates as est
from api.services.cache import cache


class TestForward:
    def test_forward_rows_and_growth_pct(self):
        eps = pd.DataFrame(
            {"numberOfAnalysts": [12, 13], "avg": [2.10, 9.20], "low": [2.0, 9.0],
             "high": [2.2, 9.5], "growth": [0.15, 0.08]},
            index=["0q", "0y"],
        )
        rev = pd.DataFrame({"avg": [9.5e10, 4.0e11]}, index=["0q", "0y"])
        rows = est._forward(eps, rev)
        assert len(rows) == 2
        cq = rows[0]
        assert cq["period"] == "Current Qtr"
        assert cq["eps_avg"] == 2.10
        assert cq["num_analysts"] == 12
        assert cq["eps_growth"] == 15.0  # 0.15 -> 15%
        assert cq["rev_avg"] == 9.5e10

    def test_skips_empty_periods(self):
        eps = pd.DataFrame({"avg": [2.0]}, index=["0q"])
        rows = est._forward(eps, None)
        assert [r["period"] for r in rows] == ["Current Qtr"]


class TestRevisions:
    def test_revision_trend_and_counts(self):
        trend = pd.DataFrame(
            {"current": [2.10], "30daysAgo": [2.05], "90daysAgo": [1.95]},
            index=["0q"],
        )
        revs = pd.DataFrame({"upLast30days": [5], "downLast30days": [1]}, index=["0q"])
        rows = est._revisions(trend, revs)
        assert rows[0]["current"] == 2.10
        assert rows[0]["ago90"] == 1.95
        assert rows[0]["up30"] == 5
        assert rows[0]["down30"] == 1


class TestRatingChanges:
    def test_sorted_newest_first(self):
        df = pd.DataFrame(
            {"Firm": ["A", "B"], "ToGrade": ["Buy", "Hold"], "FromGrade": ["Hold", "Buy"],
             "Action": ["up", "down"]},
            index=pd.to_datetime(["2026-01-01", "2026-05-01"]),
        )
        rows = est._rating_changes(df)
        assert rows[0]["date"] == "2026-05-01"  # newest first
        assert rows[0]["firm"] == "B"
        assert rows[0]["action"] == "down"

    def test_empty(self):
        assert est._rating_changes(None) == []


class TestGetEstimatesCachePolicy:
    def setup_method(self):
        cache.invalidate("research_est::TEST")

    def _captured_ttl(self, monkeypatch, *, fetch, grades):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "research_est::TEST":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        monkeypatch.setattr(est, "_fetch", fetch)
        monkeypatch.setattr(est, "get_analyst_grades", grades)
        monkeypatch.setattr(cache, "set", spy)
        out = est.get_estimates("test")
        return out, seen.get("ttl")

    def _yf_empty_but_ok(self, s):
        # A SUCCESSFUL yfinance pool call always returns a 5-key dict (see
        # `_fetch`'s `_do()`) -- even a ticker with no analyst data yields
        # this shape, never a bare `{}`. Only the exception path returns `{}`.
        return {"eps_est": None, "rev_est": None, "eps_trend": None, "eps_rev": None, "ud": None}

    def test_a_complete_fetch_is_cached_for_the_full_12h_ttl(self, monkeypatch):
        out, ttl = self._captured_ttl(
            monkeypatch, fetch=self._yf_empty_but_ok, grades=lambda s: {"consensus": "Buy"},
        )
        assert out["consensus"] == "Buy"
        assert ttl == est._CACHE_TTL

    def test_yfinance_fetch_failure_shortens_the_ttl_not_12h(self, monkeypatch):
        """THE regression: a yfinance pool timeout used to still cache the
        (forward=[], revisions=[]) result for the full 12 hours even though
        the FMP grades leg answered fine."""
        out, ttl = self._captured_ttl(
            monkeypatch, fetch=lambda s: {}, grades=lambda s: {"consensus": "Hold"},
        )
        assert out["consensus"] == "Hold"    # good leg still served
        assert out["forward"] == []
        assert ttl == est._FAIL_TTL
        assert ttl < est._CACHE_TTL

    def test_grades_failure_also_shortens_the_ttl(self, monkeypatch):
        eps = pd.DataFrame({"avg": [2.0]}, index=["0q"])
        def _boom(s):
            raise RuntimeError("fmp down")
        out, ttl = self._captured_ttl(
            monkeypatch, fetch=lambda s: {"eps_est": eps}, grades=_boom,
        )
        assert out["forward"]            # good leg still served
        assert out["consensus"] is None
        assert ttl == est._FAIL_TTL

    def test_a_ticker_with_no_analyst_coverage_is_not_a_failure(self, monkeypatch):
        """get_analyst_grades legitimately returning nothing (no coverage) is
        NOT the same as a failure -- must still get the full 12h TTL."""
        out, ttl = self._captured_ttl(
            monkeypatch, fetch=self._yf_empty_but_ok, grades=lambda s: None,
        )
        assert out["consensus"] is None
        assert ttl == est._CACHE_TTL


class TestRoute:
    def setup_method(self):
        cache.invalidate("research_est::AAPL")

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_estimates", lambda sym: {
            "sym": sym.upper(), "forward": [], "revisions": [], "rating_changes": [],
        })
        r = self._client().get("/api/research/estimates/AAPL")
        assert r.status_code == 200
        assert set(r.json().keys()) == {"sym", "forward", "revisions", "rating_changes"}
