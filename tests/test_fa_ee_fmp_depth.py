"""FA / EE on FMP (terminal gap audit, gaps 3 and 4).

FA: `financial_history.get_history` — the one FMP statements reader, already
cached, already behind the ERN modal's six panels — now carries the full income,
balance and cash-flow line items plus key ratios DERIVED from them.

EE: `estimates_consensus.get_consensus` — multi-year annual + quarterly analyst
consensus through `fmp_client.get_analyst_estimates`, the same adapter and the
same (period, limit) pairs the existing readers send.

No network: every vendor leg is replaced at the module boundary with fixture
rows (tests/fixtures/fmp_depth — shape fixtures, see its _generate.py — and the
RECORDED quarterly analyst-estimates payload in tests/fixtures/broker_estimates).
"""
from __future__ import annotations

import importlib
import json
from datetime import date
from pathlib import Path

import pytest

FIX = Path(__file__).resolve().parent / "fixtures"
DEPTH = FIX / "fmp_depth"
REC_Q = FIX / "broker_estimates" / "fmp_analyst_estimates_quarter_AAPL.json"


def _load(name):
    return json.loads((DEPTH / name).read_text(encoding="utf-8"))


class _Cache:
    def __init__(self):
        self.d, self.ttls = {}, {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k], self.ttls[k] = v, ttl


# ── FA: statements ─────────────────────────────────────────────────────────

@pytest.fixture
def fh(monkeypatch):
    import api.services.research.financial_history as m
    importlib.reload(m)
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    calls = []

    def _fmp(path, sym, period, limit):
        calls.append((path, period, limit))
        kind = {"income-statement": "income", "balance-sheet-statement": "balance",
                "cash-flow-statement": "cash"}[path]
        return _load(f"{kind}_{'annual' if period == 'annual' else 'quarter'}_AAPL.json")

    monkeypatch.setattr(m, "_fmp", _fmp)
    m._calls = calls
    m._test_cache = cache
    return m


class TestStatementDepth:
    def test_every_line_item_is_present_and_aligned_to_the_periods(self, fh):
        out = fh.get_history("AAPL")
        n = out["count"]
        assert n == 8
        for key, _leg, _names in fh.LINE_ITEMS:
            assert len(out["series"][key]) == n, key
        assert out["dates"] == sorted(out["dates"])          # oldest first
        assert out["dates"][-1] == "2026-06-27"

    def test_the_three_statements_are_all_read(self, fh):
        out = fh.get_history("AAPL")
        s = out["series"]
        assert s["cost_of_revenue"][-1] == pytest.approx(100e9 * 0.54)        # income
        assert s["total_equity"][-1] == 70e9                                   # balance
        assert s["capital_expenditure"][-1] == -3e9                            # cash flow
        assert s["buybacks"][-1] == -25e9
        assert s["eps_diluted"][-1] is not None                                # stable spelling

    def test_one_fetch_per_statement_and_a_cache_hit_after(self, fh):
        fh.get_history("AAPL")
        fh.get_history("AAPL")
        assert sorted(p for p, _per, _lim in fh._calls) == [
            "balance-sheet-statement", "cash-flow-statement", "income-statement"]
        assert fh._test_cache.ttls["fin_hist::v2::AAPL::quarter"] == fh._TTL

    def test_the_payload_names_its_source(self, fh):
        src = fh.get_history("AAPL", period="annual")["source"]
        assert src["vendor"] == "FMP" and src["basis"] == "fiscal"
        assert "/stable/income-statement" in src["endpoints"]
        assert isinstance(src["fetched_at"], int)

    def test_the_panels_keys_are_unchanged(self, fh):
        # statementSeries.js reads these ten by name; renaming one blanks a panel.
        panel_keys = {"revenue", "operating_income", "net_income", "eps", "gross_profit",
                      "operating_expenses", "total_assets", "total_liabilities",
                      "free_cash_flow", "operating_cash_flow"}
        assert panel_keys <= set(fh.get_history("AAPL")["series"])


