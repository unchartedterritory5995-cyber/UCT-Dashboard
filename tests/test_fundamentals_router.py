"""Tests for GET /api/fundamentals/{ticker}."""
from __future__ import annotations

import threading
import time
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.fundamentals import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── Helpers ────────────────────────────────────────────────────────────────────

_SAMPLE_FUND = {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "market_cap": "$3.00T",
    "pe_forward": 28.5,
    "beta": 1.24,
    "fifty_two_week_high": 199.62,
    "fifty_two_week_low": 124.17,
    "dividend_yield_pct": 0.5,
}

_SAMPLE_FH = {
    # ⚠️ Finnhub returns volume metrics in MILLIONS of shares. This fixture used
    # to say 55_000_000.0 — i.e. it encoded the same wrong provider contract the
    # router did, which is exactly why "0K avg volume" shipped: the test agreed
    # with the bug. Verified live 2026-08-04 against /stock/metric: AMD 29.65728,
    # AAPL 60.83381, F 64.44564 — those names' real ~30M/~61M/~64M daily volumes.
    # 55.0 here means 55 million shares.
    "10DayAverageTradingVolume": 55.0,
    "52WeekHigh": 199.62,
    "52WeekLow": 124.17,
}

# FMP's `stable/quote` fields (Task 9, primary source for week52/market_cap).
# ⚠️ UNIT: yearHigh/yearLow are plain dollars (same as Finnhub's 52WeekHigh/
# Low); marketCap is RAW DOLLARS (unlike Finnhub's marketCapitalization,
# which is millions) — verified live 2026-08-05, see fundamentals.py docstring.
_SAMPLE_FMP = {
    "yearHigh": 210.0,
    "yearLow": 120.0,
    "marketCap": 3_100_000_000_000.0,
    "priceAvg50": 190.0,
    "priceAvg200": 175.0,
    "volume": 55_000_000,
}


