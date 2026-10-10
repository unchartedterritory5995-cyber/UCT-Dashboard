"""The breadth history grind ends when no SESSION is left above its floor.

Measured on the worker, 2026-10-10: with ``BREADTH_BACKFILL_FLOOR=2008-01-01`` (a
market holiday) coverage stopped at 2008-01-02, the first session. ``backfill_tick``
asked ``cur_first <= floor`` (``'2008-01-02' <= '2008-01-01'``), which can never be
true, so the finished grind re-ran every idle period, failed to resolve a universe
on the worker and logged ``breadth backfill tick returned error ... no universe``.
"""
from __future__ import annotations

import pytest

from api.services import breadth_daily_ohlc
from api.services import breadth_history_recon as recon


@pytest.fixture
def tick(monkeypatch):
    state = {"floor": None, "cleared": False, "resolved": 0}

    def run(floor: str, coverage_first: str):
        state.update(floor=floor, cleared=False, resolved=0)
        monkeypatch.setattr(recon, "get_backfill_floor", lambda: state["floor"])
        monkeypatch.setattr(recon, "set_backfill_floor",
                            lambda f: state.update(cleared=f is None, floor=f))
        monkeypatch.setattr(breadth_daily_ohlc, "stats", lambda: {"first": coverage_first})

        def _resolve():
            state["resolved"] += 1
            return [], None
        monkeypatch.setattr(recon, "_resolve_universe", _resolve)
        monkeypatch.setattr(recon, "sweep_history",
                            lambda lo, hi, t: {"ok": False, "reason": "no universe"})
        return recon.backfill_tick(chunk_days=30), state
    return run


def test_a_floor_on_a_holiday_completes_at_the_next_session(tick):
    out, state = tick("2008-01-01", "2008-01-02")
    assert out.get("complete") is True
    assert state["cleared"] is True and state["resolved"] == 0


def test_a_floor_on_a_weekend_completes_at_monday(tick):
    out, state = tick("2026-10-03", "2026-10-05")      # Saturday floor, Monday coverage
    assert out.get("complete") is True and state["resolved"] == 0


def test_a_real_session_still_missing_keeps_the_grind_going(tick):
    """Control: one session above the floor is still owed, so the tick must sweep."""
    out, state = tick("2008-01-02", "2008-01-03")
    assert not out.get("complete")
    assert state["resolved"] == 1 and state["cleared"] is False


def test_coverage_at_or_below_the_floor_still_completes(tick):
    out, _ = tick("2008-01-02", "2008-01-02")
    assert out.get("complete") is True
