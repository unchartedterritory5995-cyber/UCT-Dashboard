"""Regression test for data-dependability C24: `get_batch_returns` caches the
whole batch dict at the full 5-min success TTL even when a per-ticker fetch
timed out mid-batch -- the failed ticker's all-None row sat blank for 5 min
alongside its healthy peers in the SAME cached dict.
"""
import time
from unittest import mock

from api.services import watchlist_performance as wp
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class TestBatchReturnsCacheGate:
    def _cache_key(self, tickers):
        import hashlib
        deduped = sorted(set(t.upper() for t in tickers))
        return "wl_perf:" + hashlib.md5(",".join(deduped).encode()).hexdigest()

    def test_one_ticker_failure_gets_short_ttl_batch_still_served(self):
        key = self._cache_key(["AAPL", "MSFT"])
        cache.invalidate(key)

        def _fetch(ticker):
            if ticker == "MSFT":
                raise TimeoutError("massive slow")
            return {"1d": 1.2, "1w": 2.3, "1m": None, "3m": None, "ytd": None,
                    "5d": None, "30d": None, "60d": None, "90d": None,
                    "refs": {k: None for k in wp._REF_PERIODS}}

        with mock.patch.object(wp, "_fetch_ticker_returns", side_effect=_fetch):
            result = wp.get_batch_returns(["AAPL", "MSFT"])

        assert result["AAPL"]["1d"] == 1.2       # the healthy peer is still served
        assert result["MSFT"]["1d"] is None      # the failed one degrades honestly
        assert _ttl_remaining(key) <= wp._CACHE_TTL_PARTIAL + 2
        assert _ttl_remaining(key) < wp._CACHE_TTL

    def test_no_failures_gets_the_full_ttl(self):
        key = self._cache_key(["AAPL"])
        cache.invalidate(key)

        def _fetch(ticker):
            return {"1d": 1.2, "1w": None, "1m": None, "3m": None, "ytd": None,
                    "5d": None, "30d": None, "60d": None, "90d": None,
                    "refs": {k: None for k in wp._REF_PERIODS}}

        with mock.patch.object(wp, "_fetch_ticker_returns", side_effect=_fetch):
            result = wp.get_batch_returns(["AAPL"])

        assert result["AAPL"]["1d"] == 1.2
        assert _ttl_remaining(key) > wp._CACHE_TTL - 2
