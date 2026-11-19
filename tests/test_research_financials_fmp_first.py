"""The research financials grids read the FMP statements first.

`get_financials` feeds the /research Financials tab, the Calendar earnings
modal's Financials section and the "Ask AI" financials evidence. Its growth grids
come from the statements reader the Terminal's FA panel uses
(`financial_history.get_history`); the yfinance frames are read only for a
ticker that reader returned nothing for, and the payload names whichever one
supplied the grids.

No network. The reader's vendor leg (`financial_history._fmp`) is replaced with
the shape fixtures in tests/fixtures/fmp_depth; the yfinance leg
(`_fetch_income`) and the fundamentals service are stubbed at this module's own
seams, and every stub counts its calls so "the fallback was not read" is an
assertion, not an assumption.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

DEPTH = Path(__file__).resolve().parent / "fixtures" / "fmp_depth"

FUND = {
    "reporting_currency": "USD", "total_cash": "$50.0B", "total_debt": "$100.0B",
    "debt_to_equity": 150.0, "current_ratio": 1.1, "free_cash_flow": "$90.0B",
    "roe_pct": 120.0, "roa_pct": 25.0, "gross_margin_pct": 40.0,
    "operating_margin_pct": 30.0, "profit_margin_pct": 25.0,
}


def _load(kind, period):
    name = f"{kind}_{'annual' if period == 'annual' else 'quarter'}_AAPL.json"
    return json.loads((DEPTH / name).read_text(encoding="utf-8"))


class _Cache:
    def __init__(self):
        self.d, self.ttls = {}, {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k], self.ttls[k] = v, ttl


def _yahoo_df(cols_values):
    """A yfinance-style income statement: index = row labels, columns = period ends."""
    cols = [pd.Timestamp(c) for c, _ in cols_values]
    labels = ["Total Revenue", "Gross Profit", "Operating Income", "Net Income", "Diluted EPS"]
    return pd.DataFrame({k: [v.get(k) for _, v in cols_values] for k in labels}, index=cols).T


YAHOO_Q = _yahoo_df([
    ("2026-06-30", {"Total Revenue": 500.0, "Gross Profit": 200.0, "Operating Income": 100.0,
                    "Net Income": 50.0, "Diluted EPS": 0.5}),
    ("2026-03-31", {"Total Revenue": 450.0, "Gross Profit": 180.0, "Operating Income": 90.0,
                    "Net Income": 45.0, "Diluted EPS": 0.45}),
])
YAHOO_A = _yahoo_df([
    ("2025-12-31", {"Total Revenue": 1800.0, "Gross Profit": 720.0, "Operating Income": 360.0,
                    "Net Income": 180.0, "Diluted EPS": 1.8}),
])


class _Rig:
    """The service with every outside leg replaced, and each leg's calls counted."""

    def __init__(self, monkeypatch):
        import api.services.cache_policy as policy
        import api.services.research.financial_history as fh
        import api.services.research.financials as m
        self.m, self.fh = m, fh
        self.cache, self.reader_cache = _Cache(), _Cache()
        self.fmp_calls, self.yahoo_calls, self.fund_calls = [], [], []
        #: per period: "fixture" (the AAPL shape fixtures), "empty" (the feed holds
        #: no statements), "down" (the read failed), or a callable(rows) -> rows.
        self.fmp = {"quarter": "fixture", "annual": "fixture"}
        self.yahoo = {True: (YAHOO_Q, True), False: (YAHOO_A, True)}
        self.fund = dict(FUND)
        monkeypatch.setattr(m, "cache", self.cache)
        monkeypatch.setattr(policy, "cache", self.cache)
        monkeypatch.setattr(fh, "_cache", lambda: self.reader_cache)
        monkeypatch.setattr(fh, "_fmp", self._fmp)
        monkeypatch.setattr(m, "resolve_entity", lambda s, **k: ({"status": "resolved", "entityId": "e1"}, None))
        monkeypatch.setattr(m, "_fetch_income", self._fetch_income)
        monkeypatch.setattr(m, "get_fundamentals", self._fundamentals)

    def _fmp(self, path, sym, period, limit):
        self.fmp_calls.append((path, period))
        mode = self.fmp[period]
        if mode == "down":
            raise TimeoutError("statements read timed out")
        if mode == "empty":
            return []
        kind = {"income-statement": "income", "balance-sheet-statement": "balance",
                "cash-flow-statement": "cash"}[path]
        rows = _load(kind, period)
        return mode(rows) if callable(mode) and kind == "income" else rows

    def _fetch_income(self, sym, quarterly):
        self.yahoo_calls.append(quarterly)
        return self.yahoo[quarterly]

    def _fundamentals(self, sym):
        self.fund_calls.append(sym)
        return dict(self.fund)

    def build(self, sym="AAPL"):
        return self.m._build_financials(sym)

    def ttl(self, sym="AAPL"):
        return self.cache.ttls[self.m._cache_key(sym)]


