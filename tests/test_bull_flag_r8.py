"""bull_flag drawing, round 8 (lab REPORT_BULLFLAG_R7.md, 2026-10-17): DISPLAY SELECTION. Rounds 6 and 7
both stalled at 2.23 because the judges objected to WHICH flags were drawn, not to the geometry. A flag
whose context is wrong is now `stale` (not drawn); the detector's firing, confidence, levels, pivot_ts
and anchors are untouched (`_drawn` asserts it). Synthetic bars only (public repo). Each rule has a
firing case and a control.

  1. under_prior_high  the pole tops out more than LEAD_NEAR_ATR ATR under the LEAD_BARS-bar high
  2. rebound_pole      the pole climbs back out of a drop it just made (REBOUND_BARS / REBOUND_FRAC)
  3. two_step_pole     a long pole that reaches half its height only late (a slow leg, then the thrust)
  4. short_flag        FLAG_MIN_BARS is 5
  5. diverging         LANE_DIVERGE_RATIO is 1.45, read off the detector's AND the drawn lanes
  6. entry_detached    the entry is set by a bar before the lanes start, far above the last close
"""
from __future__ import annotations

from api.services.pattern_engine import display
from tests.test_bull_flag_r7 import _drawn, _ohlc, _plain
from tests.test_team_drawing_set_r4 import FLAG, PRE

FAST = [11.0, 13.0, 15.0, 17.0]                             # 8 points in 4 bars; top high 17.5
UP, DN = ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5))  # bars 19-24 (FLAG)


def test_the_constants_are_the_round_8_calibration():
    assert display.FLAG_MIN_BARS == 5
    assert display.LANE_DIVERGE_RATIO == 1.45
    assert (display.LEAD_BARS, display.LEAD_NEAR_ATR) == (90, 0.6)   # round 9: 60 -> 90
    assert (display.REBOUND_BARS, display.REBOUND_FRAC) == (10, 0.76)
    assert (display.TWO_STEP_MIN_BARS, display.TWO_STEP_LATE_FRAC) == (12, 0.65)
    assert display.ENTRY_STRANDED_ATR == 1.5


def test_the_control_flag_draws():
    ex, _bars = _drawn(_plain(PRE + FAST + FLAG), 18, UP, DN)
    assert not ex.get("stale"), ex


# -- 1. under_prior_high -----------------------------------------------------------------------------

def _under(prior_close, gap=20):
    """A prior high (`prior_close` + 0.5) on bars 0-9, then `gap` flat bars at 10 (ATR 1.0), the pole's
    low at the last of them, a fast pole to 17.5 and a 6-bar flag."""
    pre = [prior_close] * 10 + [10.0] * gap
    b0 = len(pre) - 1
    rows = _plain(pre + FAST + FLAG)
    top = b0 + 4
    up = ((top + 1, 17.5), (top + 6, 16.5))
    dn = ((top + 1, 16.5), (top + 6, 15.5))
    return rows, b0, top, up, dn


def test_a_pole_that_tops_out_under_a_prior_high_is_a_rebound_not_a_leader():
    rows, b0, top, up, dn = _under(20.0)                    # prior high 20.5: 3 ATR over the 17.5 top
    ex, _bars = _drawn(rows, top, up, dn, b0=b0)
    assert ex["stale"] is True and ex["stale_reason"] == "under_prior_high", ex
    # control: a prior high level with the top is a leader at its high and draws
    rows, b0, top, up, dn = _under(17.0)
    ok, _bars = _drawn(rows, top, up, dn, b0=b0)
    assert not ok.get("stale"), ok


def test_the_prior_high_threshold_is_in_atr_and_the_window_is_LEAD_BARS():
    rows, b0, top, _u, _d = _under(17.5)                    # prior high 18.0: 0.5 ATR over the top
    assert display.flag_context_verdict(_ohlc(rows), b0, top) == (True, None)
    rows, b0, top, _u, _d = _under(17.7)                    # 18.2: 0.7 ATR over the top
    assert display.flag_context_verdict(_ohlc(rows), b0, top) == (False, "under_prior_high")
    # the same 3-ATR prior high, but more than LEAD_BARS bars before the top, is out of the window
    rows, b0, top, _u, _d = _under(20.0, gap=display.LEAD_BARS)
    assert top - 9 > display.LEAD_BARS - 1
    assert display.flag_context_verdict(_ohlc(rows), b0, top) == (True, None)


# -- 2. rebound_pole ----------------------------------------------------------------------------------

def _rebound(high_close):
    """Bars 0-9 at 10, three bars at `high_close`, a two-bar drop to the pole's low (bar 14, 9.5), a
    fast pole to 21.5 (12 points, tall enough over the drop-inflated ATR) and a 6-bar flag."""
    return _plain([10.0] * 10 + [high_close] * 3 + [12.0, 10.0] + POLE_R + FLAG_R)


