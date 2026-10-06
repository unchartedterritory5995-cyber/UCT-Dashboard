"""Foreign filers: figures in the company's REPORTING currency must say so.

The defect (production, 2026-10-06): the terminal's EE panel showed TSM's FY2026
consensus EPS as "$535.87" and revenue as "$5.40T". Those are FMP's figures in
Taiwan dollars; TSM's US ADR earns about $17. The fix carries the reporting
currency through the payload (`currency: "TWD"`) and withholds every ratio that
would divide a US-dollar price by non-dollar statement figures.

No network: every vendor leg is replaced at the module boundary. The Yahoo
`.info` fixtures below are the live values read 2026-10-06 (trimmed).
"""
from __future__ import annotations

import importlib
from datetime import date

import pytest

from api.services import fmp_client, provider_errors as pe


class _Cache:
    def __init__(self):
        self.d, self.ttls = {}, {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k], self.ttls[k] = v, ttl


def _res(value):
    return pe.ProviderResult(value=value,
                             provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="t"),
                             licensing_class=None, freshness="end_of_day")


# ── the reporting-currency reader ──────────────────────────────────────────

@pytest.fixture
def rc(monkeypatch):
    import api.services.research.reporting_currency as m
    importlib.reload(m)
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    m._test_cache = cache
    return m


def test_the_newest_statement_row_names_the_currency(rc):
    rows = [{"date": "2024-12-31", "reportedCurrency": "USD"},
            {"date": "2025-12-31", "reportedCurrency": "twd "}]
    assert rc.from_statement_rows(rows) == "TWD"
    assert rc.from_statement_rows([{"date": "2025-12-31"}]) is None
    assert rc.from_statement_rows(None) is None


def test_is_foreign_is_true_only_for_a_known_non_dollar_code(rc):
    assert rc.is_foreign("TWD") and rc.is_foreign("jpy")
    assert not rc.is_foreign("USD") and not rc.is_foreign(None) and not rc.is_foreign("")


def test_read_asks_the_annual_income_statement_and_caches(rc, monkeypatch):
    seen = []

    def fake(ticker, *, period="quarter", limit, timeout=None):
        seen.append((ticker, period, limit))
        return _res([{"date": "2025-12-31", "reportedCurrency": "TWD"}])

    monkeypatch.setattr(rc.fmp_client, "get_income_statement", fake)
    assert rc.read("tsm") == ("ok", "TWD")
    assert rc.read("TSM") == ("ok", "TWD")
    assert seen == [("TSM", "annual", 1)]                 # one read, then the cache
    assert rc._test_cache.ttls["reporting_currency::v1::TSM"] == rc._TTL_OK


def test_an_unread_currency_is_unknown_never_a_guess(rc, monkeypatch):
    def boom(ticker, *, period="quarter", limit, timeout=None):
        raise RuntimeError("FMP timed out")

    monkeypatch.setattr(rc.fmp_client, "get_income_statement", boom)
    assert rc.read("TSM") == ("error", None)
    assert rc._test_cache.ttls["reporting_currency::v1::TSM"] == rc._TTL_ERROR

    def none(ticker, *, period="quarter", limit, timeout=None):
        raise fmp_client._ERR.not_found("no data")

    monkeypatch.setattr(rc.fmp_client, "get_income_statement", none)
    assert rc.read("ZZZQ") == ("ok", None)


# ── EE: the consensus payload carries the currency ─────────────────────────

TSM_ANNUAL = [  # FMP /stable/analyst-estimates rows as served for TSM: TWD, no currency field
    {"date": "2026-12-31", "epsAvg": 535.87, "epsLow": 480.0, "epsHigh": 560.0,
     "numAnalystsEps": 20, "revenueAvg": 5.40e12, "revenueLow": 5.1e12,
     "revenueHigh": 5.6e12, "numAnalystsRevenue": 18},
    {"date": "2027-12-31", "epsAvg": 690.0, "revenueAvg": 7.3e12},
]


@pytest.fixture
def ec(monkeypatch):
    import api.services.research.estimates_consensus as m
    import api.services.research.reporting_currency as rcm
    importlib.reload(rcm)
    importlib.reload(m)
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    monkeypatch.setattr(rcm, "_cache", lambda: cache)
    m._test_cache = cache
    return m


def _stub(monkeypatch, m, *, currency, raise_income=False):
    monkeypatch.setattr(m.fmp_client, "get_earnings",
                        lambda t, *, limit=20, timeout=None: _res(
                            [{"date": "2026-07-16", "epsActual": 4.0}]))

    def est(ticker, *, period, limit=None, timeout=None):
        if period == "annual":
            return _res(TSM_ANNUAL)
        raise fmp_client._ERR.not_found("no quarterly")

    monkeypatch.setattr(m.fmp_client, "get_analyst_estimates", est)

    def inc(ticker, *, period="quarter", limit, timeout=None):
        if raise_income:
            raise RuntimeError("FMP timed out")
        return _res([{"date": "2025-12-31", "reportedCurrency": currency}])

    monkeypatch.setattr(m.fmp_client, "get_income_statement", inc)


def test_TSM_consensus_says_its_figures_are_TWD(ec, monkeypatch):
    _stub(monkeypatch, ec, currency="TWD")
    out = ec.get_consensus("TSM", today=date(2026, 10, 6))
    assert out["state"] == "ok"
    assert out["annual"][0]["eps"]["avg"] == 535.87        # the figure is untouched...
    assert out["currency"] == "TWD"                        # ...and now says what it is in
    assert "reportedCurrency" in out["currency_source"]