@pytest.fixture
def rig(monkeypatch):
    return _Rig(monkeypatch)


# ── a ticker the FMP feed covers ───────────────────────────────────────

class TestFmpFirst:
    def test_the_grids_come_from_the_fmp_statements_and_the_fallback_is_not_read(self, rig):
        out = rig.build()
        assert out["sources"]["statements"] == "FMP"
        assert rig.yahoo_calls == []                      # not one yfinance statement read
        assert "fmp_unavailable" not in out and "unread" not in out
        # the reader's own three statement calls per basis, nothing more
        assert sorted(rig.fmp_calls) == sorted(
            (p, b) for b in ("quarter", "annual")
            for p in ("income-statement", "balance-sheet-statement", "cash-flow-statement"))

    def test_quarterly_rows_are_newest_first_under_fiscal_labels(self, rig):
        q = rig.build()["quarterly"]
        assert len(q) == 8
        # AAPL's quarter ending 2026-06-27 is FISCAL Q3 2026 (calendar Q2): the grid
        # carries the label the statement panels carry for the same statement.
        assert [r["period"] for r in q[:4]] == ["Q3 2026", "Q2 2026", "Q1 2026", "Q4 2025"]
        assert q[-1]["period"] == "Q4 2024"

    def test_a_row_carries_the_same_fields_and_arithmetic_as_before(self, rig):
        top = rig.build()["quarterly"][0]
        assert set(top) == {"period", "revenue", "net_income", "eps", "gross_margin",
                            "operating_margin", "net_margin", "revenue_yoy", "eps_yoy"}
        assert top["revenue"] == 100e9 and top["net_income"] == 27e9
        assert top["gross_margin"] == 46.0            # 46 / 100
        assert top["operating_margin"] == 31.0        # 31 / 100
        assert top["net_margin"] == 27.0              # 27 / 100
        # against the SAME fiscal quarter a year earlier (four rows back): 92e9, 1.54
        assert top["revenue_yoy"] == 8.7              # (100 - 92) / 92
        assert top["eps_yoy"] == 16.2                 # (1.79 - 1.54) / 1.54

    def test_eps_is_the_diluted_figure_never_the_basic_one(self, rig):
        # The feed states both (basic 1.80, diluted 1.79). The grid has always
        # shown diluted EPS; the basic series must not stand in for it.
        assert rig.build()["quarterly"][0]["eps"] == 1.79

    def test_basic_eps_stands_in_only_when_no_diluted_eps_is_stated_at_all(self, rig):
        def no_diluted(rows):
            return [{k: v for k, v in r.items() if k != "epsDiluted"} for r in rows]
        rig.fmp["quarter"] = no_diluted
        assert rig.build()["quarterly"][0]["eps"] == 1.8

    def test_growth_needs_the_year_ago_period_and_is_none_without_it(self, rig):
        q = rig.build()["quarterly"]
        assert [r["revenue_yoy"] is not None for r in q] == [True] * 4 + [False] * 4
        a = rig.build("AAPL")["annual"]
        assert [r["period"] for r in a] == ["2025", "2024", "2023"]
        assert a[0]["revenue_yoy"] == 2.0 and a[-1]["revenue_yoy"] is None

    def test_a_figure_the_feed_does_not_state_is_none_never_zero(self, rig):
        def no_gross(rows):
            return [{k: v for k, v in r.items() if k not in ("grossProfit", "netIncome")} for r in rows]
        rig.fmp["quarter"] = no_gross
        top = rig.build()["quarterly"][0]
        assert top["gross_margin"] is None and top["net_income"] is None and top["net_margin"] is None
        assert top["revenue"] == 100e9 and top["operating_margin"] == 31.0   # the rest is untouched

    def test_the_summary_block_still_comes_from_the_fundamentals_service(self, rig):
        out = rig.build()
        assert out["balance"] == {"cash": "$50.0B", "total_debt": "$100.0B", "debt_to_equity": 150.0,
                                  "current_ratio": 1.1, "fcf": "$90.0B"}
        assert out["metrics"]["roe"] == 120.0
        assert out["sources"]["summary"] == "Yahoo Finance"
        assert rig.fund_calls == ["AAPL"]

    def test_the_source_block_says_when_the_statements_were_read(self, rig):
        out = rig.build()
        stamps = [rig.reader_cache.get(f"fin_hist::v2::AAPL::{b}")["source"]["fetched_at"]
                  for b in ("quarter", "annual")]
        assert out["sources"]["statements_fetched_at"] == min(stamps)

    def test_a_warm_statements_cache_costs_no_vendor_call(self, rig):
        rig.build()
        rig.cache.d.clear()                     # this service's own cache expired; the reader's did not
        rig.fmp_calls.clear()
        out = rig.build()
        assert out["sources"]["statements"] == "FMP" and rig.fmp_calls == []