POLE_R = [12.0, 15.0, 18.0, 21.0]
FLAG_R = [21.0, 20.8, 20.6, 20.4, 20.2, 20.0]
UPR, DNR = ((19, 21.5), (24, 20.5)), ((19, 20.5), (24, 19.5))


def test_a_pole_out_of_a_drop_it_just_made_is_a_rebound():
    # the 19.5 high three bars before the low is 10.0 over it: 0.83 of the 12-point pole
    ex, _bars = _drawn(_rebound(19.0), 18, UPR, DNR)
    assert ex["stale"] is True and ex["stale_reason"] == "rebound_pole", ex
    # round 6's crash_pole (5 bars, 0.9 of the pole) does NOT see it: this is the gap round 8 fills
    rows = _rebound(19.0)
    bars = _ohlc(rows)
    from tests.test_team_drawing_set_r4 import _flag_det
    d = _flag_det([r[3] for r in rows], 14, 18, UPR, DNR)
    assert display.flag_edge_verdict(bars, display._index(bars), d) == (True, None)
    # control: a 15.5 high is 6.0 over the low, 0.5 of the pole, under the 0.76 line
    ok, _bars = _drawn(_rebound(15.0), 18, UPR, DNR)
    assert not ok.get("stale"), ok


# -- 3. two_step_pole ---------------------------------------------------------------------------------

def _two_step(late):
    """b0 = bar 14 (low 9.5); a 12-bar pole to a top close of 20 at bar 26 (high 20.5, 11 points):
    late=True climbs slowly for eight bars then thrusts, late=False thrusts first then drifts up."""
    if late:
        pole = [10.4, 10.8, 11.2, 11.6, 12.0, 12.4, 12.8, 13.2, 15.0, 17.0, 18.5, 20.0]
    else:
        pole = [12.0, 14.0, 16.0, 17.0, 17.4, 17.8, 18.2, 18.6, 19.0, 19.4, 19.7, 20.0]
    return _plain(PRE + pole + [19.8, 19.6, 19.4, 19.2, 19.0, 18.8])


UP2, DN2 = ((27, 20.3), (32, 19.3)), ((27, 19.3), (32, 18.3))


def test_a_slow_first_leg_then_a_thrust_is_two_steps_not_one_pole():
    ex, bars = _drawn(_two_step(True), 26, UP2, DN2)
    # half the height (15.0) is first reached on the 9th of 12 bars: 0.75 of the pole
    assert ex["stale"] is True and ex["stale_reason"] == "two_step_pole", ex
    assert ex["draw_pole"][0]["t"] == bars[14]["t"]          # not hidden by a moved pole start
    # control: the same rise, front-loaded, is one thrust and draws
    ok, _bars = _drawn(_two_step(False), 26, UP2, DN2)
    assert not ok.get("stale"), ok


def test_two_step_needs_a_long_pole():
    # round 9: two_step_pole lives in the one impulse verdict, pole_impulse_verdict
    bars = _ohlc(_two_step(True))
    assert display.pole_impulse_verdict(bars, 14, 26) == (False, "two_step_pole")
    # the same late half on an 11-bar pole (start one bar later) is under TWO_STEP_MIN_BARS
    assert 26 - 15 < display.TWO_STEP_MIN_BARS
    assert display.pole_impulse_verdict(bars, 15, 26) == (True, None)


# -- 4. a flag needs five bars ------------------------------------------------------------------------

def test_a_four_bar_flag_is_too_short_and_five_draws():
    ex, _bars = _drawn(_plain(PRE + FAST + FLAG[:4]), 18, ((19, 17.5), (22, 16.9)), ((19, 16.5), (22, 15.9)))
    assert ex["stale"] is True and ex["stale_reason"] == "short_flag", ex
    ok, _bars = _drawn(_plain(PRE + FAST + FLAG[:5]), 18, ((19, 17.5), (23, 16.7)), ((19, 16.5), (23, 15.7)))
    assert not ok.get("stale"), ok


# -- 5. diverging lanes --------------------------------------------------------------------------------

def test_lanes_fanning_past_1_45_are_not_drawn():
    # 1.0 wide at bar 19, 1.6 wide at bar 24: drawn under round 5's 2.0, stale under round 8's 1.45
    ex, _bars = _drawn(_plain(PRE + FAST + FLAG), 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 14.9)))
    assert ex["stale"] is True and ex["stale_reason"] == "diverging", ex
    # control: 1.3 wide at the right end (ratio 1.3) draws
    ok, _bars = _drawn(_plain(PRE + FAST + FLAG), 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.2)))
    assert not ok.get("stale"), ok


