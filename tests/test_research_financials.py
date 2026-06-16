"""Tests for the research financials service + router."""
import pandas as pd
import pytest

from api.services.research import financials as fin
from api.services.cache import cache


def _income_df(cols_values):
    """Build a yfinance-style income_stmt DataFrame.

    cols_values: list of (period_end_str, {row_label: value}) newest-first.
    """
    cols = [pd.Timestamp(c) for c, _ in cols_values]
    rows = {}
    for label in ["Total Revenue", "Gross Profit", "Operating Income", "Net Income", "Diluted EPS"]:
        rows[label] = [vals.get(label) for _, vals in cols_values]
    return pd.DataFrame(rows, index=cols).T  # index=labels, columns=dates


class TestIncomeGrid:
    def test_annual_margins_and_yoy(self):
        df = _income_df([
            ("2024-12-31", {"Total Revenue": 1000.0, "Gross Profit": 400.0, "Operating Income": 300.0, "Net Income": 250.0, "Diluted EPS": 6.0}),
            ("2023-12-31", {"Total Revenue": 800.0, "Gross Profit": 320.0, "Operating Income": 240.0, "Net Income": 200.0, "Diluted EPS": 5.0}),
        ])
        grid = fin._income_grid(df, 5, quarterly=False)
        assert len(grid) == 2
        top = grid[0]
        assert top["period"] == "2024"
        assert top["revenue"] == 1000.0
        assert top["gross_margin"] == 40.0
        assert top["operating_margin"] == 30.0
        assert top["net_margin"] == 25.0
        # YoY vs 2023: revenue (1000-800)/800 = 25%, eps (6-5)/5 = 20%
        assert top["revenue_yoy"] == 25.0
        assert top["eps_yoy"] == 20.0
        # Oldest row has no prior year → no YoY
        assert grid[1]["revenue_yoy"] is None

    def test_quarterly_yoy_compares_four_back(self):
        # 5 quarters newest-first; Q4-2024 should compare to Q4-2023 (index 4), not Q3-2024
        cols = [
            ("2024-12-31", {"Total Revenue": 1100.0, "Diluted EPS": 2.2}),
            ("2024-09-30", {"Total Revenue": 1050.0, "Diluted EPS": 2.1}),
            ("2024-06-30", {"Total Revenue": 1000.0, "Diluted EPS": 2.0}),
            ("2024-03-31", {"Total Revenue": 950.0, "Diluted EPS": 1.9}),
            ("2023-12-31", {"Total Revenue": 1000.0, "Diluted EPS": 2.0}),
        ]
        df = _income_df(cols)
        grid = fin._income_grid(df, 8, quarterly=True)
        top = grid[0]
        assert top["period"] == "Q4 2024"
        # (1100-1000)/1000 = 10%, eps (2.2-2.0)/2.0 = 10%
        assert top["revenue_yoy"] == 10.0
        assert top["eps_yoy"] == 10.0

    def test_empty_or_none(self):
        assert fin._income_grid(None, 5, False) == []
        assert fin._income_grid(pd.DataFrame(), 5, False) == []


class TestGetFinancials:
    def setup_method(self):
        cache.invalidate("research_fin::TEST")

    def test_shape_and_cache(self, monkeypatch):
        df = _income_df([
            ("2024-12-31", {"Total Revenue": 1000.0, "Gross Profit": 400.0, "Operating Income": 300.0, "Net Income": 250.0, "Diluted EPS": 6.0}),
        ])
        monkeypatch.setattr(fin, "_fetch_income", lambda sym, q: df)
        monkeypatch.setattr(fin, "get_fundamentals", lambda sym: {
            "total_cash": "$50.0B", "total_debt": "$100.0B", "debt_to_equity": 1.5,
            "current_ratio": 1.1, "free_cash_flow": "$90.0B",
            "roe_pct": 120.0, "roa_pct": 25.0, "gross_margin_pct": 40.0,
            "operating_margin_pct": 30.0, "profit_margin_pct": 25.0,
        })
        out = fin.get_financials("test")
        assert out["sym"] == "TEST"
        assert out["annual"][0]["gross_margin"] == 40.0
        assert out["balance"]["debt_to_equity"] == 1.5
        assert out["metrics"]["roe"] == 120.0
        # cached now
        assert cache.get("research_fin::TEST") is not None


class TestRoute:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_financials_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_financials", lambda sym: {
            "sym": sym.upper(), "annual": [], "quarterly": [], "balance": {}, "metrics": {},
        })
        r = self._client().get("/api/research/financials/AAPL")
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) == {"sym", "annual", "quarterly", "balance", "metrics"}
        assert body["sym"] == "AAPL"
