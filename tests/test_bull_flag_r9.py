"""bull_flag drawing, round 9 (lab REPORT_BULLFLAG_R8.md, 2026-10-17): DISPLAY SELECTION, as round 8.
Round 8 scored 2.30 [1.97, 2.63]; the CI was dragged down by two charts both judges scored 1 -- a
2-bar spike pole (case_317) and a 15-bar grind (case_831). A flag whose pole or lanes are wrong is
`stale` (not drawn); the detector's firing, confidence, levels, pivot_ts and anchors are untouched
(`_drawn` asserts it). Synthetic bars only (public repo). Each rule has a firing case and a control.

  1. short_pole      the DRAWN pole (after pole_draw_start moved its start) rises < DRAWN_POLE_MIN_ATR
                     ATR -- and a 2-bar pole that IS tall still draws: no minimum bar count
  2. grind_pole      down-close share 0.40 -> 0.35, inside the one impulse verdict
  3. under_prior_high reads LEAD_BARS = 90 bars (was 60)
  4. loose_lanes     the drawn lanes hold < LANE_MIN_BODY_SHARE of the bodies they span
"""
from __future__ import annotations

from api.services.pattern_engine import display
from tests.test_bull_flag_r7 import _drawn, _ohlc, _plain
from tests.test_bull_flag_r8 import _under
from tests.test_team_drawing_set_r4 import PRE, _flag_det


def test_the_constants_are_the_round_9_calibration():
    assert display.DRAWN_POLE_MIN_ATR == 4.5
    assert (display.GRIND_MAX_EFF, display.GRIND_MIN_DOWN) == (0.54, 0.35)
    assert (display.LEAD_BARS, display.LEAD_NEAR_ATR) == (90, 0.6)
    assert (display.LANE_MIN_BODY_SHARE, display.LANE_MIN_BODY_ATR) == (0.58, 0.5)


def _flag_after(pole):
    """PRE (bars 0-14, ATR 1.0, the pole's first bar at 14), `pole` closes, then a 6-bar flag
    drifting 0.2 a bar with parallel lanes 1.0 apart. Returns (rows, top, upper, lower)."""
    top = 14 + len(pole)
    fl = [pole[-1] - 0.2 * k for k in range(6)]
    up = ((top + 1, fl[0] + 0.5), (top + 6, fl[-1] + 0.5))
    dn = ((top + 1, fl[0] - 0.5), (top + 6, fl[-1] - 0.5))
    return _plain(PRE + pole + fl), top, up, dn


def _start(ex, bars):
    return next(i for i, b in enumerate(bars) if b["t"] == ex["draw_pole"][0]["t"])


# -- 1. short_pole -------------------------------------------------------------------------------------

SHORT_LEG = [12.0, 14.5, 16.0, 13.0, 15.0, 17.0]          # first leg to 16.5, pullback to 12.5, 17.5
TALL_LEG = [12.0, 14.5, 16.0, 11.5, 14.0, 17.0, 20.0, 23.0]  # the same shape, a 12.5-point final leg


def test_a_short_final_leg_off_a_moved_start_is_not_a_pole():
    rows, top, up, dn = _flag_after(SHORT_LEG)
    ex, bars = _drawn(rows, top, up, dn)
    s = _start(ex, bars)
    assert s == 18                                          # the drawn pole starts at the pullback low
    # slow_pole passes on the DETECTOR's pole (8 ATR from bar 14); the DRAWN pole is 5 points over an
    # ATR the first leg inflated
    assert float(bars[top]["h"]) - float(bars[14]["l"]) >= display.POLE_MIN_ATR * display.atr14(bars[:15])
    h = float(bars[top]["h"]) - float(bars[s]["l"])
    assert h < display.DRAWN_POLE_MIN_ATR * display.atr14(bars[:s + 1])
    assert ex["stale"] is True and ex["stale_reason"] == "short_pole", ex
    # control: the same moved start with a tall final leg draws
    rows, top, up, dn = _flag_after(TALL_LEG)
    ok, bars = _drawn(rows, top, up, dn)
    assert _start(ok, bars) == 18
    assert not ok.get("stale"), ok