class TestRatios:
    def test_margins_are_derived_from_the_same_rows(self, fh):
        out = fh.get_history("AAPL")
        r, s = out["ratios"], out["series"]
        assert r["gross_margin"][-1] == pytest.approx(46.0)
        assert r["net_margin"][-1] == pytest.approx(round(s["net_income"][-1] / s["revenue"][-1] * 100, 2))
        assert r["current_ratio"][-1] == pytest.approx(150 / 160, abs=0.01)
        assert r["debt_to_equity"][-1] == pytest.approx(100 / 70, abs=0.01)

    def test_quarterly_returns_are_TTM_and_absent_until_four_quarters(self, fh):
        out = fh.get_history("AAPL")
        roe, ni = out["ratios"]["roe"], out["series"]["net_income"]
        assert roe[:3] == [None, None, None]
        assert roe[-1] == pytest.approx(round(sum(ni[-4:]) / 70e9 * 100, 2))

    def test_growth_is_year_over_year_not_sequential(self, fh):
        out = fh.get_history("AAPL")
        g, rev = out["ratios"]["revenue_growth"], out["series"]["revenue"]
        assert g[:4] == [None] * 4
        assert g[4] == pytest.approx(round((rev[4] - rev[0]) / rev[0] * 100, 2))

    def test_a_zero_or_sign_change_has_no_growth(self, fh):
        assert fh._yoy([-1.0, 2.0], 1) == [None, None]
        assert fh._yoy([0, 2.0], 1) == [None, None]
        assert fh._ratio(1, 0) is None


# ── EE: consensus ──────────────────────────────────────────────────────────

@pytest.fixture
def ec(monkeypatch):
    import api.services.research.estimates_consensus as m
    importlib.reload(m)
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    m._test_cache = cache
    return m


def _stub_fmp(monkeypatch, m, *, annual=None, quarter=None, raise_for=()):
    from api.services import fmp_client, provider_errors as pe
    seen = []

    def fake(ticker, *, period, limit=None, timeout=None):
        seen.append((period, limit, timeout))
        if period in raise_for:
            raise RuntimeError("FMP /stable/analyst-estimates timed out")
        rows = annual if period == "annual" else quarter
        if not rows:
            raise fmp_client._ERR.not_found("FMP /stable/analyst-estimates: no data")
        return pe.ProviderResult(value=rows,
                                 provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="t"),
                                 licensing_class=None, freshness="end_of_day")

    monkeypatch.setattr(m.fmp_client, "get_analyst_estimates", fake)
    return seen


TODAY = date(2026, 10, 3)


class TestConsensusParity:
    def test_the_recorded_quarter_payload_shapes_into_forward_quarters(self, ec):
        rows = json.loads(REC_Q.read_text(encoding="utf-8"))
        out = ec.shape_rows(rows, "quarterly", today=TODAY)
        assert out, "the recorded payload must yield forward quarters"
        assert [r["period_end"] for r in out] == sorted(r["period_end"] for r in out)
        first = next(r for r in rows if r["date"] == out[0]["period_end"])
        assert out[0]["eps"] == {"avg": first["epsAvg"], "low": first["epsLow"],
                                 "high": first["epsHigh"], "n": first["numAnalystsEps"]}
        assert out[0]["revenue"]["n"] == first["numAnalystsRevenue"]
        assert out[0]["ebitda_avg"] == first["ebitdaAvg"]
        assert len(out) <= ec.MAX_QUARTERS

    def test_at_least_three_forward_fiscal_years_for_a_megacap(self, ec):
        out = ec.shape_rows(_load("analyst_estimates_annual_AAPL.json"), "annual", today=TODAY)
        assert len(out) >= 3
        assert out[0]["label"] == "FY2026"           # ended 2026-09-27, inside the grace window
        assert all(r["label"].startswith("FY") for r in out)
        assert out[0]["eps_growth"] is not None      # computed against FY2025 before the filter

    def test_a_period_past_the_grace_window_is_not_forward(self, ec):
        rows = [{"date": "2025-01-31", "epsAvg": 1.0}, {"date": "2026-12-31", "epsAvg": 2.0}]
        out = ec.shape_rows(rows, "annual", today=TODAY)
        assert [r["label"] for r in out] == ["FY2026"]


