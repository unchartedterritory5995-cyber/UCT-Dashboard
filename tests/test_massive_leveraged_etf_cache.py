"""Regression test for data-dependability C14: `_is_leveraged_etf`'s
`except -> result = False` used to cache the unverified `False` for the same
24h TTL as a real answer -- meaning a transient yfinance blip renders
TQQQ/SQQQ/SOXL etc. as ordinary stocks in Top Movers for a day.
"""
import time
from unittest import mock

from api.services import massive
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class TestLeveragedEtfCacheGate:
    def setup_method(self):
        cache.invalidate("is_lev_TQQQ")

    def test_empty_info_gets_short_ttl(self):
        """`.info` empty/None (yfinance blip) -> could not verify -> short TTL."""
        with mock.patch.object(massive, "_bounded_yf", return_value=None):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is False  # safe default this one call
        assert _ttl_remaining("is_lev_TQQQ") <= 300 + 5
        assert _ttl_remaining("is_lev_TQQQ") < 86400

    def test_exception_gets_short_ttl(self):
        with mock.patch.object(massive, "_bounded_yf", side_effect=RuntimeError("yfinance down")):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is False
        assert _ttl_remaining("is_lev_TQQQ") <= 300 + 5

    def test_verified_leveraged_gets_full_24h_ttl(self):
        """Control: a real, successful lookup (even a boring True/False
        answer) earns the long TTL -- this predicate must not block it."""
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "ProShares UltraPro QQQ", "shortName": "TQQQ"},
        ):
            result = massive._is_leveraged_etf("TQQQ")

        assert result is True
        assert _ttl_remaining("is_lev_TQQQ") > 86400 - 5

    def test_verified_not_leveraged_also_gets_full_24h_ttl(self):
        """Control: a real, successful lookup that correctly says False (a
        genuinely-not-leveraged ticker) must ALSO get the long TTL -- the
        fix distinguishes verified-vs-unverified, not True-vs-False."""
        with mock.patch.object(
            massive, "_bounded_yf",
            return_value={"longName": "Apple Inc.", "shortName": "AAPL"},
        ):
            cache.invalidate("is_lev_AAPL2")
            result = massive._is_leveraged_etf("AAPL2")

        assert result is False
        assert _ttl_remaining("is_lev_AAPL2") > 86400 - 5
