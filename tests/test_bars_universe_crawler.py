"""Instant-origin Phase 2 v2 — the gentle universe 5m crawler.

These pin the properties that make it the ANTI-THRASH design (the boot-bulk v1 saturated
the provider + write-lock): it warms only stale/missing tickers, skips fresh ones with
NO rate-limit cost, paces exactly one sleep per actual fetch, never lets a bad ticker
stop the sweep, and rotates its cursor so coverage is fair across restarts.
"""
from __future__ import annotations

from api.services import bars_universe_crawler as C


def _recorder():
    calls = {"warm": [], "pace": 0, "beat": 0}
    def warm(sym): calls["warm"].append(sym)
    def pace(): calls["pace"] += 1
    def beat(): calls["beat"] += 1
    return calls, warm, pace, beat


def test_only_stale_tickers_are_warmed_fresh_are_skipped_free():
    universe = ["A", "B", "C", "D"]
    stale = {"B", "D"}
    calls, warm, pace, beat = _recorder()
    cursor, warmed, skipped = C.crawl_pass(
        universe, 0, is_stale=lambda s: s in stale, warm=warm, pace=pace, beat=beat)
    assert calls["warm"] == ["B", "D"], "only stale tickers warm"
    assert warmed == 2 and skipped == 2


def test_pace_is_called_exactly_once_per_ACTUAL_warm():
    """The rate-limit must apply per FETCH, not per iteration — else a warm universe
    would sleep 3,800x per pass (the whole point is skips are free)."""
    universe = ["A", "B", "C", "D", "E"]
    stale = {"C"}
    calls, warm, pace, beat = _recorder()
    C.crawl_pass(universe, 0, is_stale=lambda s: s in stale, warm=warm, pace=pace, beat=beat)
    assert calls["pace"] == 1, "one pace per warm, zero for skips"
    assert calls["beat"] == 5, "beats every step (liveness)"


def test_an_all_fresh_universe_costs_zero_paces():
    universe = ["A", "B", "C"]
    calls, warm, pace, beat = _recorder()
    _, warmed, skipped = C.crawl_pass(
        universe, 0, is_stale=lambda s: False, warm=warm, pace=pace, beat=beat)
    assert warmed == 0 and skipped == 3 and calls["pace"] == 0 and calls["warm"] == []


def test_a_throwing_warm_never_stops_the_sweep():
    universe = ["A", "B", "C"]
    def warm(sym):
        if sym == "B":
            raise RuntimeError("provider blip")
    calls, _, pace, beat = _recorder()
    _, warmed, skipped = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, pace=pace, beat=beat)
    # A + C warmed; B counted as skipped (failed), sweep completed all 3.
    assert warmed == 2 and skipped == 1


def test_cursor_rotates_so_restarts_cover_different_tickers():
    universe = ["A", "B", "C", "D"]
    calls, warm, pace, beat = _recorder()
    # budget=2 stops after 2 warms; cursor must resume past them.
    cursor, warmed, _ = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, pace=pace, beat=beat, budget=2)
    assert warmed == 2 and calls["warm"] == ["A", "B"]
    calls2, warm2, pace2, beat2 = _recorder()
    C.crawl_pass(universe, cursor, is_stale=lambda s: True, warm=warm2, pace=pace2,
                 beat=beat2, budget=2)
    assert calls2["warm"] == ["C", "D"], "second pass resumes where the first stopped"


def test_budget_caps_warms_per_pass():
    universe = [f"T{i}" for i in range(50)]
    calls, warm, pace, beat = _recorder()
    _, warmed, _ = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, pace=pace, beat=beat, budget=5)
    assert warmed == 5 and calls["pace"] == 5


def test_empty_universe_is_a_safe_noop():
    calls, warm, pace, beat = _recorder()
    cursor, warmed, skipped = C.crawl_pass(
        [], 0, is_stale=lambda s: True, warm=warm, pace=pace, beat=beat)
    assert (cursor, warmed, skipped) == (0, 0, 0) and calls["warm"] == []


def test_disabled_crawler_is_inert(monkeypatch):
    monkeypatch.delenv("BARS_UNIVERSE_CRAWLER_ENABLED", raising=False)
    # returns immediately without loading a universe or warming
    C.run_universe_crawler_forever()
    hb = C.crawler_heartbeat()
    assert hb["enabled"] is False


def test_load_universe_dedups_and_uppercases(monkeypatch, tmp_path):
    import json
    p = tmp_path / "cap_universe.json"
    p.write_text(json.dumps(["aapl", "MSFT", "aapl", "nvda"]))
    monkeypatch.setattr(C.os.path, "join", lambda *a: str(p))
    u = C.load_universe()
    assert u == ["AAPL", "MSFT", "NVDA"]
