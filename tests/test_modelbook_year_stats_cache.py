"""Regression test for data-dependability C11: `_compute_year_stats`'s bare
`except: pass` used to cache the all-None default at the same 24h TTL as a
real result -- indistinguishable from "computed, genuinely nothing to show."
"""
import time
from unittest import mock

from api.routers import modelbook as mb
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class TestYearStatsCacheGate:
    def setup_method(self):
        cache.invalidate("modelbook_yearstats_TEST_2020")

    def test_bars_fetch_failure_gets_short_ttl(self):
        with mock.patch.object(mb, "_load_year_bars", side_effect=RuntimeError("bars down")):
            stats = mb._compute_year_stats("TEST", 2020)

        assert stats == {"open_close_pct": None, "low_high_pct": None, "avg_vol": None}
        assert _ttl_remaining("modelbook_yearstats_TEST_2020") <= 1800 + 5
        assert _ttl_remaining("modelbook_yearstats_TEST_2020") < 86400

    def test_empty_bars_gets_short_ttl(self):
        """No exception, but `_load_year_bars` returns [] -- same failure shape."""
        with mock.patch.object(mb, "_load_year_bars", return_value=[]):
            stats = mb._compute_year_stats("TEST", 2020)

        assert stats["open_close_pct"] is None
        assert _ttl_remaining("modelbook_yearstats_TEST_2020") <= 1800 + 5

    def test_real_bars_get_the_full_24h_ttl(self):
        """Control: a real, successful bar pull still earns the long TTL."""
        bars = [
            {"o": 100.0, "c": 105.0, "l": 95.0, "h": 110.0, "v": 1_000_000},
            {"o": 105.0, "c": 120.0, "l": 100.0, "h": 125.0, "v": 2_000_000},
        ]
        with mock.patch.object(mb, "_load_year_bars", return_value=bars):
            stats = mb._compute_year_stats("TEST", 2020)

        assert stats["open_close_pct"] == 20.0
        assert _ttl_remaining("modelbook_yearstats_TEST_2020") > 86400 - 5
