"""bull_flag drawing, round 6 (lab REPORT_TEAM_SET_R5_CONFIRM.md, 2026-10-17): the display-only fixes for
what the confirm judges named. Nothing here changes what the detector fires on, its confidence, levels or
HIST_SCORE -- every stamp lives under `geometry.extras` (`_drawn` asserts the frozen fields are untouched).
Synthetic bars only (public repo). Each rule has a firing case and a control.

  1. crash_pole     a pole whose low is the bottom of a crash / gap-down (a V back out of it)
  2. gap_detached   flag lanes below a true gap down from the pole top
  3. entry line     the drawn entry off a single wick / spike over the flag, onto its body highs
  4. breaking_down  the last close already well under the lower lane
"""
from __future__ import annotations

from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_team_drawing_set_r4 import FAST_POLE, FLAG, PRE, _flag_det, _frozen


def _ohlc(rows):
    """Bars from (o, h, l, c) tuples."""
    return [{"t": ymd_t(i), "o": o, "h": h, "l": lo, "c": c, "v": 1000} for i, (o, h, lo, c) in enumerate(rows)]


def _plain(closes):
    """The r4 fixture shape: open = close, high = close + 0.5, low = close - 0.5."""
    return [(c, c + 0.5, c - 0.5, c) for c in closes]


GOOD = _plain(PRE + FAST_POLE + FLAG)                       # pole bars 14-18 (8 points), flag 19-24
UP = ((19, 17.5), (24, 16.5))
DN = ((19, 16.5), (24, 15.5))


def _drawn(rows, b1=18, upper=UP, lower=DN, b0=14):
    bars = _ohlc(rows)
    d = _flag_det([r[3] for r in rows], b0, b1, upper, lower)
    before = _frozen(d)
    display.draw_geometry([d], bars)
    assert _frozen(d) == before                              # display-only
    return d["geometry"]["extras"]


def test_the_control_flag_draws_with_the_detectors_entry():
    ex = _drawn(GOOD)
    assert not ex.get("stale"), ex
    assert "draw_entry_price" not in ex, ex


# -- 1. crash_pole -----------------------------------------------------------------------------------

def test_a_pole_out_of_a_crash_low_is_not_a_pole():
    # bars 0-12 sit at 20, bars 13-14 crash to the pole's low (9.5): the pole only climbs back to 21.5
    pre = [(20, 20.5, 19.5, 20)] * 13 + [(19.5, 19.7, 14.0, 14.2), (14.0, 14.2, 9.5, 10.0)]
    pole = _plain([13.0, 16.0, 19.0, 21.0])                  # bars 15-18, top 21.5: 12 points
    flag = _plain([20.8, 20.6, 20.4, 20.2, 20.0, 19.8])     # bars 19-24
    up, dn = ((19, 21.3), (24, 20.3)), ((19, 20.3), (24, 19.3))
    ex = _drawn(pre + pole + flag, upper=up, lower=dn)
    assert ex["stale"] is True and ex["stale_reason"] == "crash_pole", ex
    # control: the same pole out of a quiet base (no crash into its low) draws
    quiet = [(10, 10.5, 9.5, 10)] * 15
    ok = _drawn(quiet + pole + flag, upper=up, lower=dn)
    assert not ok.get("stale"), ok


def test_crash_pole_threshold_is_a_fraction_of_the_pole():
    bars = _ohlc(GOOD)
    pos = display._index(bars)
    d = _flag_det([b["c"] for b in bars], 14, 18, UP, DN)
    assert display.flag_edge_verdict(bars, pos, d) == (True, None)
    # raise the high 3 bars before the pole low to just under / over 0.9 x the 8-point pole above it
    for hi, want in ((9.5 + 0.89 * 8, (True, None)), (9.5 + 0.91 * 8, (False, "crash_pole"))):
        b2 = _ohlc(GOOD)
        b2[11]["h"] = hi
        assert display.flag_edge_verdict(b2, pos, d) == want, hi


# -- 2. gap_detached ---------------------------------------------------------------------------------

def test_flag_lanes_below_a_gap_down_from_the_pole_top_are_detached():
    # bar 19 opens and stays under bar 18's low (16.5): a true gap of 1.0 ATR below the pole top
    flag = _plain([15.0, 14.9, 14.8, 14.7, 14.6, 14.5])
    up, dn = ((19, 15.5), (24, 15.0)), ((19, 14.5), (24, 14.0))
    ex = _drawn(_plain(PRE + FAST_POLE) + flag, upper=up, lower=dn)
    assert ex["stale"] is True and ex["stale_reason"] == "gap_detached", ex
    # control: the same flag whose first bar's high reaches back into bar 18's range draws
    bridged = [(15.0, 16.6, 14.5, 15.0)] + flag[1:]
    ok = _drawn(_plain(PRE + FAST_POLE) + bridged, upper=up, lower=dn)
    assert ok.get("stale_reason") != "gap_detached", ok
    assert not ok.get("stale"), ok


