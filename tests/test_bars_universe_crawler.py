"""Instant-origin Phase 2 v2 — the gentle universe 5m crawler.

These pin the properties that make it the ANTI-THRASH design (the boot-bulk v1 saturated
the provider + write-lock): it warms only stale/missing tickers, skips fresh ones with
NO rate-limit cost, paces once per provider attempt, parks no-data tickers so a run
SETTLES instead of retrying them forever, never lets a bad ticker stop the sweep, and
rotates its cursor so coverage is fair across restarts.
"""
from __future__ import annotations

from api.services import bars_universe_crawler as C


def _recorder(fill=lambda s: True):
    calls = {"warm": [], "empty": [], "pace": 0, "beat": 0}
    def warm(sym):
        calls["warm"].append(sym)
        return fill(sym)
    def on_empty(sym): calls["empty"].append(sym)
    def pace(): calls["pace"] += 1
    def beat(): calls["beat"] += 1
    return calls, warm, on_empty, pace, beat


def test_only_stale_tickers_are_warmed_fresh_are_skipped_free():
    universe = ["A", "B", "C", "D"]
    stale = {"B", "D"}
    calls, warm, on_empty, pace, beat = _recorder()
    cursor, filled, skipped, empty = C.crawl_pass(
        universe, 0, is_stale=lambda s: s in stale, warm=warm, on_empty=on_empty,
        pace=pace, beat=beat)
    assert calls["warm"] == ["B", "D"], "only stale tickers warm"
    assert filled == 2 and skipped == 2 and empty == 0


def test_pace_is_called_once_per_ATTEMPT_not_per_iteration():
    """Rate-limit applies per provider hit (fill OR empty), never for skips — else a
    warm universe would sleep thousands of times per pass."""
    universe = ["A", "B", "C", "D", "E"]
    stale = {"C", "E"}
    calls, warm, on_empty, pace, beat = _recorder()
    C.crawl_pass(universe, 0, is_stale=lambda s: s in stale, warm=warm,
                 on_empty=on_empty, pace=pace, beat=beat)
    assert calls["pace"] == 2, "one pace per attempt (C,E), zero for skips"
    assert calls["beat"] == 5, "beats every step (liveness)"


def test_empty_warms_are_parked_via_on_empty():
    """A fetch that returns nothing (thin ticker) is reported through on_empty so the
    daemon can cooldown it — the mechanism that lets the crawler settle."""
    universe = ["A", "B", "C"]
    calls, warm, on_empty, pace, beat = _recorder(fill=lambda s: s != "B")
    _, filled, skipped, empty = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, on_empty=on_empty,
        pace=pace, beat=beat)
    assert filled == 2 and empty == 1 and calls["empty"] == ["B"]
    assert calls["pace"] == 3, "both fills and the empty hit the provider → paced"


def test_an_all_fresh_universe_costs_zero_paces():
    universe = ["A", "B", "C"]
    calls, warm, on_empty, pace, beat = _recorder()
    _, filled, skipped, empty = C.crawl_pass(
        universe, 0, is_stale=lambda s: False, warm=warm, on_empty=on_empty,
        pace=pace, beat=beat)
    assert filled == 0 and skipped == 3 and empty == 0 and calls["pace"] == 0


def test_a_throwing_warm_never_stops_the_sweep():
    universe = ["A", "B", "C"]
    def warm(sym):
        if sym == "B":
            raise RuntimeError("provider blip")
        return True
    _, filled, skipped, empty = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm,
        on_empty=lambda s: None, pace=lambda: None, beat=lambda: None)
    assert filled == 2 and skipped == 1  # A + C filled; B failed → skipped; sweep finished


def test_cursor_rotates_so_restarts_cover_different_tickers():
    universe = ["A", "B", "C", "D"]
    calls, warm, on_empty, pace, beat = _recorder()
    cursor, filled, _, _ = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, on_empty=on_empty,
        pace=pace, beat=beat, budget=2)
    assert filled == 2 and calls["warm"] == ["A", "B"]
    calls2, warm2, on_empty2, pace2, beat2 = _recorder()
    C.crawl_pass(universe, cursor, is_stale=lambda s: True, warm=warm2,
                 on_empty=on_empty2, pace=pace2, beat=beat2, budget=2)
    assert calls2["warm"] == ["C", "D"], "second pass resumes where the first stopped"


def test_budget_caps_attempts_per_pass():
    universe = [f"T{i}" for i in range(50)]
    calls, warm, on_empty, pace, beat = _recorder()
    _, filled, _, _ = C.crawl_pass(
        universe, 0, is_stale=lambda s: True, warm=warm, on_empty=on_empty,
        pace=pace, beat=beat, budget=5)
    assert filled == 5 and calls["pace"] == 5


def test_empty_universe_is_a_safe_noop():
    cursor, filled, skipped, empty = C.crawl_pass(
        [], 0, is_stale=lambda s: True, warm=lambda s: True,
        on_empty=lambda s: None, pace=lambda: None, beat=lambda: None)
    assert (cursor, filled, skipped, empty) == (0, 0, 0, 0)


def test_no_data_cooldown_parks_then_reallows(monkeypatch):
    """_default_is_stale skips a parked ticker until its cooldown elapses, then allows
    exactly one retry."""
    C._NO_DATA_UNTIL.clear()
    monkeypatch.setenv("BARS_CRAWLER_EMPTY_COOLDOWN_SEC", "100")
    # freeze time
    t = {"now": 1000.0}
    monkeypatch.setattr(C._time, "time", lambda: t["now"])
    C._mark_empty("THIN")
    assert C._default_is_stale("THIN") is False, "parked → skipped"
    t["now"] = 1101.0  # past the 100s cooldown
    # after cooldown, it consults the store; stub it to 'missing' so it returns stale
    monkeypatch.setattr("api.services.bars_sqlite.get_last_ts", lambda s, tf: None)
    assert C._default_is_stale("THIN") is True, "cooldown elapsed → retry allowed"
    assert "THIN" not in C._NO_DATA_UNTIL, "expired park is cleared"


def test_disabled_crawler_is_inert(monkeypatch):
    monkeypatch.delenv("BARS_UNIVERSE_CRAWLER_ENABLED", raising=False)
    C.run_universe_crawler_forever()
    assert C.crawler_heartbeat()["enabled"] is False


def test_load_universe_dedups_and_uppercases(monkeypatch, tmp_path):
    import json
    p = tmp_path / "cap_universe.json"
    p.write_text(json.dumps(["aapl", "MSFT", "aapl", "nvda"]))
    monkeypatch.setattr(C.os.path, "join", lambda *a: str(p))
    assert C.load_universe() == ["AAPL", "MSFT", "NVDA"]
