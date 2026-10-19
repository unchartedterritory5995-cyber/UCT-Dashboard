"""bull_flag drawing, round 7 (lab REPORT_BULLFLAG_R6.md, 2026-10-17): the display-only fixes for
what the round-6 judges named. Nothing here changes what the detector fires on, its confidence,
levels, pivot_ts or anchors -- every stamp lives under `geometry.extras` (`_drawn` asserts it).
Synthetic bars only (public repo). Each rule has a firing case and a control.

  1. pole start   the drawn pole starts at the FINAL leg's swing low: after a deep mid-pole pullback,
                  after a sideways base, and off a long-wick start bar -- always on a real bar low
  2. grind_pole   a stair-step grind (low close-to-close efficiency, many down closes) is not a pole
  3. lanes        a wide red first bar is left out of the lane fit; a flat-bottomed wedge is drawn as a
                  parallel channel; a lane end floating off the bars is pulled onto them
"""
from __future__ import annotations

import copy

import pytest

from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_team_drawing_set_r4 import FLAG, PRE, _flag_det

FROZEN = ("confidence", "levels", "start_t", "end_t", "pivot_ts")


@pytest.fixture
def _round_7_lanes(monkeypatch):
    """For the two rails that pin the round-7 refit's UPPER-lane values: geometry round 3 replaces the
    drawn upper lane by design, at the very end of draw_geometry, so it is switched off for those two
    only. Every other rail here runs with round 3 ON; its fan-out fallback (the round-8 ratio) is railed
    with the stamp ON in test_bull_flag_r8.py and test_bull_flag_geom_v3.py."""
    monkeypatch.setattr(display, "stamp_upper_lane_v3", lambda d, bars: None)


def _ohlc(rows):
    """Bars from (o, h, l, c) tuples."""
    return [{"t": ymd_t(i), "o": o, "h": h, "l": lo, "c": c, "v": 1000} for i, (o, h, lo, c) in enumerate(rows)]


def _plain(closes):
    """open = close, high = close + 0.5, low = close - 0.5."""
    return [(c, c + 0.5, c - 0.5, c) for c in closes]


def _snapshot(d):
    out = {k: d.get(k) for k in FROZEN}
    out["anchors"] = (d.get("geometry") or {}).get("anchors")
    return copy.deepcopy(out)


def _drawn(rows, b1, upper, lower, b0=14):
    bars = _ohlc(rows)
    d = _flag_det([r[3] for r in rows], b0, b1, upper, lower)
    before = _snapshot(d)
    display.draw_geometry([d], bars)
    assert _snapshot(d) == before                            # display-only
    return d["geometry"]["extras"], bars


def _pole_start(ex, bars):
    """(bar index, price) of the drawn pole's start."""
    p = ex["draw_pole"][0]
    i = next(k for k, b in enumerate(bars) if b["t"] == p["t"])
    return i, p["price"]


# -- 1. the drawn pole starts at the final leg -------------------------------------------------------

def _two_leg(pullback_close):
    """b0 = bar 14 (low 9.5); a first leg to 15.5, a pullback to `pullback_close`, a final leg to the
    top 20.5 at bar 23; then a 6-bar flag (bars 24-29)."""
    pole = [11.0, 13.0, 15.0, 13.0, pullback_close, 13.5, 16.0, 18.5, 20.0]
    flag = [20.0, 19.8, 19.6, 19.4, 19.2, 19.0]
    return _plain(PRE + pole + flag)


UP2, DN2 = ((24, 20.5), (29, 19.5)), ((24, 19.5), (29, 18.5))


def test_a_pole_through_a_deep_mid_pole_pullback_starts_at_the_later_swing_low():
    ex, bars = _drawn(_two_leg(11.5), 23, UP2, DN2)
    assert not ex.get("stale"), ex
    # the pullback low (bar 19, 11.0) is 4.5 under the first leg's high: 0.41 of the 11-point pole
    i, price = _pole_start(ex, bars)
    assert (i, price) == (19, 11.0), (i, price)
    assert price == bars[i]["l"]                             # on an actual bar low
    assert ex["draw_pole"][1]["price"] == 20.5               # the top is unchanged


def test_a_shallow_pullback_keeps_the_pole_start():
    # the pullback low 13.0 is 2.5 under the first leg's high: 0.23 of the pole, under the 0.35 line
    ex, bars = _drawn(_two_leg(13.5), 23, UP2, DN2)
    assert not ex.get("stale"), ex
    assert _pole_start(ex, bars) == (14, 9.5)


def test_the_pullback_threshold_is_a_fraction_of_the_pole():
    for pb_low, moved in ((15.5 - 0.34 * 11, False), (15.5 - 0.36 * 11, True)):
        rows = _two_leg(13.5)
        rows[19] = (pb_low + 0.5, pb_low + 1.0, pb_low, pb_low + 0.5)
        s = display.pole_draw_start(_ohlc(rows), 14, 23)
        assert (s == 19) is moved, (pb_low, s)


