"""The hot set: what members keep asking for, rendered before they ask."""
from __future__ import annotations

import pytest

from api.services import discord_chart_cache as cache
from api.services import discord_chart_hotset as hot
from api.services import discord_chart_prefs as p
from api.services.discord_interactions import ChartRequest, warm_hot_charts

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 200


def bars(n=30):
    return [{"t": f"2026-08-{(i % 28) + 1:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(n)]


@pytest.fixture(autouse=True)
def _clean():
    hot.clear_for_tests(); cache.clear()
    yield
    hot.clear_for_tests(); cache.clear()


def test_only_recent_and_going_stale_charts_are_warmed():
    clock = [1000.0]
    now = lambda: clock[0]                                       # noqa: E731
    hot.record("SPY:D:default", ChartRequest("SPY", "D"), dict(p.DEFAULTS), 120, now=now)
    hot.record("OLD:D:default", ChartRequest("OLD", "D"), dict(p.DEFAULTS), 120, now=now)
    ages = {"SPY:D:default": 10.0}                               # fresh in the cache
    due = hot.due(lambda k: ages.get(k), limit=8, now=now)
    assert [k for k, _, _ in due] == ["OLD:D:default"]           # SPY is still fresh; OLD is not cached
    ages["SPY:D:default"] = 120 * hot.REFRESH_AT + 1             # now past the refresh point
    assert {k for k, _, _ in hot.due(lambda k: ages.get(k), now=now)} == {"SPY:D:default", "OLD:D:default"}
    clock[0] += hot._RECENT_S + 1                                # nobody has asked in an hour
    assert hot.due(lambda k: ages.get(k), now=now) == []


def test_the_hot_set_is_bounded_and_keeps_the_most_asked_for():
    clock = [1000.0]
    now = lambda: clock[0]                                       # noqa: E731
    for i in range(hot._MAX_KEYS + 6):
        clock[0] += 1
        key = f"K{i}:D:default"
        for _ in range(2 if i == 0 else 1):                      # K0 is the most asked-for
            hot.record(key, ChartRequest(f"K{i}", "D"), dict(p.DEFAULTS), 120, now=now)
    keys = {k for k, _, _ in hot.snapshot()}
    assert len(keys) <= hot._MAX_KEYS
    assert "K0:D:default" in keys, "the most-requested chart was evicted"


def test_warming_puts_a_real_chart_in_the_cache_so_the_next_member_gets_a_hit():
    rendered = []
    key = "WARM:D:default"
    hot.record(key, ChartRequest("WARM", "D"), dict(p.DEFAULTS), 120)
    assert cache.get(key) is None
    warmed = warm_hot_charts(bars_fn=lambda *a: bars(), render_fn=lambda *a, **k: PNG,
                             house_fn=lambda t, tf, s, o: rendered.append(t) or PNG)
    assert warmed == [key] and rendered == ["WARM"]
    hit = cache.get(key)
    assert hit and hit[0] == PNG                                  # the next member pays nothing
    # already fresh ⇒ the next cycle leaves it alone
    rendered.clear()
    assert warm_hot_charts(bars_fn=lambda *a: bars(), render_fn=lambda *a, **k: PNG,
                           house_fn=lambda t, tf, s, o: rendered.append(t) or PNG) == []
    assert rendered == []


def test_a_failing_warm_never_raises_and_never_caches_a_dud():
    key = "BAD:D:default"
    hot.record(key, ChartRequest("BAD", "D"), dict(p.DEFAULTS), 120)
    def boom(*a, **k):
        raise RuntimeError("renderer down")
    assert warm_hot_charts(bars_fn=lambda *a: bars(), render_fn=boom, house_fn=boom) == []
    assert cache.get(key) is None


def test_the_cache_can_report_an_entrys_age_without_exposing_its_storage():
    clock = [500.0]
    now = lambda: clock[0]                                        # noqa: E731
    assert cache.age_of("NOPE", now=now) is None
    cache.put("AGE:D", PNG, "a.png", ttl_s=120, now=now)
    assert cache.age_of("AGE:D", now=now) == 0
    clock[0] += 30
    assert round(cache.age_of("AGE:D", now=now)) == 30