# ── the currency of the FMP grids is the feed's own ─────────────────────

class TestFmpCurrency:
    def test_the_currency_is_the_one_the_statements_state(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = lambda rows: [{**r, "reportedCurrency": "TWD"} for r in rows]
        rig.fund["reporting_currency"] = "USD"            # the other vendor's opinion is not consulted
        assert rig.build("TSM")["currency"] == "TWD"

    def test_a_currency_the_feed_does_not_state_is_unknown_never_borrowed(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = lambda rows: [
            {k: v for k, v in r.items() if k != "reportedCurrency"} for r in rows]
        rig.fund["reporting_currency"] = "TWD"
        assert rig.build("TSM")["currency"] is None

    def test_two_bases_that_disagree_are_unknown(self, rig):
        rig.fmp["quarter"] = lambda rows: [{**r, "reportedCurrency": "TWD"} for r in rows]
        assert rig.build("TSM")["currency"] is None       # annual says USD, quarterly TWD


# ── a ticker the FMP feed has nothing for ───────────────────────────────

class TestFallback:
    def test_a_ticker_the_feed_holds_nothing_for_falls_back_and_says_so(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "empty"
        out = rig.build("ZZZQ")
        assert out["sources"]["statements"] == "Yahoo Finance"
        assert "statements_fetched_at" not in out["sources"]
        assert "fmp_unavailable" not in out               # the feed ANSWERED: nothing held
        assert "unread" not in out
        assert rig.yahoo_calls == [False, True]
        # the fallback frames label CALENDAR quarters, as they always have
        assert [r["period"] for r in out["quarterly"]] == ["Q2 2026", "Q1 2026"]
        assert out["annual"][0]["period"] == "2025" and out["annual"][0]["net_margin"] == 10.0
        assert out["currency"] == "USD"                   # the fallback's currency: the fundamentals read

    def test_a_clean_fallback_keeps_the_long_ttl(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "empty"
        rig.build("ZZZQ")
        assert rig.ttl("ZZZQ") == rig.m._CACHE_TTL

    def test_a_failed_fmp_read_falls_back_marked_and_heals_fast(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "down"
        out = rig.build("NVDA")
        assert out["sources"]["statements"] == "Yahoo Finance"
        assert out["fmp_unavailable"] is True             # a failed read, never "holds nothing"
        assert out["quarterly"] and out["annual"]
        assert "unread" not in out                        # the source that supplied the grids read both
        # Not a settled answer: the FMP grids must come back in minutes, not in 48 hours.
        assert rig.ttl("NVDA") == rig.m._FAIL_TTL

    def test_a_failed_read_is_not_cached_by_the_reader_so_the_next_build_recovers(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "down"
        assert rig.build("NVDA")["sources"]["statements"] == "Yahoo Finance"
        rig.cache.d.clear()
        rig.fmp["quarter"] = rig.fmp["annual"] = "fixture"
        out = rig.build("NVDA")
        assert out["sources"]["statements"] == "FMP" and "fmp_unavailable" not in out

    def test_neither_source_having_rows_names_no_source(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "empty"
        rig.yahoo = {True: (pd.DataFrame(), True), False: (None, True)}
        out = rig.build("ZZZQ")
        assert out["quarterly"] == [] and out["annual"] == []
        assert out["sources"]["statements"] is None       # nobody supplied a grid: nobody is credited
        assert "unread" not in out and "fmp_unavailable" not in out

    def test_a_fallback_leg_that_failed_is_listed_unread(self, rig):
        rig.fmp["quarter"] = rig.fmp["annual"] = "empty"
        rig.yahoo = {True: (YAHOO_Q, True), False: (None, False)}
        out = rig.build("ZZZQ")
        assert out["unread"] == ["annual"] and out["quarterly"]
        assert rig.ttl("ZZZQ") == rig.m._FAIL_TTL


# ── one basis only: the feed is kept, the vendors are never mixed ────────────

class TestOneBasis:
    def test_a_ticker_covered_on_one_basis_keeps_the_feed_and_shows_the_other_empty(self, rig):
        rig.fmp["quarter"] = "empty"
        out = rig.build()
        assert out["sources"]["statements"] == "FMP"
        assert out["quarterly"] == [] and len(out["annual"]) == 3
        assert rig.yahoo_calls == []                      # calendar-labelled rows never join fiscal ones
        assert "unread" not in out and "fmp_unavailable" not in out
        assert rig.ttl() == rig.m._FMP_TTL           # the feed answered both: settled

    def test_a_basis_whose_read_failed_is_listed_unread_and_heals_fast(self, rig):
        rig.fmp["annual"] = "down"
        out = rig.build()
        assert out["sources"]["statements"] == "FMP" and len(out["quarterly"]) == 8
        assert out["annual"] == [] and out["unread"] == ["annual"]
        assert out["fmp_unavailable"] is True
        assert rig.yahoo_calls == []
        assert rig.ttl() == rig.m._FAIL_TTL


# ── cache lifetime ───────────────────────────────────────────────────────────

class TestTtl:
    def test_complete_fmp_grids_are_held_as_long_as_the_statements_themselves(self, rig):
        rig.build()
        assert rig.ttl() == rig.m._FMP_TTL == rig.fh._TTL

    def test_a_failed_summary_read_shortens_the_ttl_and_credits_no_summary_source(self, rig):
        rig.fund = {"error": "no fundamentals available", "ticker": "AAPL"}
        out = rig.build()
        assert out["sources"] == {"statements": "FMP", "summary": None,
                                  "statements_fetched_at": out["sources"]["statements_fetched_at"]}
        assert out["balance"]["cash"] is None and len(out["quarterly"]) == 8
        assert rig.ttl() == rig.m._FAIL_TTL

    def test_the_cache_key_is_versioned_so_an_entry_without_sources_is_never_served(self, rig):
        assert rig.m._cache_key("AAPL") == "research_fin::v2::AAPL"
        rig.cache.set("research_fin::AAPL", {"sym": "AAPL", "quarterly": [{"period": "old"}]}, 60)
        assert rig.m.get_financials("aapl")["sources"]["statements"] == "FMP"


# ── the seam itself ──────────────────────────────────────────────────────────

class TestFetchStatements:
    def test_an_error_state_is_a_failure_not_an_empty_answer(self, rig, monkeypatch):
        monkeypatch.setattr(rig.fh, "get_history",
                            lambda sym, period="quarter": {"sym": sym, "periods": [], "state": "error"})
        assert rig.m._fetch_statements("AAPL", True) == (None, False)

    def test_a_raising_reader_is_a_failure(self, rig, monkeypatch):
        def boom(sym, period="quarter"):
            raise RuntimeError("reader broke")
        monkeypatch.setattr(rig.fh, "get_history", boom)
        assert rig.m._fetch_statements("AAPL", False) == (None, False)

    def test_an_empty_answer_is_ok(self, rig, monkeypatch):
        seen = []
        monkeypatch.setattr(rig.fh, "get_history",
                            lambda sym, period="quarter": seen.append(period) or {"sym": sym, "periods": []})
        hist, ok = rig.m._fetch_statements("AAPL", False)
        assert ok is True and hist["periods"] == [] and seen == ["annual"]
        rig.m._fetch_statements("AAPL", True)
        assert seen == ["annual", "quarter"]


def test_statement_grid_tolerates_a_short_or_missing_series():
    import api.services.research.financials as m
    hist = {"periods": ["Q1 2026", "Q2 2026"], "series": {"revenue": [10.0], "eps_diluted": [None, 0.2]}}
    rows = m._statement_grid(hist, 8, True)
    assert [r["period"] for r in rows] == ["Q2 2026", "Q1 2026"]
    assert rows[0]["revenue"] is None and rows[0]["eps"] == 0.2 and rows[1]["revenue"] == 10.0
    assert m._statement_grid(None, 8, True) == [] and m._statement_grid({"periods": []}, 5, False) == []
