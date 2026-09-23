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


# ── THE REFERENCE LONG TAIL — the population no existing knob could reach ─────
#
# ⛔⛔ BFRG charted on 1D and took the cold path on 5m, and raising PREWARM_5M_CAP
# or flipping PREWARM_5M_UNIVERSE would NOT have fixed it. Both operate inside
# `ticker_list` = cap_universe (3,640) + active ETFs, and BFRG / SNGX / GRRR /
# CNEY / VRME are none of those — measured 2026-09-23, all five absent from
# `cap_universe.json`. "Instant every symbol" made DAILY universe-wide via
# `_dwm_extra` and left intraday behind, which is the whole asymmetry behind
# "5m feels slower than daily".

_TAIL = ["BFRG", "SNGX", "GRRR", "CNEY", "VRME"]


def test_the_reference_tail_is_absent_unless_asked_for():
    """⭐ DEFAULT-IDENTICAL. The tail is ~22k more boot fetches, so it must be a
    SECOND decision — never a side effect of enabling the cap_universe pass."""
    universe = [f"T{i}" for i in range(50)]
    base = bars_prewarm.shallow_5m_universe_jobs(
        universe, universe[:10], enabled=True, bars=780)
    with_default = bars_prewarm.shallow_5m_universe_jobs(
        universe, universe[:10], enabled=True, bars=780, reference_tail=())
    assert base == with_default, "the new parameter changed default output"
    assert not any(s in _TAIL for (s, _, _) in base)


def test_the_reference_tail_is_covered_when_asked_for():
    universe = [f"T{i}" for i in range(50)]
    jobs = bars_prewarm.shallow_5m_universe_jobs(
        universe, universe[:10], enabled=True, bars=780, reference_tail=_TAIL)
    syms = [s for (s, _, _) in jobs]
    assert syms == universe[10:] + _TAIL, "tail must trail, order preserved"
    assert all(tf == "5" and b == 780 for (_, tf, b) in jobs), "shallow 5m only"


def test_the_tail_never_duplicates_work_already_queued():
    """A symbol warmed twice is a wasted provider call on the ONE axis this design
    is constrained by — and the tail is built by set-difference upstream, so an
    overlap here means the two sources disagreed."""
    universe = ["A", "B", "C", "D"]
    jobs = bars_prewarm.shallow_5m_universe_jobs(
        universe, ["A"], enabled=True, bars=780,
        reference_tail=["A", "B", "ZZZZ"])       # A is deep, B already queued
    syms = [s for (s, _, _) in jobs]
    assert syms == ["B", "C", "D", "ZZZZ"]
    assert len(syms) == len(set(syms)), "duplicate warm job queued"


def test_the_tail_still_obeys_the_master_switch():
    """⛔ Flag-off must stay fully dark: no tail jobs leak past `enabled`."""
    assert bars_prewarm.shallow_5m_universe_jobs(
        ["A"], [], enabled=False, bars=780, reference_tail=_TAIL) == []


def test_the_tail_is_boot_only_shallow_never_deep():
    """⛔ These must never carry deep depth: the 5000-bar warm is ~362 KB against
    ~56 KB shallow (measured), and 22k deep fetches is a different project."""
    jobs = bars_prewarm.shallow_5m_universe_jobs(
        [], [], enabled=True, bars=780, reference_tail=_TAIL)
    assert [b for (_, _, b) in jobs] == [780] * len(_TAIL)
