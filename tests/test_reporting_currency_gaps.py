"""Foreign filers, the two surfaces the first currency fix left: EEH and the FA
yfinance fallback.

* EEH (estimate history) shows FMP's quarterly consensus, which is in the
  company's reporting currency (TSM: TWD). Its route is built to make NO vendor
  call, so the currency is read CACHE-ONLY (`reporting_currency.peek`): whatever
  EE/FA already learned. Unknown is None, and None renders with no label.
* FA's yfinance fallback grids come from Yahoo statement frames, which are in
  Yahoo's `financialCurrency`; the payload now carries it as `currency`.

No network: every vendor leg is replaced at the module boundary.
"""
from __future__ import annotations

import importlib
from datetime import date

import pytest


class _Cache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def _no_vendor(*a, **k):
    raise AssertionError("a vendor call on a cache-only path")


@pytest.fixture
def rc(monkeypatch):
    import api.services.research.reporting_currency as m
    importlib.reload(m)
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    monkeypatch.setattr(m.fmp_client, "get_income_statement", _no_vendor)
    m._test_cache = cache
    return m


# ── peek: the cache-only read ──────────────────────────────────────────────

def test_peek_returns_what_read_cached_and_never_calls_the_vendor(rc):
    assert rc.peek("TSM") is None                          # nothing cached: unknown, no call
    rc._test_cache.set("reporting_currency::v1::TSM", ["ok", "TWD"])
    assert rc.peek("tsm") == "TWD"
    rc._test_cache.set("reporting_currency::v1::NVDA", ["ok", "USD"])
    assert rc.peek("NVDA") == "USD"


def test_peek_treats_a_failed_or_odd_cache_entry_as_unknown(rc):
    rc._test_cache.set("reporting_currency::v1::TSM", ["error", None])
    assert rc.peek("TSM") is None
    rc._test_cache.set("reporting_currency::v1::TM", "JPY")   # not the (state, code) shape
    assert rc.peek("TM") is None
    assert rc.peek("") is None


# ── EEH: estimate history carries the cached currency ──────────────────────

_ROWS = [{"date": "2026-12-31", "epsAvg": 18.5, "epsLow": 17.0, "epsHigh": 20.0,
          "revenueAvg": 1.1e12, "numAnalystsEps": 12, "numAnalystsRevenue": 10}]


@pytest.fixture
def eh(monkeypatch, tmp_path, rc):
    import api.services.estimate_history as m
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    m.snapshot_symbol("TSM", "2026-10-01", fetch=lambda s: ("ok", _ROWS, None))
    return m


def test_EEH_says_TWD_when_the_currency_is_already_cached(eh, rc):
    rc._test_cache.set("reporting_currency::v1::TSM", ["ok", "TWD"])
    out = eh.history("TSM", today=date(2026, 10, 6))
    assert out["currency"] == "TWD"
    assert "reportedCurrency" in out["currency_source"]
    assert out["periods"][0]["points"][0]["eps_avg"] == 18.5   # the figure is untouched


def test_EEH_is_unknown_not_a_guess_when_nothing_is_cached(eh):
    # rc's fixture makes any FMP income-statement call fail the test.
    out = eh.history("TSM", today=date(2026, 10, 6))
    assert out["currency"] is None
    out = eh.history("ZZZQ", today=date(2026, 10, 6))          # collecting branch too
    assert out["state"] == "collecting" and "currency" in out and out["currency"] is None


def test_EEH_route_carries_the_currency(eh, rc, monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    import api.routers.research_cov as rcov
    monkeypatch.setenv(eh.ENABLED_ENV, "1")
    rc._test_cache.set("reporting_currency::v1::TSM", ["ok", "TWD"])
    app.dependency_overrides[rcov.require_paid] = lambda: {"id": 1}
    try:
        body = TestClient(app).get("/api/research/estimate-history/TSM").json()
    finally:
        app.dependency_overrides.pop(rcov.require_paid, None)
    assert body["currency"] == "TWD"


# ── FA yfinance fallback: the payload carries Yahoo's financialCurrency ────

@pytest.fixture
def fin(monkeypatch):
    import api.services.research.financials as m
    monkeypatch.setattr(m, "cache", _Cache())
    monkeypatch.setattr(m, "resolve_entity", lambda s: (None, None))
    monkeypatch.setattr(m, "_fetch_income", lambda s, q: (None, True))

    def run(sym, fund):
        monkeypatch.setattr(m, "get_fundamentals", lambda s: dict(fund))
        return m._build_financials(sym)
    return run


def test_FA_fallback_says_TWD_for_TSM(fin):
    out = fin("TSM", {"reporting_currency": "TWD", "trading_currency": "USD",
                      "total_cash": "TWD 3.52T"})
    assert out["currency"] == "TWD"
    assert out["balance"]["cash"] == "TWD 3.52T"


def test_FA_fallback_says_USD_for_NVDA_and_None_when_unread(fin):
    assert fin("NVDA", {"reporting_currency": "USD", "total_cash": "$60.6B"})["currency"] == "USD"
    assert fin("ZZZQ", {})["currency"] is None


# ── the guard: a non-USD filer listed in its own currency is still not "$" ─

def test_a_JPY_filer_listed_in_JPY_is_labelled_and_keeps_its_ratios(monkeypatch):
    import api.services.fundamentals as m
    from api.services import yf_util
    info = {"symbol": "7203.T", "longName": "Toyota", "currency": "JPY", "financialCurrency": "JPY",
            "totalRevenue": 48.0e12, "priceToSalesTrailing12Months": 0.9}
    monkeypatch.setattr(yf_util, "bounded_call", lambda fn, default=None, *a, **k: dict(info))
    monkeypatch.setattr(m, "_CACHE", type(m._CACHE)())
    out = m.get_fundamentals("7203.T")
    assert out["total_revenue"] == "JPY 48.00T"
    assert out["ps"] == pytest.approx(0.9)                 # same currency both sides: kept
    assert not out.get("currency_withheld")