class TestConsensusStates:
    def test_ok_reads_both_legs_with_the_existing_request_shapes(self, ec, monkeypatch):
        seen = _stub_fmp(monkeypatch, ec, annual=_load("analyst_estimates_annual_AAPL.json"),
                         quarter=json.loads(REC_Q.read_text(encoding="utf-8")))
        out = ec.get_consensus("aapl", today=TODAY)
        assert out["state"] == "ok" and out["annual"] and out["quarterly"]
        assert sorted((p, lim) for p, lim, _t in seen) == [("annual", 20), ("quarter", 40)]
        assert all(t == ec._TIMEOUT_S for _p, _l, t in seen)       # every leg is bounded
        assert out["source"] == ec.SOURCE

    def test_cached_after_the_first_read(self, ec, monkeypatch):
        seen = _stub_fmp(monkeypatch, ec, annual=_load("analyst_estimates_annual_AAPL.json"),
                         quarter=[])
        ec.get_consensus("AAPL", today=TODAY)
        ec.get_consensus("AAPL", today=TODAY)
        assert len(seen) == 2
        assert ec._test_cache.ttls["research_consensus::v1::AAPL"] == ec._TTL_OK

    def test_answered_nothing_is_EMPTY_not_error(self, ec, monkeypatch):
        _stub_fmp(monkeypatch, ec, annual=[], quarter=[])
        out = ec.get_consensus("ZZZZ", today=TODAY)
        assert out["state"] == "empty" and out["reason"]

    def test_a_failed_read_is_ERROR_and_cached_briefly(self, ec, monkeypatch):
        _stub_fmp(monkeypatch, ec, raise_for=("annual", "quarter"))
        out = ec.get_consensus("AAPL", today=TODAY)
        assert out["state"] == "error" and set(out["errors"]) == {"annual", "quarterly"}
        assert ec._test_cache.ttls["research_consensus::v1::AAPL"] == ec._TTL_ERROR


class TestRoute:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_without_the_parameter_the_response_is_unchanged(self, monkeypatch):
        import api.routers.research as rr
        monkeypatch.setattr(rr, "get_estimates", lambda sym: {
            "sym": sym.upper(), "entity": None, "forward": [], "revisions": []})
        r = self._client().get("/api/research/estimates/AAPL")
        assert set(r.json()) == {"sym", "entity", "forward", "revisions"}

    def test_consensus_rides_beside_the_yfinance_blocks_with_their_sources(self, monkeypatch):
        import api.routers.research as rr
        import api.services.research.estimates_consensus as ecm
        monkeypatch.setattr(rr, "get_estimates", lambda sym: {
            "sym": sym.upper(), "entity": None, "forward": [], "revisions": []})
        monkeypatch.setattr(ecm, "get_consensus", lambda sym: {"state": "ok", "annual": [1], "quarterly": []})
        body = self._client().get("/api/research/estimates/AAPL?consensus=1").json()
        assert body["consensus"]["state"] == "ok"
        assert body["sources"] == {"forward": "Yahoo Finance", "revisions": "Yahoo Finance",
                                   "consensus": "FMP"}

    def test_financial_history_route_carries_ratios_and_source(self, monkeypatch):
        import api.services.research.financial_history as fhm
        monkeypatch.setattr(fhm, "get_history", lambda sym, period="quarter": {
            "sym": sym, "period": period, "periods": ["Q1 2026"], "series": {}, "ratios": {},
            "source": {"vendor": "FMP"}})
        body = self._client().get("/api/research/financial-history/AAPL?period=annual").json()
        assert body["source"]["vendor"] == "FMP" and body["period"] == "annual"