def test_a_small_final_leg_keeps_the_pole_start():
    # a deep pullback (0.45 of the pole) but a final leg of only 0.55 of the pole: not the pole
    rows = _plain(PRE + [11.0, 14.0, 17.0, 19.0, 15.0, 17.0, 20.0])   # top 20.5 at bar 21, low 14.5
    bars = _ohlc(rows)
    assert display.pole_draw_start(bars, 14, 21) == 14


def _based(base_len):
    """b0 = bar 14; `base_len` sideways bars after it (closes within 0.7), then a 4-bar thrust."""
    base = [10.3, 10.6, 10.2, 10.5, 10.4, 10.7, 10.3, 10.6][:base_len]
    thrust = [13.0, 16.0, 19.0, 21.0]
    flag = [20.8, 20.6, 20.4, 20.2, 20.0, 19.8]
    return _plain(PRE + base + thrust + flag), 14 + base_len + len(thrust)


def test_a_pole_that_starts_in_a_sideways_base_starts_after_the_base():
    rows, top = _based(8)                                   # bars 14-22 sideways (9 bars), top bar 26
    up, dn = ((top + 1, 21.3), (top + 6, 20.3)), ((top + 1, 20.3), (top + 6, 19.3))
    ex, bars = _drawn(rows, top, up, dn)
    assert not ex.get("stale"), ex
    i, price = _pole_start(ex, bars)
    assert i == 22 and price == bars[22]["l"] == 10.1, (i, price)


def test_a_short_base_keeps_the_pole_start():
    rows, top = _based(6)                                   # bars 14-20: 7 sideways bars, under 8
    up, dn = ((top + 1, 21.3), (top + 6, 20.3)), ((top + 1, 20.3), (top + 6, 19.3))
    ex, bars = _drawn(rows, top, up, dn)
    assert not ex.get("stale"), ex
    assert _pole_start(ex, bars) == (14, 9.5)


def _wicked(next_low):
    """b0 = bar 14, a red bar whose lower wick reaches 7.5 under a 9.8 body; bar 15's low `next_low`."""
    rows = _plain(PRE[:-1]) + [(10.0, 10.2, 7.5, 9.8), (9.8, 11.2, next_low, 11.0)]
    rows += _plain([13.0, 15.0, 17.0] + FLAG)                # top 17.5 at bar 18, flag 19-24
    return rows


UP, DN = ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5))


def test_a_pole_start_on_a_long_wick_moves_to_the_next_bar():
    ex, bars = _drawn(_wicked(9.5), 18, UP, DN)
    assert not ex.get("stale"), ex
    # the wick (2.3) is 2.1 ATR and 0.23 of the 10-point pole, and bar 15's low sits under its body
    assert _pole_start(ex, bars) == (15, 9.5)


def test_a_wick_whose_next_bar_holds_above_the_body_keeps_the_start():
    ex, bars = _drawn(_wicked(10.0), 18, UP, DN)
    assert not ex.get("stale"), ex
    assert _pole_start(ex, bars) == (14, 7.5)


def test_a_short_wick_keeps_the_start():
    rows = _wicked(9.5)
    rows[14] = (10.0, 10.2, 9.0, 9.8)                        # wick 0.8: under 1.2 ATR
    assert display.pole_draw_start(_ohlc(rows), 14, 18) == 14


# -- 2. grind_pole -----------------------------------------------------------------------------------

def _stairs(grind):
    """b0 = bar 14 (close 10); 16 pole bars to a top close of 16 at bar 30; a 6-bar flag (31-36)."""
    if grind:      # up 1.2, back 0.6, seven times, then 15.4, 16.0: efficiency 0.42, 7 of 16 down
        pole, c = [], 10.0
        for _ in range(7):
            c += 1.2
            pole.append(round(c, 2))
            c -= 0.6
            pole.append(round(c, 2))
        pole += [15.4, 16.0]
    else:          # the same rise in 16 straight steps
        pole = [round(10.0 + 6.0 * (k + 1) / 16, 3) for k in range(16)]
    flag = [15.8, 15.6, 15.4, 15.2, 15.0, 14.8]
    return _plain(PRE + pole + flag)


UPG, DNG = ((31, 16.3), (36, 15.3)), ((31, 15.3), (36, 14.3))


def test_a_stair_step_grind_is_not_a_pole():
    ex, _bars = _drawn(_stairs(True), 30, UPG, DNG)
    assert ex["stale"] is True and ex["stale_reason"] == "grind_pole", ex
    # control: the same rise in straight steps draws
    ok, _ = _drawn(_stairs(False), 30, UPG, DNG)
    assert not ok.get("stale"), ok


def test_grind_needs_both_low_efficiency_and_many_down_closes():
    bars = _ohlc(_stairs(True))
    assert display.pole_impulse_verdict(bars, 14, 30) == (False, "grind_pole")
    # one big down close (efficiency 0.5) is a pullback, not a staircase: 1 of 16 bars down
    rows = _plain(PRE + [11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 13.0]
                  + [13.5, 14.0, 14.5, 15.0, 15.5, 16.0, 16.0])
    assert display.pole_impulse_verdict(_ohlc(rows), 14, 30) == (True, None)


# -- 3. lanes ---------------------------------------------------------------------------------------

