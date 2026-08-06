"""Regression test for data-dependability C18: `get_recent_insider_buys`
caches the whole feed batch at the full 1h success TTL even when the Finnhub
budget was denied mid-fan-out (~55 tickers x 1 call each can exceed the
account's per-minute budget within a single build). A budget-shed ticker
returns [] indistinguishably from "no insider buys this week."

(The per-ticker `get_insider_activity` cache at insider.py:61 was examined
and found NOT a live poison after the 2026-08-05 fh_get migration: `fh_get`
already returns None -- never a fabricated {"data": []} -- on every failure/
denial path, and insider.py's own `if not isinstance(data, dict): return []`
already skips the cache.set entirely on that branch. See task report.)
"""
import time
from unittest import mock

from api.services import insider
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class TestInsiderFeedThrottleTtl:
    def setup_method(self):
        cache.invalidate("insider_feed")

    def test_budget_denied_mid_fanout_gets_short_ttl(self, monkeypatch):
        monkeypatch.setattr(insider, "_get_feed_tickers", lambda: ["AAPL", "MSFT"])
        monkeypatch.setattr(insider, "get_insider_activity", lambda tk: [])

        counter = {"n": 0}

        def _denied_total():
            # First call (before the fan-out) returns 0; every call AFTER
            # that returns 1 -- simulates a denial happening during the
            # fan-out window.
            counter["n"] += 1
            return 0 if counter["n"] == 1 else 1

        monkeypatch.setattr(insider, "fh_budget_denied_total", _denied_total)

        result = insider.get_recent_insider_buys()

        assert result == []
        assert _ttl_remaining("insider_feed") <= insider._FEED_FAIL_TTL + 5
        assert _ttl_remaining("insider_feed") < insider._FEED_TTL

    def test_no_denial_gets_the_full_1h_ttl(self, monkeypatch):
        """Control: a clean fan-out (no Finnhub denial) keeps the normal TTL,
        even for a genuinely-empty result (no insider buys this week)."""
        monkeypatch.setattr(insider, "_get_feed_tickers", lambda: ["AAPL", "MSFT"])
        monkeypatch.setattr(insider, "get_insider_activity", lambda tk: [])
        monkeypatch.setattr(insider, "fh_budget_denied_total", lambda: 0)

        result = insider.get_recent_insider_buys()

        assert result == []
        assert _ttl_remaining("insider_feed") > insider._FEED_TTL - 5