def test_the_DRAWN_lanes_are_held_to_the_same_ratio(monkeypatch):
    # the refit itself is pinned here; geometry round 3's upper lane (test_bull_flag_geom_v3.py) is off
    monkeypatch.setattr(display, "stamp_upper_lane_v3", lambda d, bars: None)
    # the detector's lanes are parallel; a refit that fans them (1.0 -> 1.8) must not be drawn
    bars = _ohlc(_plain(PRE + FAST + FLAG))
    fanned = [{"t": bars[19]["t"], "price": 17.5}, {"t": bars[24]["t"], "price": 16.5},
              {"t": bars[19]["t"], "price": 16.5}, {"t": bars[24]["t"], "price": 14.7}]
    monkeypatch.setattr(display, "flag_draw_lanes", lambda *_a: fanned)
    ex, _bars = _drawn(_plain(PRE + FAST + FLAG), 18, UP, DN)
    assert ex["stale"] is True and ex["stale_reason"] == "diverging", ex
    # control: a refit that stays parallel draws, with the refitted lanes
    parallel = [dict(a) for a in fanned]
    parallel[3]["price"] = 15.5
    monkeypatch.setattr(display, "flag_draw_lanes", lambda *_a: parallel)
    ok, _bars = _drawn(_plain(PRE + FAST + FLAG), 18, UP, DN)
    assert not ok.get("stale"), ok
    assert ok["draw_anchors"] == parallel


# -- 6. entry_detached ---------------------------------------------------------------------------------

def _detached(last_close):
    """A fast pole to 17.5 (bar 18); bar 19 tops at 17.5 and closes 16.0, bar 20 drops to 14.8 without a
    true gap, then six quiet bars down to `last_close`. The flag's highest high (bar 19, the entry) comes
    before the lanes, which start at bar 20."""
    rows = _plain(PRE + FAST)
    rows += [(17.2, 17.5, 15.8, 16.0), (16.0, 16.2, 14.6, 14.8)]
    step = (14.9 - last_close) / 5.0
    rows += _plain([round(14.9 - step * k, 3) for k in range(6)])
    return rows


UP3, DN3 = ((20, 16.2), (26, 14.9)), ((20, 14.3), (26, 13.9))


def test_an_entry_at_the_pole_top_above_a_flag_that_dropped_away_is_detached():
    ex, bars = _drawn(_detached(14.4), 18, UP3, DN3)
    assert ex["stale"] is True and ex["stale_reason"] == "entry_detached", ex
    # it is not one of the earlier rules: no true gap down, the lanes start 2 bars after the top
    assert float(bars[19]["l"]) <= float(bars[20]["h"])


def test_entry_detached_needs_both_the_early_entry_bar_and_a_stranded_price():
    rows = _detached(14.4)
    bars = _ohlc(rows)
    pos = display._index(bars)
    from tests.test_team_drawing_set_r4 import _flag_det
    d = _flag_det([r[3] for r in rows], 14, 18, UP3, DN3)
    assert display.flag_entry_verdict(bars, pos, d, 17.6) == (False, "entry_detached")
    # the price within ENTRY_STRANDED_ATR of the entry is not stranded
    assert display.flag_entry_verdict(bars, pos, d, float(bars[-1]["c"]) + 0.5) == (True, None)
    # lanes that start on the entry bar itself: the entry belongs to the flag
    d2 = _flag_det([r[3] for r in rows], 14, 18, ((19, 17.5), (26, 14.9)), ((19, 15.8), (26, 13.9)))
    assert display.flag_entry_verdict(bars, pos, d2, 17.6) == (True, None)
    # refitted lanes are read when given
    moved = [{"t": bars[19]["t"], "price": 17.5}, {"t": bars[26]["t"], "price": 14.9},
             {"t": bars[19]["t"], "price": 15.8}, {"t": bars[26]["t"], "price": 13.9}]
    assert display.flag_entry_verdict(bars, pos, d, 17.6, moved) == (True, None)


def test_unknown_inputs_are_drawn():
    bars = _ohlc(_plain(PRE + FAST + FLAG))
    assert display.flag_context_verdict(bars, 18, 14) == (True, None)
    assert display.flag_context_verdict(bars, 14, 99) == (True, None)
    from tests.test_team_drawing_set_r4 import _flag_det
    d = _flag_det([b["c"] for b in bars], 14, 18, UP, DN)
    assert display.flag_entry_verdict(bars, display._index(bars), d, None) == (True, None)
    d["pivot_ts"] = [99999999]
    assert display.flag_entry_verdict(bars, display._index(bars), d, 17.6) == (True, None)
