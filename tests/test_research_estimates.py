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
