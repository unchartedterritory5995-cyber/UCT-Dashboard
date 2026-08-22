"""THE GUARD BINDS: every converted module's yfinance call really goes through it.

⚠️ THESE TESTS STUB THE WRAPPER, NOT `yfinance`. That is the whole point.

A test that stubs the yfinance module — `monkeypatch.setitem(sys.modules,
"yfinance", fake)` — passes whether or not the guard is involved, because a
function-local `import yfinance as _yf` picks the fake up just the same. It is
green while the private copy sails straight past the pool, the deadline and the
rate-limit breaker. That is exactly the state this repo was in on 2026-08-08.

So each test here replaces `yf_util.bounded_call` with a spy that NEVER runs the
callable, and then asserts two things at once:

  * the spy fired — the call is genuinely routed through the guard, so it is
    subject to the shared pool and the breaker; and
  * the caller degraded to its no-data answer instead of raising — which is what
    a suppressed call looks like when Yahoo is refusing us.

Delete the `yf_util.bounded_call(...)` wrapper from any module below and its
test fails on the first assertion. That is the non-vacuity: the spy CANNOT fire
unless the production code calls the guard.

⚠️ Patching works only because every module imports the MODULE
(`from api.services import yf_util`) rather than the function. A
`from api.services.yf_util import bounded_call` anywhere would bind a private
copy and silently make its test vacuous —
`tests/test_yf_guard_census.py::test_nothing_from_imports_the_guard_function`
is the rail on that.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from api.services import yf_util
from tools import yf_guard_census as cen


class _Spy:
    """Stands in for the guard. Records every call, runs nothing."""

    def __init__(self, reraise_exc: Exception | None = None):
        self.calls: list[dict] = []
        self._reraise_exc = reraise_exc or RuntimeError("guard suppressed the call")

    def __call__(self, fn, default, timeout: float = 12.0, *,
                 reraise: bool = False, lane: str = "default"):
        self.calls.append({"timeout": timeout, "reraise": reraise, "lane": lane})
        if reraise:
            raise self._reraise_exc
        return default

    @property
    def fired(self) -> bool:
        return bool(self.calls)


@pytest.fixture
def spy():
    s = _Spy()
    with patch.object(yf_util, "bounded_call", s):
        yield s


# ── one test per converted module ────────────────────────────────────────────
# Named for the module so a failure says which one drifted off the guard.

def test_ticker_meta_reaches_yfinance_through_the_guard(spy):
    from api.services import ticker_meta
    out = ticker_meta._from_yfinance("AAPL")
    assert spy.fired
    # `exchange` joined the shape in 3ca0f574a (the compare-symbols legend).
    assert out == {"name": None, "sector": None, "industry": None, "exchange": None}


def test_short_interest_reaches_yfinance_through_the_guard(spy):
    from api.services import short_interest
    short_interest._CACHE = type(short_interest._CACHE)()
    out = short_interest.get_short_interest("AAPL")
    assert spy.fired
    assert "error" in out


def test_institutional_holdings_reaches_yfinance_through_the_guard(spy):
    from api.services import institutional_holdings
    institutional_holdings._CACHE = type(institutional_holdings._CACHE)()
    out = institutional_holdings.get_institutional_holders("AAPL")
    assert spy.fired
    assert "error" in out


def test_options_chain_expirations_reaches_yfinance_through_the_guard(spy):
    from api.services import options_chain
    options_chain._CACHE = type(options_chain._CACHE)()
    out = options_chain.list_expirations("AAPL")
    assert spy.fired
    assert "error" in out


def test_options_chain_get_chain_reaches_yfinance_through_the_guard(spy):
    from api.services import options_chain
    options_chain._CACHE = type(options_chain._CACHE)()
    out = options_chain.get_chain("AAPL")
    assert spy.fired
    assert "error" in out


def test_ticker_logos_clearbit_reaches_yfinance_through_the_guard(spy):
    from api.services import ticker_logos
    assert ticker_logos._clearbit_logo_bytes("AAPL") is None
    assert spy.fired


def test_catalyst_ticker_metadata_reaches_yfinance_through_the_guard(spy):
    from api.services.catalyst import ticker_metadata
    out = ticker_metadata._fetch_via_yfinance("AAPL")
    assert spy.fired
    assert out["sector"] is None


def test_engine_sym_cap_reaches_yfinance_through_the_guard(spy):
    """`fast_info` is lazy, so the whole read block must be inside the guarded
    callable — and the fallback must stay FAIL-OPEN (True), or a rate limit
    would silently drop every news item."""
    from api.services import engine
    assert engine._check_sym_cap("AAPL") == ("AAPL", True)
    assert spy.fired


def test_massive_snapshot_reaches_yfinance_through_the_guard(spy):
    from api.services import massive
    assert massive._yfinance_snapshot("^VIX") == {}
    assert spy.fired


def test_massive_avg_dollar_volume_reaches_yfinance_through_the_guard(spy):
    """And a guard failure must map to inf ("couldn't fetch, don't filter it
    out"), never 0.0 ("fetched, no volume, filter it out") — a 429 must not
    quietly delete tickers from the universe."""
    from api.services import massive
    out = massive._get_avg_dollar_vol(["AAPL", "MSFT"])
    assert spy.fired
    assert out == {"AAPL": float("inf"), "MSFT": float("inf")}


def test_index_bars_reaches_yfinance_through_the_guard(spy):
    from api import index_bars
    assert index_bars._fetch_yf("^GSPC", "1d", "5d", 1.0, None) == []
    assert spy.fired


def test_index_bars_proxy_ratio_reaches_yfinance_through_the_guard(spy):
    from api import index_bars
    assert index_bars._proxy_ratio("^GSPC", "SPY") is None
    assert spy.fired
    assert len(spy.calls) == 2, "both legs of the ratio must be guarded"


def test_charts_router_reaches_yfinance_through_the_guard(spy):
    from api.routers import charts
    resp = charts.chart_image("AAPL")
    assert spy.fired
    assert resp.status_code == 204


def test_fundamentals_reaches_yfinance_through_the_guard(spy):
    from api.services import fundamentals
    fundamentals._CACHE = type(fundamentals._CACHE)()
    out = fundamentals.get_fundamentals("ZZZQ")
    assert spy.fired
    assert "error" in out


def test_dividends_calendar_reaches_yfinance_through_the_guard(spy):
    from api.services import dividends_calendar
    from api.services.cache import cache
    cache.invalidate(dividends_calendar._syms_cache_key(["ZZZQ"]))
    assert dividends_calendar.get_events(["ZZZQ"]) == []
    assert spy.fired


def test_industry_map_fallback_reaches_yfinance_through_the_guard(spy):
    from api.services import industry_map
    with patch.object(industry_map, "_fmp_profile_row", return_value=None), \
         patch.object(industry_map, "_finnhub_profile_row", return_value=None,
                      create=True):
        out = industry_map._fetch_fallback("AAPL")
    assert spy.fired
    assert out[2] != "yfinance", "a suppressed yfinance leg must not claim a source"


def test_news_aggregator_reaches_yfinance_through_the_guard(spy):
    from api.services import news_aggregator
    with patch.object(news_aggregator, "requests") as fake_requests:
        fake_requests.get.side_effect = RuntimeError("no network in tests")
        news_aggregator.fetch_yahoo_ticker_news(["AAPL"])
    assert spy.fired


def test_yfinance_pool_fetch_history_reaches_the_shared_guard(spy):
    from api.services import yfinance_pool
    with pytest.raises(RuntimeError):
        yfinance_pool.fetch_history("AAPL", period="1mo")
    assert spy.fired
    assert spy.calls[0]["reraise"] is True, "the adapter keeps raise semantics"


def test_yfinance_pool_run_in_pool_reaches_the_shared_guard(spy):
    from api.services import yfinance_pool
    with pytest.raises(RuntimeError):
        yfinance_pool.run_in_pool(lambda: "never")
    assert spy.fired
    assert spy.calls[0]["reraise"] is True


# ── coverage: the table above is DERIVED-CHECKED, not trusted ────────────────

# Modules covered by a behavioural binding test in THIS file.
BOUND_HERE = {
    "api/index_bars.py",
    "api/routers/charts.py",
    "api/services/catalyst/ticker_metadata.py",
    "api/services/dividends_calendar.py",
    "api/services/engine.py",
    "api/services/fundamentals.py",
    "api/services/industry_map.py",
    "api/services/institutional_holdings.py",
    "api/services/massive.py",
    "api/services/news_aggregator.py",
    "api/services/options_chain.py",
    "api/services/short_interest.py",
    "api/services/ticker_logos.py",
    "api/services/ticker_meta.py",
    "api/services/yfinance_pool.py",
}


def test_every_yfinance_module_has_a_binding_proof_or_a_named_reason():
    """Read the module list off the AST rather than trusting the set above.

    A new module that imports yfinance lands in none of the three buckets and
    is named here — so "someone adds a module and forgets the guard" becomes a
    red test instead of a silent bypass discovered from a production log.
    """
    from tests.test_yf_guard_census import PRE_EXISTING_BINDING_PROOFS, QUARANTINE

    accounted = BOUND_HERE | set(PRE_EXISTING_BINDING_PROOFS) | set(QUARANTINE)
    reaching = set(cen.importers(cen.repo_root()))

    unaccounted = sorted(reaching - accounted)
    assert not unaccounted, (
        "these modules reach yfinance and have no binding proof:\n"
        + "\n".join(f"    {m}" for m in unaccounted)
        + "\n\nAdd a `test_<module>_reaches_yfinance_through_the_guard` here."
    )

    stale = sorted(accounted - reaching)
    assert not stale, (
        "these are listed as reaching yfinance but no longer do — delete the "
        "stale entry so the list keeps meaning something:\n"
        + "\n".join(f"    {m}" for m in stale)
    )
