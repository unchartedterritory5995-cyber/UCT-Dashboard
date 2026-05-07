"""Tests for api.services.cache.

The TTL cache underpins the bars hot path. Recent additions (delete_prefix)
need coverage so the refresh-bars admin endpoint actually wipes everything
it claims to."""
import time

from api.services.cache import TTLCache


def test_get_set_round_trip():
    c = TTLCache()
    c.set("k1", "v1", ttl=60)
    assert c.get("k1") == "v1"


def test_get_returns_none_for_expired():
    c = TTLCache()
    c.set("k1", "v1", ttl=-1)  # already expired
    assert c.get("k1") is None


def test_invalidate_removes_key():
    c = TTLCache()
    c.set("k1", "v1", ttl=60)
    c.invalidate("k1")
    assert c.get("k1") is None


def test_invalidate_missing_key_is_noop():
    """Invalidating a non-existent key must NOT raise — defensive callers
    invalidate before knowing whether the key was set."""
    c = TTLCache()
    c.invalidate("never-set")  # raises if not safe


# ── delete_prefix ────────────────────────────────────────────────────────

def test_delete_prefix_returns_count_of_deletions():
    """Every key starting with the prefix must go. Return value must
    accurately reflect how many were dropped — that's what the
    /api/admin/refresh-bars endpoint reports back to the operator."""
    c = TTLCache()
    c.set("bars_AAPL_30_200", "x", ttl=60)
    c.set("bars_AAPL_30_500", "x", ttl=60)
    c.set("bars_AAPL_60_200", "x", ttl=60)  # different tf, won't match prefix
    c.set("bars_TSLA_30_200", "x", ttl=60)  # different ticker

    n = c.delete_prefix("bars_AAPL_30_")
    assert n == 2
    assert c.get("bars_AAPL_30_200") is None
    assert c.get("bars_AAPL_30_500") is None
    # Non-matching keys preserved
    assert c.get("bars_AAPL_60_200") == "x"
    assert c.get("bars_TSLA_30_200") == "x"


def test_delete_prefix_empty_match_returns_zero():
    """Prefix matching nothing returns 0 and doesn't crash."""
    c = TTLCache()
    c.set("foo", "v", ttl=60)
    assert c.delete_prefix("nope_") == 0
    assert c.get("foo") == "v"


def test_delete_prefix_full_ticker_wipe():
    """Refresh-bars without a tf parameter calls delete_prefix with
    just ``bars_{TICKER}_`` — must wipe every timeframe for that ticker.
    This is the "blast radius" semantic the endpoint promises."""
    c = TTLCache()
    c.set("bars_AAPL_1_200", "x", ttl=60)
    c.set("bars_AAPL_30_200", "x", ttl=60)
    c.set("bars_AAPL_D_200", "x", ttl=60)
    c.set("bars_AAPL_W_200", "x", ttl=60)
    c.set("bars_TSLA_30_200", "x", ttl=60)  # different ticker, must survive

    n = c.delete_prefix("bars_AAPL_")
    assert n == 4
    assert c.get("bars_TSLA_30_200") == "x"