def test_a_US_name_says_USD(ec, monkeypatch):
    _stub(monkeypatch, ec, currency="USD")
    out = ec.get_consensus("NVDA", today=date(2026, 10, 6))
    assert out["currency"] == "USD"
    assert ec._test_cache.ttls["research_consensus::v3::NVDA"] == ec._TTL_OK


def test_an_unread_currency_is_None_and_held_only_briefly(ec, monkeypatch):
    _stub(monkeypatch, ec, currency="TWD", raise_income=True)
    out = ec.get_consensus("TSM", today=date(2026, 10, 6))
    assert out["state"] == "ok" and out["currency"] is None
    # A "$"-labelled TWD table must not stick for six hours on one timed-out read.
    assert ec._test_cache.ttls["research_consensus::v3::TSM"] == ec._TTL_ERROR


def test_the_route_lifts_the_reporting_currency_for_the_yahoo_tables(monkeypatch):
    from fastapi.testclient import TestClient
    import api.routers.research as rr
    import api.services.research.estimates_consensus as ecm
    from api.main import app
    monkeypatch.setattr(rr, "get_estimates", lambda sym: {
        "sym": sym.upper(), "entity": None, "forward": [], "revisions": []})
    monkeypatch.setattr(ecm, "get_consensus", lambda sym: {
        "state": "ok", "annual": [1], "quarterly": [], "currency": "TWD"})
    body = TestClient(app).get("/api/research/estimates/TSM?consensus=1").json()
    assert body["reporting_currency"] == "TWD"
    assert body["consensus"]["currency"] == "TWD"


# ── DES snapshot: no ratio that mixes a USD price with TWD statements ──────

TSM_INFO = {
    "symbol": "TSM", "longName": "Taiwan Semiconductor", "quoteType": "EQUITY",
    "currency": "USD", "financialCurrency": "TWD",
    "currentPrice": 483.69, "marketCap": 2508645728256,
    "trailingPE": 35.15189, "forwardPE": 22.061016,
    "priceToSalesTrailing12Months": 0.5643072,        # USD cap / TWD revenue: wrong
    "priceToBook": 99.46745, "enterpriseValue": 17749214494720,
    "enterpriseToRevenue": 3.997, "enterpriseToEbitda": 5.604,
    "totalRevenue": 4440492343296, "ebitda": 3167467077632,
    "freeCashflow": 730826014720, "totalCash": 3518010228736,
    "earningsGrowth": 0.4, "grossMargins": 0.59,
}
NVDA_INFO = {
    "symbol": "NVDA", "longName": "NVIDIA", "quoteType": "EQUITY",
    "currency": "USD", "financialCurrency": "USD",
    "currentPrice": 242.28, "marketCap": 5850334756864,
    "trailingPE": 30.629583, "forwardPE": 15.334925,
    "priceToSalesTrailing12Months": 19.305962, "priceToBook": 25.543604,
    "totalRevenue": 302970011648, "freeCashflow": 41809874944, "earningsGrowth": 0.6,
}


@pytest.fixture
def fund(monkeypatch):
    import api.services.fundamentals as m
    from api.services import yf_util
    infos = {}
    monkeypatch.setattr(yf_util, "bounded_call", lambda fn, default=None, *a, **k: infos["now"])

    def run(sym, info):
        infos["now"] = dict(info)
        monkeypatch.setattr(m, "_CACHE", type(m._CACHE)())
        return m.get_fundamentals(sym)
    return run


def test_TSM_mixed_ratios_are_withheld_with_a_reason(fund):
    out = fund("TSM", TSM_INFO)
    for k in ("ps", "pb", "ev_to_revenue", "ev_to_ebitda", "enterprise_value"):
        assert out[k] is None, k
    assert set(out["currency_withheld"]) == {"ps", "pb", "ev_to_revenue", "ev_to_ebitda",
                                             "enterprise_value"}
    assert "TWD" in out["currency_withheld"]["ps"] and "USD" in out["currency_withheld"]["ps"]
    assert out["reporting_currency"] == "TWD" and out["trading_currency"] == "USD"


def test_TSM_statement_amounts_are_labelled_TWD_not_dollars(fund):
    out = fund("TSM", TSM_INFO)
    assert out["total_revenue"] == "TWD 4.44T"
    assert out["free_cash_flow"] == "TWD 730.83B"
    assert "$" not in out["total_cash"]
    assert out["market_cap"].startswith("$")              # the cap IS in dollars: unchanged


def test_TSM_P_E_stays_because_Yahoo_states_it_in_the_trading_currency(fund):
    out = fund("TSM", TSM_INFO)
    # forwardPE 22.06 == 483.69 / 21.93 (Yahoo's USD forwardEps): consistent, kept.
    assert out["pe_forward"] == pytest.approx(22.06, abs=0.01)
    assert out["pe_trailing"] == pytest.approx(35.15, abs=0.01)


def test_a_US_name_is_untouched(fund):
    out = fund("NVDA", NVDA_INFO)
    assert out["ps"] == pytest.approx(19.31, abs=0.01)    # non-vacuity: the guard can keep
    assert out["pb"] == pytest.approx(25.54, abs=0.01)
    assert out["total_revenue"].startswith("$")
    assert not out.get("currency_withheld")
    assert out["reporting_currency"] == "USD"