def test_detached_flag_counted_bars_and_missed_the_gap():
    # the round-5 rule: the lanes start the bar after the pole's top, so it passes the gapped flag
    flag = _plain([15.0, 14.9, 14.8, 14.7, 14.6, 14.5])
    bars = _ohlc(_plain(PRE + FAST_POLE) + flag)
    d = _flag_det([b["c"] for b in bars], 14, 18, ((19, 15.5), (24, 15.0)), ((19, 14.5), (24, 14.0)))
    pos = display._index(bars)
    assert display.flag_shape_verdict(bars, pos, d) == (True, None)
    assert display.flag_edge_verdict(bars, pos, d) == (False, "gap_detached")


# -- 3. the entry line -------------------------------------------------------------------------------

LONG = [16.5 - 0.08 * k for k in range(16)]                 # bars 19-34: a 16-bar drift, ATR(14) ~1
LONG_UP, LONG_DN = ((19, 17.0), (34, 15.8)), ((19, 16.0), (34, 14.8))
SPIKE = 22                                                   # a flag bar: close 16.26, lane 16.76 here
BODY_ENTRY = round(16.5 * 1.001, 4)                          # bar 19's close: the flag's highest body


def _base():
    """A 10-point pole (top 19.5 at bar 18, whose lower wick reaches 16.0) into a long, slow flag."""
    rows = _plain(PRE + [12.0, 14.5, 17.0, 19.0] + LONG)
    rows[18] = (17.0, 19.5, 16.0, 19.0)
    return rows


def _spiked(over):
    """The long flag with bar SPIKE's high `over` points above the upper lane at its bar."""
    rows = _base()
    o, h, lo, c = rows[SPIKE]
    rows[SPIKE] = (o, 16.76 + over, lo, c)
    return rows


def test_an_entry_on_a_spike_wick_over_the_flag_moves_to_the_body_highs():
    ex = _drawn(_spiked(1.0), upper=LONG_UP, lower=LONG_DN)
    assert not ex.get("stale"), ex
    assert ex["draw_entry_price"] == BODY_ENTRY, ex
    # control: the same flag without the spike keeps the detector's entry
    ok = _drawn(_base(), upper=LONG_UP, lower=LONG_DN)
    assert not ok.get("stale") and "draw_entry_price" not in ok, ok


def test_the_spike_threshold_is_in_atr_above_the_lane():
    for over, moved in ((0.6, False), (1.0, True)):
        rows = _spiked(over)
        bars = _ohlc(rows)
        d = _flag_det([r[3] for r in rows], 14, 18, LONG_UP, LONG_DN)
        got = display.flag_entry_line(bars, display._index(bars), d)
        assert (got is not None) is moved, (over, got)


def test_the_entry_line_is_display_only():
    rows = _spiked(1.0)
    bars = _ohlc(rows)
    d = _flag_det([r[3] for r in rows], 14, 18, LONG_UP, LONG_DN)
    display.draw_geometry([d], bars)
    assert d["levels"]["entry"] == 17.6                      # the alert / trigger is untouched
    assert d["geometry"]["extras"]["draw_entry_price"] == BODY_ENTRY


# -- 4. breaking_down --------------------------------------------------------------------------------

def test_a_flag_whose_last_close_is_well_under_the_lower_lane_is_stale():
    rows = list(GOOD)
    rows[24] = (15.0, 15.2, 14.9, 15.0)                     # last close 15.0, lane 15.5: 0.5 under
    ex = _drawn(rows)
    assert ex["stale"] is True and ex["stale_reason"] == "breaking_down", ex
    # control: a close just under the lane (0.2) is a flag still testing its floor
    rows[24] = (15.4, 15.6, 15.2, 15.3)
    ok = _drawn(rows)
    assert not ok.get("stale"), ok


def test_flag_edge_verdict_unknown_is_drawn():
    bars = _ohlc(GOOD)
    d = _flag_det([b["c"] for b in bars], 14, 18, UP, DN)
    d["pivot_ts"] = [99999999]
    assert display.flag_edge_verdict(bars, {}, d) == (True, None)
    assert display.flag_entry_line(bars, {}, d) is None
