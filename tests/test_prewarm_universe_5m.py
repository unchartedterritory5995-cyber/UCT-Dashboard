"""Phase 2 (instant-origin) — the shallow full-universe 5m boot warm.

`shallow_5m_universe_jobs` produces the BOOT-ONLY jobs that warm a shallow 5m window
for every universe ticker NOT already in the deep 5m set — so a brand-new user's first
5m open of any long-tail ticker is an instant local serve. These must never join the
refresh loop (that would re-fetch ~3,700 intraday series every cycle = the Massive
saturation this initiative exists to avoid).
"""
from __future__ import annotations

from api.services import bars_prewarm


def test_disabled_yields_no_jobs():
    """Default OFF: the flag gates the whole universe pass. Inert until flipped."""
    universe = [f"T{i}" for i in range(100)]
    assert bars_prewarm.shallow_5m_universe_jobs(universe, universe[:10], enabled=False, bars=780) == []


def test_covers_the_long_tail_excluding_the_deep_set():
    universe = [f"T{i}" for i in range(100)]
    deep = universe[:10]                       # the hot top-N already deep-warmed
    jobs = bars_prewarm.shallow_5m_universe_jobs(universe, deep, enabled=True, bars=780)
    syms = [s for (s, tf, b) in jobs]
    # every non-deep ticker, no deep ticker, no duplicates, shallow depth + 5m only.
    assert syms == universe[10:], "must cover exactly the universe minus the deep 5m set"
    assert all(tf == "5" and b == 780 for (_, tf, b) in jobs)
    assert not (set(syms) & set(deep)), "a deep-warmed ticker must not get a second shallow job"
    assert len(syms) == len(set(syms)), "no duplicate warm jobs"


def test_shallow_bars_is_configurable():
    universe = ["A", "B", "C"]
    jobs = bars_prewarm.shallow_5m_universe_jobs(universe, [], enabled=True, bars=390)
    assert all(b == 390 for (_, _, b) in jobs) and len(jobs) == 3


def test_order_preserved_so_priority_tickers_warm_first():
    """ticker_list is priority-ordered upstream; the helper must not scramble it."""
    universe = ["SPY", "QQQ", "ZZZ", "AAA", "MMM"]
    jobs = bars_prewarm.shallow_5m_universe_jobs(universe, ["SPY"], enabled=True, bars=780)
    assert [s for (s, _, _) in jobs] == ["QQQ", "ZZZ", "AAA", "MMM"]