def test_a_two_bar_pole_that_is_tall_still_draws():
    # R8 case_635, judged 3: a 2-bar gap-up pole. The rule is height, never a minimum bar count.
    pole = [10.0, 18.0]
    rows, top, up, dn = _flag_after(pole)
    ex, bars = _drawn(rows, top, up, dn)
    assert top - _start(ex, bars) == 2
    assert not ex.get("stale"), ex
    assert display.pole_impulse_verdict(bars, 14, top) == (True, None)


def test_short_pole_reads_the_atr_up_to_the_drawn_start():
    rows, top, _u, _d = _flag_after(SHORT_LEG)
    bars = _ohlc(rows)
    assert display.pole_impulse_verdict(bars, 18, top) == (False, "short_pole")
    # from the detector's own start (bar 14) the same top is a tall pole
    assert display.pole_impulse_verdict(bars, 14, top) == (True, None)


# -- 2. grind_pole, down share 0.35 -------------------------------------------------------------------

def _grind(n_down, down_size):
    """13 pole closes from bar 14: up 1.0 each, `n_down` of them replaced by a drop of `down_size`,
    every other bar back from the second-last (so half the height comes early: not a two-step)."""
    steps = [1.0] * 13
    for k in range(n_down):
        steps[11 - k * 2] = -down_size
    closes, c = [], 10.0
    for st in steps:
        c = round(c + st, 4)
        closes.append(c)
    return closes


def _eff_down(closes):
    seq = [10.0] + closes
    path = sum(abs(b - a) for a, b in zip(seq, seq[1:]))
    return (seq[-1] - seq[0]) / path, sum(b < a for a, b in zip(seq, seq[1:])) / len(closes)


def test_a_grind_with_37_percent_down_closes_is_not_a_pole():
    # R8 case_041: efficiency 0.31 with 37% down closes slipped under round 7's 40% clause
    pole = _grind(5, 0.6)
    eff, down = _eff_down(pole)
    assert eff < display.GRIND_MAX_EFF and 0.35 <= down < 0.40, (eff, down)
    rows, top, up, dn = _flag_after(pole)
    ex, bars = _drawn(rows, top, up, dn)
    assert _start(ex, bars) == 14
    assert ex["stale"] is True and ex["stale_reason"] == "grind_pole", ex


def test_a_low_efficiency_pole_with_few_down_closes_still_draws():
    pole = _grind(4, 0.8)                                   # 4 of 13 down (0.31): pullbacks, not stairs
    eff, down = _eff_down(pole)
    assert eff < display.GRIND_MAX_EFF and down < 0.35, (eff, down)
    rows, top, _u, _d = _flag_after(pole)
    assert display.pole_impulse_verdict(_ohlc(rows), 14, top) == (True, None)


# -- 3. under_prior_high reads 90 bars ---------------------------------------------------------------

def test_a_prior_high_61_to_90_bars_back_now_counts():
    # R8 case_831 / 041 topped out 3-7 ATR under a high 61-90 bars back
    rows, b0, top, _u, _d = _under(20.0, gap=70)            # the prior high 74 bars before the top
    assert 60 < top - 9 < display.LEAD_BARS
    assert display.flag_context_verdict(_ohlc(rows), b0, top) == (False, "under_prior_high")
    rows, b0, top, up, dn = _under(20.0, gap=70)
    ex, _bars = _drawn(rows, top, up, dn, b0=b0)
    assert ex["stale"] is True and ex["stale_reason"] == "under_prior_high", ex
    # control: past 90 bars it is out of the window (round 8's test covers gap = LEAD_BARS too)
    rows, b0, top, _u, _d = _under(20.0, gap=90)
    assert top - 9 > display.LEAD_BARS - 1
    assert display.flag_context_verdict(_ohlc(rows), b0, top) == (True, None)


# -- 4. loose_lanes -------------------------------------------------------------------------------------

FAST = [(c, c + 0.5, c - 0.5, c) for c in [11.0, 13.0, 15.0, 17.0]]     # bars 15-18, top high 17.5
BODY_FLAG = [(17.0, 17.4, 16.0, 16.2), (16.2, 16.9, 15.9, 16.8), (16.8, 17.0, 15.6, 15.8),
             (15.8, 16.6, 15.5, 16.5), (16.5, 16.7, 15.3, 15.4), (15.4, 16.2, 15.2, 16.0)]  # 19-24
