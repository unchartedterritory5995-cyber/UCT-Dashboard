"""Deep statement history — the series behind the six fundamentals panels.

What matters here is the JOIN and the ORDER: three statements from one provider
aligned onto one axis, oldest first. Both fail silently if wrong — a chart with
time running backwards looks perfectly normal, and a truncated join just draws
a shorter history.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def fh(monkeypatch):
    import api.services.research.financial_history as m
    importlib.reload(m)

    class _Cache:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def set(self, k, v, ttl=None): self.d[k] = v

    # ONE instance, not a factory: `lambda: _Cache()` builds a fresh cache on
    # every call, so nothing can ever hit and the caching test fails against a
    # service that is working correctly.
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    return m


def _income(dates):
    return [{"date": d, "period": "Q3", "revenue": i * 100,
             "operatingIncome": i * 10, "netIncome": i * 5, "eps": i * 0.1,
             "grossProfit": i * 50, "operatingExpenses": i * 40}
            for i, d in enumerate(dates, start=1)]


def _stub(fh, monkeypatch, income, balance=None, cash=None):
    def _fmp(path, sym, period, limit):
        if "income" in path:
            return income
        if "balance" in path:
            return balance
        return cash
    monkeypatch.setattr(fh, "_fmp", _fmp)


class TestOrderAndLabels:
    def test_periods_come_back_OLDEST_FIRST(self, fh, monkeypatch):
        # FMP returns newest-first. Plotted in that order a growing business
        # draws as a falling line, and nothing about the chart looks broken.
        _stub(fh, monkeypatch, _income(["2026-06-27", "2026-03-28", "2025-12-27"]))
        out = fh.get_history("AAPL")
        assert out["periods"] == ["Q3 2025", "Q3 2026", "Q3 2026"]
        assert out["count"] == 3

    def test_values_stay_aligned_to_their_period(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [
            {"date": "2026-06-27", "period": "Q3", "revenue": 300},
            {"date": "2025-06-27", "period": "Q3", "revenue": 100},
        ])
        out = fh.get_history("AAPL")
        # Sorting the rows must carry the values with them.
        assert out["series"]["revenue"] == [100, 300]

    def test_annual_labels_are_the_year_alone(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [{"date": "2025-09-27", "period": "FY", "revenue": 1}])
        out = fh.get_history("AAPL", period="annual")
        assert out["periods"] == ["2025"]


class TestTheJoin:
    def test_income_is_the_SPINE_and_a_short_cash_history_does_not_truncate(
            self, fh, monkeypatch):
        # Cash flow covers only the newest date. Joining on the intersection
        # would silently drop two thirds of the chart.
        inc = _income(["2024-01-01", "2025-01-01", "2026-01-01"])
        cash = [{"date": "2026-01-01", "freeCashFlow": 999}]
        _stub(fh, monkeypatch, inc, balance=[], cash=cash)
        out = fh.get_history("AAPL")
        assert out["count"] == 3
        assert out["series"]["free_cash_flow"] == [None, None, 999]

    def test_a_missing_statement_entirely_leaves_nulls_not_zeros(self, fh, monkeypatch):
        # A zero asset base is a claim about the company; a null is a gap.
        _stub(fh, monkeypatch, _income(["2026-01-01"]), balance=None, cash=None)
        out = fh.get_history("AAPL")
        assert out["series"]["total_assets"] == [None]
        assert out["series"]["free_cash_flow"] == [None]

    def test_balance_and_cash_join_on_the_income_date(self, fh, monkeypatch):
        inc = _income(["2026-01-01", "2026-04-01"])
        bal = [{"date": "2026-04-01", "totalAssets": 7, "totalLiabilities": 3}]
        _stub(fh, monkeypatch, inc, balance=bal, cash=[])
        out = fh.get_history("AAPL")
        assert out["series"]["total_assets"] == [None, 7]
        assert out["series"]["total_liabilities"] == [None, 3]


class TestDegradesQuietly:
    def test_no_income_statement_is_an_empty_result_not_an_error(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [])
        out = fh.get_history("ZZZZ")
        assert out["periods"] == [] and out["series"] == {}

    def test_a_raising_provider_does_not_escape(self, fh, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("provider down")
        monkeypatch.setattr(fh, "_fmp", boom)
        out = fh.get_history("AAPL")
        assert out["periods"] == []

    def test_a_row_with_no_date_cannot_enter_the_series(self, fh, monkeypatch):
        # Without a date it cannot be joined or ordered, so it is not a period.
        _stub(fh, monkeypatch, [{"period": "Q1", "revenue": 5},
                                {"date": "2026-01-01", "period": "Q1", "revenue": 9}])
        out = fh.get_history("AAPL")
        assert out["count"] == 1 and out["series"]["revenue"] == [9]

    def test_an_empty_symbol_is_not_a_lookup(self, fh):
        assert fh.get_history("")["periods"] == []

    def test_non_numeric_values_become_None_not_zero(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [{"date": "2026-01-01", "period": "Q1",
                                 "revenue": "n/a", "netIncome": None}])
        out = fh.get_history("AAPL")
        assert out["series"]["revenue"] == [None]
        assert out["series"]["net_income"] == [None]


class TestCaching:
    def test_a_second_call_does_not_refetch(self, fh, monkeypatch):
        calls = []

        def _fmp(path, sym, period, limit):
            calls.append(path)
            return _income(["2026-01-01"]) if "income" in path else []
        monkeypatch.setattr(fh, "_fmp", _fmp)

        fh.get_history("AAPL")
        n = len(calls)
        fh.get_history("AAPL")
        assert len(calls) == n, "re-fetched a symbol already cached"

    def test_quarter_and_annual_are_cached_SEPARATELY(self, fh, monkeypatch):
        # One key for both would serve annual rows to a quarterly chart.
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        q = fh.get_history("AAPL", period="quarter")
        a = fh.get_history("AAPL", period="annual")
        assert q["period"] == "quarter" and a["period"] == "annual"
