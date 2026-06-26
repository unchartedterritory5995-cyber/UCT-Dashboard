"""Tests for the catalyst premarket health evaluation (pure decision)."""
from api.services.catalyst.health import evaluate_health, _dead_sources

_NOW = 1_000_000.0


def _fresh(min_ago):
    return _NOW - min_ago * 60.0


def test_healthy_morning():
    s = evaluate_health(7, _fresh(5), {"universe": 300, "movers": 120}, _NOW)
    assert s["healthy"] is True
    assert s["issues"] == []


def test_empty_board_flagged():
    s = evaluate_health(0, _fresh(5), {"universe": 300}, _NOW)
    assert s["healthy"] is False
    assert "empty" in s["issues"]


def test_stale_board_flagged():
    s = evaluate_health(7, _fresh(60), {"universe": 300}, _NOW)
    assert "stale" in s["issues"]
    assert s["healthy"] is False


def test_never_refreshed_is_stale():
    s = evaluate_health(0, None, {"universe": 300}, _NOW)
    assert "stale" in s["issues"]
    assert "empty" in s["issues"]


def test_sources_down_flagged():
    s = evaluate_health(7, _fresh(5), {"universe": 4, "movers": 0}, _NOW)
    assert "sources_down" in s["issues"]


def test_no_universe_stats_no_false_positive():
    # Before the first pull of the day we have no stats — don't cry "sources_down".
    s = evaluate_health(7, _fresh(5), {}, _NOW)
    assert "sources_down" not in s["issues"]
    assert s["healthy"] is True


def test_dead_sources_lists_only_zero_named_pulls():
    stats = {"movers": 100, "perplexity": 0, "rss": 0, "universe": 100, "at": 123}
    assert _dead_sources(stats) == ["perplexity", "rss"]