def _lanes(rows, b1, upper, lower, b0=14):
    bars = _ohlc(rows)
    d = _flag_det([r[3] for r in rows], b0, b1, upper, lower)
    return display.flag_draw_lanes(bars, display._index(bars), d), bars


def test_a_wide_red_first_flag_bar_is_left_out_of_the_lane_fit(_round_7_lanes):
    rows = _plain(PRE + [11.0, 13.0, 15.0, 17.0])
    rows += [(17.4, 17.5, 15.6, 15.8)]                       # bar 19: red body 1.6, range 1.9
    rows += _plain([16.6, 16.5, 16.4, 16.3, 16.2])           # bars 20-24
    ex, bars = _drawn(rows, 18, UP, DN)
    assert not ex.get("stale"), ex
    da = ex["draw_anchors"]
    assert da[0]["t"] == da[2]["t"] == ymd_t(20) and da[1]["t"] == da[3]["t"] == ymd_t(24), da
    assert [round(a["price"], 4) for a in da] == [17.1, 16.7, 16.1, 15.7]
    # control: a narrow red first bar stays in, and the lanes need no refit
    rows[19] = (17.0, 17.5, 16.5, 16.8)
    assert _lanes(rows, 18, UP, DN)[0] is None


def test_a_wide_first_bar_stays_in_when_leaving_it_out_makes_the_lanes_rise():
    rows = _plain(PRE + [11.0, 13.0, 15.0, 17.0])
    rows += [(17.4, 17.5, 15.6, 15.8)] + _plain([16.0, 16.1, 16.2, 16.3, 16.4])   # a rise after it
    da, _ = _lanes(rows, 18, UP, DN)
    assert da is None or da[0]["t"] == ymd_t(19), da


def _wedge(lows):
    """Flag bars 19-24: highs falling 17.5 -> 16.5, the given lows, closes in between."""
    highs = [17.5 - 0.2 * k for k in range(6)]
    return _plain(PRE + [11.0, 13.0, 15.0, 17.0]) + [
        (round((h + lo) / 2, 3), round(h, 3), lo, round((h + lo) / 2, 3)) for h, lo in zip(highs, lows)]


def test_a_flat_bottomed_wedge_is_drawn_as_a_parallel_channel(_round_7_lanes):
    rows = _wedge([15.8] * 6)
    ex, _ = _drawn(rows, 18, UP, ((19, 15.8), (24, 15.8)))
    assert not ex.get("stale"), ex
    da = ex["draw_anchors"]
    up_slope = (da[1]["price"] - da[0]["price"]) / 5
    lo_slope = (da[3]["price"] - da[2]["price"]) / 5
    assert abs(up_slope - lo_slope) < 1e-6 and abs(up_slope + 0.1) < 1e-6, (up_slope, lo_slope)
    # control: a wedge whose lower lane falls 0.1 ATR a bar is a real wedge -- no refit
    sloped = _wedge([16.5 - 0.1 * k for k in range(6)])
    assert _lanes(sloped, 18, UP, ((19, 16.5), (24, 16.0)))[0] is None


def test_a_lane_end_floating_off_the_bars_is_pulled_onto_them():
    # lows high at both ends and deep in the middle: the fitted lower lane sits ~0.9 ATR under the
    # two bars at each end
    lows = [16.8, 16.8, 14.0, 14.0, 16.8, 16.8]
    highs = [17.6, 17.5, 17.4, 17.3, 17.2, 17.1]
    rows = _plain(PRE + [11.0, 13.0, 15.0, 17.0]) + [
        (round((h + lo) / 2, 3), h, lo, round((h + lo) / 2, 3)) for h, lo in zip(highs, lows)]
    da, _ = _lanes(rows, 18, UP, DN)
    assert da is not None and da[2]["price"] == 16.8 and da[3]["price"] == 16.8, da
    # control: the same flag with the dip at the ends instead has no floating end
    rows2 = _plain(PRE + [11.0, 13.0, 15.0, 17.0]) + [
        (round((h + lo) / 2, 3), h, lo, round((h + lo) / 2, 3))
        for h, lo in zip(highs, [16.6, 16.4, 16.5, 16.4, 16.3, 16.2])]
    assert _lanes(rows2, 18, UP, DN)[0] is None


def test_the_good_flag_draws_with_no_refit_and_its_own_pole():
    ex, bars = _drawn(_plain(PRE + [11.0, 13.0, 15.0, 17.0] + FLAG), 18, UP, DN)
    assert not ex.get("stale"), ex
    assert "draw_anchors" not in ex, ex
    assert _pole_start(ex, bars) == (14, 9.5)


def test_unknown_bars_draw_nothing_new():
    bars = _ohlc(_plain(PRE + [11.0, 13.0, 15.0, 17.0] + FLAG))
    d = _flag_det([b["c"] for b in bars], 14, 18, UP, DN)
    d["pivot_ts"] = [99999999]
    assert display.flag_draw_lanes(bars, {}, d) is None
    assert display.pole_draw_start(bars, 18, 14) == 18
    assert display.pole_impulse_verdict(bars, 18, 14) == (True, None)