HOLDS = ((19, 17.2), (24, 16.6)), ((19, 15.7), (24, 15.1))
TIGHT = ((19, 16.8), (24, 16.2)), ((19, 16.3), (24, 15.7))


def _body_rows():
    return [(c, c + 0.5, c - 0.5, c) for c in PRE] + FAST + BODY_FLAG


def _anchors(bars, lanes):
    (u0, u1), (l0, l1) = lanes
    return [{"t": bars[u0[0]]["t"], "price": u0[1]}, {"t": bars[u1[0]]["t"], "price": u1[1]},
            {"t": bars[l0[0]]["t"], "price": l0[1]}, {"t": bars[l1[0]]["t"], "price": l1[1]}]


def test_lanes_that_leave_the_flag_bodies_outside_are_not_drawn():
    ex, _bars = _drawn(_body_rows(), 18, *TIGHT)
    assert ex["stale"] is True and ex["stale_reason"] == "loose_lanes", ex
    # control: lanes that hold the bodies draw
    ok, _bars = _drawn(_body_rows(), 18, *HOLDS)
    assert not ok.get("stale"), ok


def test_containment_is_body_length_inside_the_lanes():
    bars = _ohlc(_body_rows())
    assert display.flag_lanes_verdict(bars, _anchors(bars, HOLDS)) == (True, None)
    assert display.flag_lanes_verdict(bars, _anchors(bars, TIGHT)) == (False, "loose_lanes")
    # a 0.5-wide channel holds well under LANE_MIN_BODY_SHARE of these ~0.7-1.0 bodies, but a doji
    # flag has no body to hold: nothing to judge
    doji = _ohlc(_plain(PRE + [11.0, 13.0, 15.0, 17.0, 17.0, 16.8, 16.6, 16.4, 16.2, 16.0]))
    assert display.flag_lanes_verdict(doji, _anchors(doji, TIGHT)) == (True, None)


def test_too_little_body_is_not_judged():
    # one 0.3-body bar outside 0.5-wide lanes over a flag of doji: 0% held, but 0.3 ATR of body in all
    rows = _plain(PRE + [11.0, 13.0, 15.0, 17.0, 17.0, 16.8, 16.6, 16.4, 16.2])
    rows.append((15.9, 16.0, 15.5, 15.6))
    bars = _ohlc(rows)
    assert display.flag_lanes_verdict(bars, _anchors(bars, TIGHT)) == (True, None)
    # the same bar with a 1.0 body is enough to judge, and is outside
    rows[-1] = (16.6, 16.7, 15.5, 15.6)
    bars = _ohlc(rows)
    assert display.flag_lanes_verdict(bars, _anchors(bars, TIGHT)) == (False, "loose_lanes")


def test_the_DRAWN_lanes_are_the_ones_judged(monkeypatch):
    # the detector's lanes are tight; a refit that holds the bodies is what is drawn, and draws
    bars = _ohlc(_body_rows())
    monkeypatch.setattr(display, "flag_draw_lanes", lambda *_a: _anchors(bars, HOLDS))
    ok, _bars = _drawn(_body_rows(), 18, *TIGHT)
    assert not ok.get("stale"), ok
    # and a refit that leaves them outside is stale even when the detector's lanes would hold them
    monkeypatch.setattr(display, "flag_draw_lanes", lambda *_a: _anchors(bars, TIGHT))
    ex, _bars = _drawn(_body_rows(), 18, *HOLDS)
    assert ex["stale"] is True and ex["stale_reason"] == "loose_lanes", ex


def test_log_space_detector_lanes_are_not_judged():
    rows = _body_rows()
    d = _flag_det([r[3] for r in rows], 14, 18, *TIGHT)
    d["geometry"]["extras"]["line_spaces"] = ["log", "log"]
    display.draw_geometry([d], _ohlc(rows))
    assert d["geometry"]["extras"].get("stale_reason") != "loose_lanes"


def test_unknown_inputs_are_drawn():
    bars = _ohlc(_body_rows())
    assert display.flag_lanes_verdict(bars, []) == (True, None)
    assert display.flag_lanes_verdict(bars, [{"t": 1, "price": 1.0}] * 4) == (True, None)
    assert display.pole_impulse_verdict(bars, 18, 14) == (True, None)
    assert display.pole_impulse_verdict(bars, 14, 99) == (True, None)