def _patch_services(fund=None, fh=None, fmp=None):
    """Return context managers that patch all three underlying data sources."""
    fund = fund if fund is not None else dict(_SAMPLE_FUND)
    fh_data = fh if fh is not None else dict(_SAMPLE_FH)
    fmp_data = fmp if fmp is not None else {}  # default: FMP absent -> exercises the Finnhub/yfinance fallback path

    p1 = patch("api.routers.fundamentals.get_fundamentals", return_value=fund)
    p2 = patch("api.routers.fundamentals._fh_metric_get", return_value=fh_data)
    p3 = patch("api.routers.fundamentals.cache.get", return_value=None)
    p4 = patch("api.routers.fundamentals.cache.set")
    p5 = patch("api.routers.fundamentals._fmp_metrics_get", return_value=fmp_data)
    return p1, p2, p3, p4, p5


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestFundamentalsEndpoint:
    def test_returns_expected_shape(self, client):
        p1, p2, p3, p4, p5 = _patch_services()
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "AAPL"
        assert data["market_cap"] == "$3.00T"
        assert data["forward_pe"] == 28.5
        assert data["beta"] == 1.24
        assert data["week52_high"] == 199.62
        assert data["week52_low"] == 124.17
        # The endpoint's documented contract is SHARES, so Finnhub's 55.0
        # (millions) must surface as 55,000,000. Without the normalization the
        # research modal's compactVol renders "0K" for every ticker.
        assert data["avg_vol"] == 55_000_000.0
        assert data["div_yield"] == 0.5

    def test_null_safe_missing_fields(self, client):
        """All fields nullable — should not error when yfinance returns partial data."""
        sparse = {"ticker": "XYZ"}
        p1, p2, p3, p4, p5 = _patch_services(fund=sparse, fh={})
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/XYZ")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "XYZ"
        assert data["forward_pe"] is None
        assert data["beta"] is None
        assert data["avg_vol"] is None

    def test_fundamentals_error_returns_nulls(self, client):
        """If get_fundamentals returns an error dict, endpoint still returns valid shape."""
        p1, p2, p3, p4, p5 = _patch_services(fund={"error": "yfinance failed", "ticker": "BAD"})
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/BAD")
        assert r.status_code == 200
        data = r.json()
        # All fields should be None, not raise
        assert data["forward_pe"] is None
        assert data["market_cap"] is None

    def test_exception_does_not_raise(self, client):
        """If get_fundamentals raises, endpoint returns empty-safe dict."""
        p1 = patch("api.routers.fundamentals.get_fundamentals", side_effect=RuntimeError("timeout"))
        p2, p3, p4, p5 = (
            patch("api.routers.fundamentals._fh_metric_get", return_value={}),
            patch("api.routers.fundamentals.cache.get", return_value=None),
            patch("api.routers.fundamentals.cache.set"),
            patch("api.routers.fundamentals._fmp_metrics_get", return_value={}),
        )
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/ERR")
        assert r.status_code == 200

    def test_cache_hit_returns_immediately(self, client):
        """Cache hit bypasses both data sources."""
        cached_val = {
            "ticker": "CACHED",
            "market_cap": "$1.00B",
            "forward_pe": 15.0,
            "beta": 0.9,
            "week52_high": 55.0,
            "week52_low": 30.0,
            "avg_vol": 1_000_000.0,
            "div_yield": 2.0,
        }
        with patch("api.routers.fundamentals.cache.get", return_value=cached_val) as mock_get, \
             patch("api.routers.fundamentals.get_fundamentals") as mock_fund:
            r = client.get("/api/fundamentals/CACHED")
        assert r.status_code == 200
        assert r.json()["ticker"] == "CACHED"
        mock_fund.assert_not_called()

    def test_finnhub_fallback_to_yfinance_52w(self, client):
        """When Finnhub has no 52-week data, falls back to yfinance values."""
        fund = dict(_SAMPLE_FUND)
        fund["fifty_two_week_high"] = 200.0
        fund["fifty_two_week_low"] = 125.0
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh={})  # empty fh, empty fmp (default)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["week52_high"] == 200.0
        assert data["week52_low"] == 125.0

    def test_empty_ticker_returns_empty(self, client):
        """Empty or whitespace-only ticker returns empty dict safely."""
        with patch("api.routers.fundamentals.cache.get", return_value=None):
            r = client.get("/api/fundamentals/%20")
        assert r.status_code == 200
        assert r.json() == {}

    def test_market_cap_falls_back_to_finnhub_when_yfinance_omits_it(self, client):
        """Real gap observed live 2026-08-05: yfinance's `.info` sometimes lacks
        `marketCap` entirely for a mega-cap (confirmed for AMD and JPM against
        the live provider) while Finnhub's /stock/metric — ALREADY fetched by
        this same function for avg_vol/52-week range — carries
        `marketCapitalization` (in millions) for the same ticker. The endpoint
        must fall back to it instead of surfacing a blank market_cap for a
        stock that unambiguously has one."""
        fund = dict(_SAMPLE_FUND)
        del fund["market_cap"]  # yfinance omitted the field entirely
        fh = dict(_SAMPLE_FH)
        fh["marketCapitalization"] = 860_125.5  # millions -> $860.13B
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh)  # fmp defaults to {} -> exercises the final Finnhub fallback
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AMD")
        data = r.json()
        assert data["market_cap"] == "$860.13B"

    def test_market_cap_prefers_yfinance_when_present(self, client):
        """yfinance stays primary — FMP and Finnhub are fallbacks only, never
        override a value yfinance already resolved."""
        fund = dict(_SAMPLE_FUND)  # market_cap = "$3.00T"
        fh = dict(_SAMPLE_FH)
        fh["marketCapitalization"] = 1.0  # would format very differently
        fmp = dict(_SAMPLE_FMP)  # marketCap = 3.1T -- also would format differently
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh, fmp=fmp)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["market_cap"] == "$3.00T"

    def test_market_cap_stays_null_when_both_sources_lack_it(self, client):
        """No fabricated fallback when neither source has a market cap — stays
        an honest null rather than inventing a number."""
        fund = dict(_SAMPLE_FUND)
        del fund["market_cap"]
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh={})  # no marketCapitalization/marketCap anywhere
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AMD")
        data = r.json()
        assert data["market_cap"] is None

    # ── FMP trio: field mapping (Task 9) ────────────────────────────────────

    def test_week52_prefers_fmp_quote_over_finnhub(self, client):
        """FMP `stable/quote`'s yearHigh/yearLow are now PRIMARY -- Finnhub is
        only consulted when FMP has nothing for this field."""
        fund = dict(_SAMPLE_FUND)
        fh = dict(_SAMPLE_FH)  # 52WeekHigh=199.62/52WeekLow=124.17 -- would win if FMP were ignored
        fmp = dict(_SAMPLE_FMP)  # yearHigh=210.0/yearLow=120.0
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh, fmp=fmp)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["week52_high"] == 210.0
        assert data["week52_low"] == 120.0

    def test_week52_falls_back_to_finnhub_when_fmp_quote_leg_missing(self, client):
        """Missing-field-renders-fallback case: when FMP's merged dict lacks
        yearHigh/yearLow entirely (e.g. the quote leg failed while
        key-metrics-ttm/ratios-ttm succeeded), Finnhub is still consulted --
        it is a real fallback, not dead code."""
        fund = dict(_SAMPLE_FUND)
        fh = dict(_SAMPLE_FH)
        fmp = {"grossProfitMarginTTM": 0.47}  # ratios-ttm leg only, no quote fields
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh, fmp=fmp)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["week52_high"] == 199.62
        assert data["week52_low"] == 124.17

    def test_week52_missing_everywhere_renders_none_not_zero(self, client):
        """Missing-field-renders-None case: when FMP, Finnhub, AND yfinance
        all lack 52-week data, the field is an honest null -- never 0 or a
        substituted stat."""
        fund = dict(_SAMPLE_FUND)
        del fund["fifty_two_week_high"]
        del fund["fifty_two_week_low"]
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh={}, fmp={})
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/ZZZ")
        data = r.json()
        assert data["week52_high"] is None
        assert data["week52_low"] is None

    def test_market_cap_falls_back_to_fmp_quote_when_yfinance_omits_it(self, client):
        """FMP `stable/quote`'s marketCap is the FIRST fallback when yfinance
        has nothing -- ahead of Finnhub, which now only applies when FMP also
        comes back empty. Also the load-bearing UNIT-CONVERSION assertion:
        FMP's marketCap (3,100,000,000,000 -- RAW DOLLARS) must NOT be
        multiplied by 1e6 the way Finnhub's marketCapitalization is (that
        field is in MILLIONS). Multiplying the FMP value by 1e6 would render
        an absurd "$3100000.00T" instead of the correct "$3.10T"."""
        fund = dict(_SAMPLE_FUND)
        del fund["market_cap"]
        fh = dict(_SAMPLE_FH)
        fh["marketCapitalization"] = 1.0  # would format very differently if wrongly preferred
        fmp = dict(_SAMPLE_FMP)  # marketCap = 3_100_000_000_000.0
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh, fmp=fmp)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["market_cap"] == "$3.10T"

    def test_avg_vol_never_sourced_from_fmp(self, client):
        """avg_vol has NO FMP equivalent in the quote/key-metrics-ttm/
        ratios-ttm trio (verified live -- FMP's only volume field is a single
        day's `volume`, not an average). Even when the FMP leg carries a
        `volume` key (a real field on stable/quote), it must NEVER be read
        into avg_vol -- that would be exactly the "substituted stat" the
        honest-degradation law forbids (today's volume != a 10-day average)."""
        fund = dict(_SAMPLE_FUND)
        fh = {}  # no Finnhub volume data at all
        fmp = dict(_SAMPLE_FMP)  # carries volume=55_000_000 -- must be ignored for avg_vol
        p1, p2, p3, p4, p5 = _patch_services(fund=fund, fh=fh, fmp=fmp)
        with p1, p2, p3, p4, p5:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["avg_vol"] is None


