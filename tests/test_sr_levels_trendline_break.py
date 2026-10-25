"""The trendline 3% CLOSE-BREAK rule (sr_levels.BREAK), on a synthetic chart whose break is decided by that rule alone.

Round r7 draws only 3 trendlines across the 352 parity charts, so the parity fixture no longer exercises this rule
and a moved BREAK would pass it. This rail builds one support and one resistance trendline with three touches, then
puts ONE close just past the line after its last touch:

  * the bar's low (high) stays inside the after-last-touch pierce tolerance (TL_PIERCE_AFTER x ATR), so the pierce
    rule never rejects the line -- the control below proves it by switching BREAK off and seeing the line drawn;
  * a close 3.1% through the line breaks it (not drawn); a close 2.9% through it does not (drawn).

So the line's fate moves with BREAK and nothing else: BREAK at 2.8% or below rejects the 2.9% chart, BREAK at
3.2% or above keeps the 3.1% chart, and each turns this file red.
"""
import pytest

from api.services.pattern_engine import sr_levels as S

TOUCHES = (10, 50, 90)      # three swing pivots on the line, >= TL_GAP apart, spanning >= TL_MIN_SPAN
BREAK_BAR = 100             # after the last touch: the looser pierce tolerance applies
N = 121                     # the as-of bar is 30 sessions after the last touch (< TL_MAX_AGE)
SLOPE = 0.2                 # per bar; 80 bars x 0.2 = 16 >= TL_MIN_MOVE x ATR(10)
RANGE = 10.0                # every bar's high-low: ATR(14) = 10


def _line(side, j):
    return 100.0 + SLOPE * j if side == "support" else 140.0 - SLOPE * j


def _chart(side, pct):
    """Bars (t, o, h, l, c, v) riding the line, with one close `pct` through it at BREAK_BAR. The middle touch sits
    1.0 off the line (inside TL_TOL x ATR = 1.5) so no second line can anchor on the break bar's own pivot."""
    b = []
    for j in range(N):
        v = _line(side, j)
        if side == "support":
            lo = (v + (1.0 if j == TOUCHES[1] else 0.0)) if j in TOUCHES else v + 4.0
            b.append((j, lo + 5, lo + RANGE, lo, lo + 5, 1e6))
        else:
            hi = (v - (1.0 if j == TOUCHES[1] else 0.0)) if j in TOUCHES else v - 4.0
            b.append((j, hi - 5, hi, hi - RANGE, hi - 5, 1e6))
    v = _line(side, BREAK_BAR)
    if side == "support":
        c = v * (1 - pct)
        b[BREAK_BAR] = (BREAK_BAR, c + 2, c + 8, c, c, 1e6)       # low == close: the deepest the bar goes
    else:
        c = v * (1 + pct)
        b[BREAK_BAR] = (BREAK_BAR, c - 2, c, c - 8, c, 1e6)       # high == close
    return b


def _drawn(side, pct):
    """The side's drawn trendline as (side, first anchor, last touch, slope), or None."""
    b = _chart(side, pct)
    i = len(b) - 1
    best, supp = S._tl_side(b, i, S._atr(b, i), side == "resistance", ())
    assert supp is None                     # no pattern pivots: nothing is suppressed
    if best is None:
        return None
    return best["side"], best["ja"], best["last_j"], round(best["slope"], 6)


def _expected(side):
    return side, TOUCHES[0], TOUCHES[-1], SLOPE if side == "support" else -SLOPE


SIDES = ("support", "resistance")


def test_the_break_is_three_percent():
    assert S.BREAK == 0.03


@pytest.mark.parametrize("side", SIDES)
def test_the_break_bar_stays_inside_the_pierce_tolerance(side):
    """Precondition: the break bar's extreme never trips the pierce rule, so only the close rule can reject."""
    for pct in (0.029, 0.031):
        b = _chart(side, pct)
        at = S._atr(b, len(b) - 1)
        assert at == pytest.approx(RANGE)
        v = _line(side, BREAK_BAR)
        tol = S.TL_PIERCE_AFTER * at
        if side == "support":
            assert b[BREAK_BAR][3] >= v - tol
        else:
            assert b[BREAK_BAR][2] <= v + tol


@pytest.mark.parametrize("side", SIDES)
def test_a_close_through_by_more_than_three_percent_breaks_the_line(side):
    assert _drawn(side, 0.031) is None


@pytest.mark.parametrize("side", SIDES)
def test_a_close_through_by_less_than_three_percent_does_not(side):
    assert _drawn(side, 0.029) == _expected(side)


@pytest.mark.parametrize("side", SIDES)
def test_control_the_close_rule_is_what_decides(side, monkeypatch):
    """With the close rule switched off, the 3.1% chart draws the same line: nothing else rejected it."""
    monkeypatch.setattr(S, "BREAK", 1.0)
    assert _drawn(side, 0.031) == _expected(side)
    assert _drawn(side, 0.029) == _expected(side)
