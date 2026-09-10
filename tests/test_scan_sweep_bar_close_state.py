"""⭐⭐ THE SWEEP'S BAR-CLOSE TRI-STATE — derived from an instant, not from a mode.

⛔ THE FAILURE THIS PINS IS A CONFIDENT ANSWER ON A CLOSED BAR. The four
CLOCK_REALTIME columns are decided by whether the newest bar is still forming.
`barstate.islastconfirmedhistory` is the member-reachable one: the Pine door folds
`isconfirmed`/`ishistory`/`isrealtime` to constants for a screen, but NOT that one,
so a saved scan reading it computes from the clock on every sweep.

⚰️ THE SWEEP PASSED `mode == LIVE` FOR ONE COMMIT. That answers "is the live sweep
running", and the seam asks "is the newest bar still forming". They coincide only
while the session is OPEN -- and this cycle's window does not end when the session
does:

  · `_live_window_reason` gates on `open <= now < open + REGULAR_SESSION_LENGTH`
  · `REGULAR_SESSION_LENGTH` is a FIXED `6h30m` (`scan_evaluator.py:298`)
  · its trading-day test is `bars_fetch._is_nyse_holiday`, whose own docstring says
    1pm ET half-days are "intentionally NOT included"

So on a half-day the window runs to 16:00, the sweep keeps firing, `live_bars_for`
keeps appending a bar the exchange settled at 13:00, and a mode check would have
called it forming for three hours. That is the exact case
`_NYSE_EARLY_CLOSES_YYYYMMDD` was wired into `bar_close_state` for.
"""
from __future__ import annotations

import ast as pyast
import datetime
import io
import pathlib

from api.services.indicator_compute import bar_close_state
from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD,
    NYSE_HOLIDAYS_YYYYMMDD,
)

ET = datetime.timezone(datetime.timedelta(hours=-5))   # EST; 2025-11-28 is EST
ROOT = pathlib.Path(__file__).resolve().parents[1]
EVALUATOR = ROOT / "api" / "services" / "screener" / "scan_evaluator.py"

#: 2025-11-28 — the day after Thanksgiving, a 1pm ET close, and in the set.
HALF_DAY = datetime.datetime(2025, 11, 28, tzinfo=ET)


def _state(now_et: datetime.datetime, bar_day: datetime.datetime, tf: str = "D"):
    """The tri-state for a daily bar stamped `bar_day`, evaluated at `now_et`."""
    bars = [{"t": bar_day.timestamp(), "o": 1.0, "h": 1.0, "l": 1.0,
             "c": 1.0, "v": 1.0}]
    return bar_close_state(bars, tf, now_et.timestamp(),
                           NYSE_HOLIDAYS_YYYYMMDD, NYSE_EARLY_CLOSES_YYYYMMDD)


def test_the_half_day_bar_reads_CLOSED_at_1400_ET():
    """⛔⛔ THE CASE A MODE CHECK GOT WRONG. 14:00 ET on a 1pm half-day: the live
    sweep's window still has ~2 hours to run, so a mode check says FORMING. The
    exchange settled the bar an hour ago."""
    assert 20251128 in NYSE_EARLY_CLOSES_YYYYMMDD, (
        "2025-11-28 left the early-close set — this test proves nothing without it")
    got = _state(HALF_DAY.replace(hour=14), HALF_DAY)
    assert got is False, (
        f"a 1pm ET half-day bar read {got!r} at 14:00 ET — a confident 'still "
        "forming' three hours after the exchange settled it")


def test_the_SAME_half_day_bar_reads_FORMING_at_noon__the_control():
    """⭐ WITHOUT THIS, the test above passes for a lane that answers `False`
    always. Noon on the same day is genuinely inside the session."""
    got = _state(HALF_DAY.replace(hour=12), HALF_DAY)
    assert got is True, f"noon on a half-day read {got!r}, not forming"


def test_an_ORDINARY_session_still_reads_FORMING_at_1400_ET():
    """⭐⭐ THE DISCRIMINATOR. Same clock time, same shape, ordinary trading day —
    and the answer must DIFFER from the half-day case, or the fix is measuring the
    hour rather than the calendar. 2025-12-01 is an ordinary Monday."""
    ordinary = datetime.datetime(2025, 12, 1, tzinfo=ET)
    assert int(ordinary.strftime("%Y%m%d")) not in NYSE_EARLY_CLOSES_YYYYMMDD
    got = _state(ordinary.replace(hour=14), ordinary)
    assert got is True, (
        f"an ordinary session read {got!r} at 14:00 ET — the early-close set is "
        "being applied to days that are not in it")


def test_the_NIGHTLY_control__last_sessions_bar_is_closed_at_0500():
    """⭐ THE NIGHTLY SWEEP runs at 05:00 ET over the PREVIOUS session's bars, and
    must answer `False` by derivation rather than by assertion."""
    prev = datetime.datetime(2025, 12, 1, tzinfo=ET)
    at_five = datetime.datetime(2025, 12, 2, 5, tzinfo=ET)
    assert _state(at_five, prev) is False


def test_the_sweep_hands_an_INSTANT_and_never_a_mode():
    """⛔ THE ENCODING ITSELF, PINNED BY AST. `mode` is not a clock. If this call
    ever hands a mode-derived boolean again, the half-day case above goes wrong
    three hours a year and nothing else notices."""
    tree = pyast.parse(io.open(EVALUATOR, encoding="utf-8").read())
    fn = next(n for n in pyast.walk(tree)
              if isinstance(n, pyast.FunctionDef) and n.name == "evaluate_one")
    calls = [n for n in pyast.walk(fn) if isinstance(n, pyast.Call)
             and getattr(n.func, "attr", None) == "interpret"]
    assert len(calls) == 1, f"{len(calls)} interpret calls in evaluate_one"
    opts = {k.arg: k.value for k in calls[0].keywords}["opts"]
    keys = {k.value for k in opts.keys}
    assert "now" in keys, f"the sweep no longer hands an evaluating instant: {keys}"
    assert "newest_bar_is_forming" not in keys, (
        "the sweep is asserting the tri-state again instead of handing the instant "
        "that derives it — see this file's header for why that is wrong on a "
        "half-day")
