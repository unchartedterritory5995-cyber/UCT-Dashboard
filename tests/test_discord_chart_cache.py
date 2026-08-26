"""The PNG cache's TTL and its byte budget."""
from __future__ import annotations

import datetime as dt

import pytest

from api.services import discord_chart_cache as cache

ET = cache._ET


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    yield
    cache.clear()


def test_quiet_hours_hold_a_chart_far_longer_than_a_live_tape():
    live = dt.datetime(2026, 8, 26, 11, 0, tzinfo=ET)          # Wednesday, mid-session
    pre = dt.datetime(2026, 8, 26, 5, 30, tzinfo=ET)           # pre-market: the chip moves
    night = dt.datetime(2026, 8, 26, 23, 30, tzinfo=ET)        # nothing can change
    dawn = dt.datetime(2026, 8, 26, 3, 0, tzinfo=ET)
    sat = dt.datetime(2026, 8, 29, 12, 0, tzinfo=ET)
    assert not cache.market_quiet(live) and not cache.market_quiet(pre)
    assert cache.market_quiet(night) and cache.market_quiet(dawn) and cache.market_quiet(sat)
    assert cache.ttl_for("D", live) == 45 and cache.ttl_for("5", live) == 20
    assert cache.ttl_for("D", night) == cache._TTL_QUIET > 45 * 5
    assert cache.ttl_for("5", sat) == cache._TTL_QUIET
    # the boundaries themselves
    assert not cache.market_quiet(dt.datetime(2026, 8, 26, 4, 0, tzinfo=ET))
    assert cache.market_quiet(dt.datetime(2026, 8, 26, 20, 0, tzinfo=ET))


def test_the_cache_stays_inside_its_byte_budget_and_evicts_least_recently_used(monkeypatch):
    monkeypatch.setattr(cache, "_MAX_BYTES", 1000)
    clock = [1000.0]
    now = lambda: clock[0]                                      # noqa: E731
    for i in range(4):
        clock[0] += 1
        cache.put(f"K{i}", b"x" * 300, f"{i}.png", ttl_s=900, now=now)
    assert cache.cache_bytes() <= 1000
    # K0 was the oldest touch, so it is the one gone
    assert cache.get("K0", now=now) is None
    assert cache.get("K3", now=now) is not None
    # a HIT is a use: touching K1 saves it from the next eviction
    clock[0] += 1
    assert cache.get("K1", now=now) is not None
    clock[0] += 1
    cache.put("K9", b"y" * 300, "9.png", ttl_s=900, now=now)
    assert cache.get("K1", now=now) is not None
    assert cache.cache_bytes() <= 1000


def test_an_expired_entry_is_dropped_even_without_a_read():
    clock = [1000.0]
    now = lambda: clock[0]                                      # noqa: E731
    cache.put("OLD", b"z" * 10, "o.png", ttl_s=5, now=now)
    clock[0] += 10
    cache.put("NEW", b"z" * 10, "n.png", ttl_s=5, now=now)      # put sweeps expired first
    assert cache.get("OLD", now=now) is None
    assert cache.cache_bytes() == 10