class TestCachePolicy:
    """The memory cache write and the disk persist are gated by the SAME
    completeness predicate -- before this fix only the persist was, so a
    fully-failed build (both get_fundamentals and the Finnhub metric leg
    empty) still pinned a blank in memory for the full 1-hour TTL."""

    def _spy(self, monkeypatch):
        import api.routers.fundamentals as router_mod
        seen = {}
        real_set = router_mod.cache.set

        def spy(key, value, ttl=None):
            if key == "api_fund::TESTCP":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        monkeypatch.setattr(router_mod.cache, "set", spy)
        return seen, router_mod

    def test_a_complete_build_gets_the_full_ttl_and_is_persisted(self, client, monkeypatch):
        seen, router_mod = self._spy(monkeypatch)
        persisted = {}
        monkeypatch.setattr(router_mod.snap_store, "put",
                            lambda kind, sym, out, ttl: persisted.__setitem__(sym, out))
        p1, p2, p3, p4 = (
            patch("api.routers.fundamentals.get_fundamentals", return_value=dict(_SAMPLE_FUND)),
            patch("api.routers.fundamentals._fh_metric_get", return_value=dict(_SAMPLE_FH)),
            patch("api.routers.fundamentals.cache.get", return_value=None),
            patch("api.routers.fundamentals._fmp_metrics_get", return_value={}),
        )
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/TESTCP")
        assert r.status_code == 200
        assert seen.get("ttl") == router_mod._FH_METRIC_TTL
        assert "TESTCP" in persisted

    def test_all_sources_failing_gets_the_short_ttl_and_is_not_persisted(self, client, monkeypatch):
        """THE regression: before this fix `cache.set` at the router level ran
        unconditionally at the full 1-hour TTL even when every field in the
        result was None."""
        seen, router_mod = self._spy(monkeypatch)
        persisted = {}
        monkeypatch.setattr(router_mod.snap_store, "put",
                            lambda kind, sym, out, ttl: persisted.__setitem__(sym, out))
        p1, p2, p3, p4 = (
            patch("api.routers.fundamentals.get_fundamentals",
                 return_value={"error": "yfinance failed", "ticker": "TESTCP"}),
            patch("api.routers.fundamentals._fh_metric_get", return_value={}),
            patch("api.routers.fundamentals.cache.get", return_value=None),
            patch("api.routers.fundamentals._fmp_metrics_get", return_value={}),
        )
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/TESTCP")
        assert r.status_code == 200
        data = r.json()
        assert all(v is None for k, v in data.items() if k != "ticker")
        assert seen.get("ttl") == router_mod._FUND_FAIL_TTL
        assert seen.get("ttl") < router_mod._FH_METRIC_TTL
        assert "TESTCP" not in persisted


