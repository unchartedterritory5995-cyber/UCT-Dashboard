"""Provider-call-count guards for the Company Panel.

These are COST tests. They assert how many times a provider is called, not what
comes back — a regression here does not break a feature, it quietly multiplies
the bill. Each one encodes a duplicate-call bug found by tracing a real user
journey on 7 Sep 2026.

Traced cold cost for one previously-unseen symbol, all five tabs:
    before   ~20 provider calls (FMP 13, Finnhub 7)
    after    ~11 provider calls
9 of the 20 were the same request repeated.
"""

from __future__ import annotations

import types
from collections import Counter

import pytest


class _Result:
    """Minimal stand-in for fmp_client's ProviderResult envelope."""

    def __init__(self, value):
        self.value = value
        self.degraded = None
        self.freshness = "fresh"
        self.licensing_class = "test"
        self.provenance = types.SimpleNamespace(
            vendor="fmp", source_activity="test", fetched_at="2026-09-07T00:00:00Z",
            source_observed_at="2026-09-07T00:00:00Z", tie_break=None)


@pytest.fixture(autouse=True)
def _clear_cache():
    from api.services.cache import cache
    try:
        cache.clear()
    except Exception:
        for attr in ("_data", "_store", "_cache"):
            d = getattr(cache, attr, None)
            if isinstance(d, dict):
                d.clear()
    yield


class TestEarningsHistoryFetchedOncePerSymbol:
    """`get_year_earnings` is cached per (ticker, YEAR), but both provider legs
    fetched the SAME full symbol history and filtered it to one year — so
    building four years made four identical provider calls per leg."""

    def test_fmp_earnings_history_fetched_once_for_many_years(self, monkeypatch):
        from api.services import earnings_estimates as ee
        from api.services import fmp_client

        calls = Counter()

        def fake_get_earnings(ticker, limit=None, **k):
            calls[ticker] += 1
            return _Result([{
                "date": "2026-06-24", "epsActual": 1.2, "epsEstimated": 1.1,
                "revenueActual": 1e10, "revenueEstimated": 9.8e9,
            }])

        monkeypatch.setattr(fmp_client, "get_earnings", fake_get_earnings)
        monkeypatch.setattr(ee, "_fh_get", lambda *a, **k: None)
        monkeypatch.setattr(ee, "_year_earnings_from_yf", lambda *a, **k: [])

        for year in (2026, 2025, 2024, 2023):
            ee.get_year_earnings("TESTA", year)

        assert calls["TESTA"] == 1, (
            f"FMP earnings history fetched {calls['TESTA']}x for one symbol "
            f"across 4 years; the rows are a superset and must be fetched once")

    def test_finnhub_earnings_history_fetched_once_for_many_years(self, monkeypatch):
        from api.services import earnings_estimates as ee
        from api.services import fmp_client

        fh_calls = Counter()

        def fake_fh(path, params=None, **k):
            fh_calls[path] += 1
            return [{"period": "2026-06-30", "actual": 1.2, "estimate": 1.1}]

        # FMP returns nothing so the Finnhub gap-fill leg always runs.
        monkeypatch.setattr(fmp_client, "get_earnings",
                            lambda *a, **k: _Result([]))
        monkeypatch.setattr(ee, "_fh_get", fake_fh)
        monkeypatch.setattr(ee, "_year_earnings_from_yf", lambda *a, **k: [])

        for year in (2026, 2025, 2024, 2023):
            ee.get_year_earnings("TESTB", year)

        assert fh_calls["/stock/earnings"] == 1, (
            f"Finnhub earnings history fetched {fh_calls['/stock/earnings']}x "
            f"for one symbol across 4 years")

    def test_a_failed_fetch_stays_retryable(self, monkeypatch):
        """A None/failure must NOT be memoized, or a transient outage would
        pin an empty answer for the whole TTL."""
        from api.services import earnings_estimates as ee
        from api.services import fmp_client

        calls = Counter()

        def failing(ticker, limit=None, **k):
            calls[ticker] += 1
            raise RuntimeError("provider down")

        monkeypatch.setattr(fmp_client, "get_earnings", failing)
        monkeypatch.setattr(ee, "_fh_get", lambda *a, **k: None)
        monkeypatch.setattr(ee, "_year_earnings_from_yf", lambda *a, **k: [])

        ee._year_earnings_from_fmp("TESTC", 2026)
        ee._year_earnings_from_fmp("TESTC", 2025)
        assert calls["TESTC"] == 2, "a failure must stay retryable, not be cached"


class TestThirteenFQuarterProbe:
    """13F filings lag ~45 days, so the newest candidate quarters reliably
    return nothing. The scan burned 3-4 provider calls PER SYMBOL rediscovering
    which quarter is filed — a fact identical for every symbol in the market."""

    def test_quarter_is_discovered_once_then_reused_across_symbols(self, monkeypatch):
        from api.services.research import ownership as own
        from api.services import fmp_client

        calls: list[tuple] = []
        # Only the 3rd candidate quarter has data, as in production.
        good = own._recent_quarters()[2]

        def fake_summary(symbol, year=None, quarter=None, **k):
            calls.append((symbol, year, quarter))
            if (year, quarter) == good:
                return _Result([{"investorsHolding": 100, "numberOf13Fshares": 5}])
            return _Result([])

        monkeypatch.setattr(fmp_client, "get_institutional_ownership_summary",
                            fake_summary)
        monkeypatch.setattr(fmp_client, "get_institutional_ownership_holders",
                            lambda *a, **k: _Result([]))

        own._thirteen_f("AAA")
        first = len(calls)
        assert first == 3, f"first symbol should scan to the filed quarter, got {first}"

        calls.clear()
        own._thirteen_f("BBB")
        own._thirteen_f("CCC")
        assert len(calls) == 2, (
            f"after the quarter is known, each further symbol should cost ONE "
            f"call; got {len(calls)} for two symbols: {calls}")
        assert all(c[1:] == good for c in calls), calls

    def test_a_wrong_hint_still_finds_the_data(self, monkeypatch):
        """The hint reorders the scan; it never replaces it."""
        from api.services.research import ownership as own
        from api.services.cache import cache
        from api.services import fmp_client

        quarters = own._recent_quarters()
        good = quarters[3]
        cache.set(own._TF_QUARTER_HINT_KEY, quarters[0], 3600)   # stale hint

        def fake_summary(symbol, year=None, quarter=None, **k):
            if (year, quarter) == good:
                return _Result([{"investorsHolding": 7}])
            return _Result([])

        monkeypatch.setattr(fmp_client, "get_institutional_ownership_summary",
                            fake_summary)
        monkeypatch.setattr(fmp_client, "get_institutional_ownership_holders",
                            lambda *a, **k: _Result([]))

        out = own._thirteen_f("DDD")
        assert out is not None and out.get("quarter") == f"{good[0]}Q{good[1]}"