class TestFmpMetricsTrio:
    """Unit tests for `_fmp_metrics_get` itself -- the 3-way FMP fan-out
    (Task 9). These patch the LOW-LEVEL `_fmp_get` (one FMP GET) rather than
    `_fmp_metrics_get`, so the real fan-out/merge/bounding code under test
    actually runs."""

    def _clear_cache(self, monkeypatch):
        """`_fmp_metrics_get` checks `cache.get` first -- force every call in
        this class to actually run the fan-out instead of serving a
        cross-test cache hit."""
        import api.routers.fundamentals as router_mod
        monkeypatch.setattr(router_mod.cache, "get", lambda k: None)
        monkeypatch.setattr(router_mod.cache, "set", lambda *a, **k: None)
        return router_mod

    def test_fmp_merges_fields_from_all_three_endpoints(self, monkeypatch):
        """Field mapping for each of the 3 FMP endpoints: quote's yearHigh,
        key-metrics-ttm's currentRatioTTM/grahamNumberTTM, and ratios-ttm's
        grossProfitMarginTTM all land in the ONE merged dict `_build_snapshot`
        reads from -- proving all three legs are actually fetched and parsed,
        not just `quote`."""
        router_mod = self._clear_cache(monkeypatch)

        def fake_fmp_get(path, params, timeout):
            if path == "quote":
                return [{"symbol": "AAPL", "yearHigh": 210.0, "yearLow": 120.0, "marketCap": 3.1e12}]
            if path == "key-metrics-ttm":
                return [{"symbol": "AAPL", "currentRatioTTM": 1.5, "grahamNumberTTM": 88.2}]
            if path == "ratios-ttm":
                return [{"symbol": "AAPL", "grossProfitMarginTTM": 0.47, "netProfitMarginTTM": 0.25}]
            raise AssertionError(f"unexpected FMP path {path!r}")

        monkeypatch.setattr(router_mod, "_fmp_get", fake_fmp_get)
        merged = router_mod._fmp_metrics_get("AAPL")
        # quote
        assert merged.get("yearHigh") == 210.0
        assert merged.get("yearLow") == 120.0
        assert merged.get("marketCap") == 3.1e12
        # key-metrics-ttm
        assert merged.get("currentRatioTTM") == 1.5
        assert merged.get("grahamNumberTTM") == 88.2
        # ratios-ttm
        assert merged.get("grossProfitMarginTTM") == 0.47
        assert merged.get("netProfitMarginTTM") == 0.25

    def test_fmp_pool_size_matches_declared_endpoint_count(self, monkeypatch):
        """The pool is bounded to exactly one worker per endpoint -- asserts
        the ACTUAL constant used to construct the executor, not an indirect
        proxy."""
        import api.routers.fundamentals as router_mod
        assert router_mod._FMP_POOL_WORKERS == len(router_mod._FMP_ENDPOINTS) == 3

        self._clear_cache(monkeypatch)
        captured = {}
        real_executor_cls = router_mod.ThreadPoolExecutor

        class SpyExecutor(real_executor_cls):
            def __init__(self, *a, **kw):
                captured["max_workers"] = kw.get("max_workers", a[0] if a else None)
                super().__init__(*a, **kw)

        monkeypatch.setattr(router_mod, "ThreadPoolExecutor", SpyExecutor)
        monkeypatch.setattr(router_mod, "_fmp_get", lambda path, params, timeout: [{"x": 1}])
        router_mod._fmp_metrics_get("AAPL")
        assert captured["max_workers"] == router_mod._FMP_POOL_WORKERS

    def test_fmp_fanout_returns_partial_when_one_leg_is_slow(self, monkeypatch):
        """A slow leg doesn't discard the fast legs' data -- partial results
        within the budget are still honored (Global Constraints: 'a partial
        is still served'), matching the honest-degradation law rather than
        an all-or-nothing fan-out."""
        router_mod = self._clear_cache(monkeypatch)

        def fake_fmp_get(path, params, timeout):
            if path == "quote":
                time.sleep(0.6)  # far longer than the 0.1s budget below -- never finishes in time
                return [{"yearHigh": 999.0}]
            return [{path.replace("-", "_"): True}]

        monkeypatch.setattr(router_mod, "_fmp_get", fake_fmp_get)
        monkeypatch.setattr(router_mod, "_FMP_TOTAL_TIMEOUT", 0.1)
        merged = router_mod._fmp_metrics_get("AAPL")
        assert "yearHigh" not in merged  # the slow quote leg was abandoned
        assert merged.get("key_metrics_ttm") is True
        assert merged.get("ratios_ttm") is True

    def test_fmp_fanout_respects_hard_total_timeout(self, monkeypatch):
        """THE fan-out-bound guard (mutation-control target): every FMP leg
        hangs well past the total budget. `_fmp_metrics_get` must still
        return in roughly `_FMP_TOTAL_TIMEOUT`, NOT block for the full sleep
        duration -- proving the hard total timeout actually bounds the
        request-path wait instead of degrading to 'wait for the slowest leg'
        (the 524-outage class named in the plan's Global Constraints)."""
        router_mod = self._clear_cache(monkeypatch)
        monkeypatch.setattr(router_mod, "_FMP_TOTAL_TIMEOUT", 0.2)

        def hanging_fmp_get(path, params, timeout):
            time.sleep(1.5)  # far longer than the 0.2s budget
            return [{"yearHigh": 1.0}]

        monkeypatch.setattr(router_mod, "_fmp_get", hanging_fmp_get)
        start = time.monotonic()
        merged = router_mod._fmp_metrics_get("AAPL")
        elapsed = time.monotonic() - start
        assert merged == {}  # nothing completed within the budget
        assert elapsed < 1.0  # bounded near the 0.2s budget, nowhere near the 1.5s sleep
