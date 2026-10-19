"""bull_flag geometry round 3 (lab flag_geom_v3, 2026-10-18): today's drawing with ONE change, the UPPER lane.

The upper lane runs from the pole top's high to the flag's last bar at the shallowest slope that keeps every
flag high on or under it. Lower lane, entry, pole and which flags are drawn are unchanged, for both tiers.
Lab gates: two fresh blind tier-1 packets 2.40 (93% >= 2) and 2.37 (80% >= 2); the team-axis upper-lane hit
rate over all team flag charts 0.415 vs 0.317 today (not an independent test); no lookahead.

  1. parity       on the 30 judged cases (de-identified fixture), the port stamps exactly what the lab did
  2. golden       non-flag rows and undrawn flags are untouched; a drawn flag changes only its upper lane
                  (draw_anchors[0:2]) and gains draw_geom_round; lower lane, entry, pole, draw_round stay
  3. no lookahead bars after the flag's last bar never change the stamp
Synthetic bars plus the de-identified fixture only (public repo).
"""
from __future__ import annotations

import copy
import json
import os

import pytest

from api.services.pattern_engine import display
from tests.test_bull_flag_r7 import _ohlc, _plain
from tests.test_bull_flag_r9 import TALL_LEG, _flag_after
from tests.test_team_drawing_set_r4 import _flag_det

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "bull_flag_geom_v3", "judged_cases.json")
CASES = json.load(open(FIXTURE, encoding="utf-8"))["cases"]


def _drawn_row(rows, b1, upper, lower):
    d = _flag_det([r[3] for r in rows], 14, b1, upper, lower)
    bars = _ohlc(rows)
    display.draw_geometry([d], bars)
    return d, bars


def _tall_flag():
    rows, top, up, dn = _flag_after(TALL_LEG)
    return _drawn_row(rows, top, up, dn)


def test_the_round_constant():
    assert display.BULL_FLAG_GEOM_ROUND == 3
    assert display.BULL_FLAG_DRAW_ROUND == 9          # the member round is untouched


# -- 1. parity with the lab on the judged cases ---------------------------------------------------------

def test_the_fixture_is_the_30_judged_cases_and_each_was_restamped():
    assert len(CASES) == 30
    assert all(c["expected"]["geometry"]["extras"]["draw_geom_round"] == 3 for c in CASES)
    assert all(c["expected"] != c["today"] for c in CASES)          # not vacuous


@pytest.mark.parametrize("k", range(30))
def test_the_port_stamps_what_the_lab_stamped(k):
    c = CASES[k]
    d = copy.deepcopy(c["today"])
    display.stamp_upper_lane_v3(d, c["bars"])
    assert json.dumps(d, sort_keys=True) == json.dumps(c["expected"], sort_keys=True)


# -- 2. golden: only the upper lane moves ----------------------------------------------------------------

def _drawn_lanes(d):
    ex = d["geometry"]["extras"]
    return ex.get("draw_anchors") or d["geometry"]["anchors"]


@pytest.mark.parametrize("k", range(30))
def test_only_the_upper_lane_moves_on_the_judged_cases(k):
    c = CASES[k]
    before, after = c["today"], copy.deepcopy(c["today"])
    display.stamp_upper_lane_v3(after, c["bars"])
    assert _drawn_lanes(after)[2:] == _drawn_lanes(before)[2:]      # lower lane
    exb, exa = before["geometry"]["extras"], after["geometry"]["extras"]
    for key in ("draw_pole", "draw_entry_price", "draw_round", "draw_lanes", "stale"):
        assert exa.get(key) == exb.get(key)
    rest_b = {k_: v for k_, v in exb.items() if k_ not in ("draw_anchors", "draw_geom_round")}
    rest_a = {k_: v for k_, v in exa.items() if k_ not in ("draw_anchors", "draw_geom_round")}
    assert rest_a == rest_b
    assert {k_: v for k_, v in after.items() if k_ != "geometry"} == \
        {k_: v for k_, v in before.items() if k_ != "geometry"}
    assert after["geometry"]["anchors"] == before["geometry"]["anchors"]


def test_the_upper_lane_starts_at_the_pole_top_and_rests_on_the_flag_highs():
    d, bars = _tall_flag()
    ex = d["geometry"]["extras"]
    assert ex["draw_geom_round"] == 3 and ex["draw_round"] == 9
    pole_top = ex["draw_pole"][1]
    up = ex["draw_anchors"][:2]
    assert up[0] == {"t": pole_top["t"], "price": pole_top["price"]}
    assert up[1]["t"] == bars[-1]["t"]
    pos = {b["t"]: i for i, b in enumerate(bars)}
    x0, x1 = pos[up[0]["t"]], pos[up[1]["t"]]
    m = (up[1]["price"] - up[0]["price"]) / (x1 - x0)
    gaps = [up[0]["price"] + m * (j - x0) - bars[j]["h"] for j in range(x0 + 1, x1 + 1)]
    assert min(gaps) >= -1e-6                                      # every flag high on or under it
    assert min(gaps) <= 1e-6                                       # ... and it touches one (shallowest)


def test_the_stamp_runs_after_every_verdict_so_selection_cannot_move(monkeypatch):
    rows, top, up, dn = _flag_after(TALL_LEG)
    on, _ = _drawn_row(rows, top, up, dn)
    monkeypatch.setattr(display, "stamp_upper_lane_v3", lambda d, bars: None)
    off, _ = _drawn_row(rows, top, up, dn)
    a, b = on["geometry"]["extras"], off["geometry"]["extras"]
    assert {k: v for k, v in a.items() if k not in ("draw_anchors", "draw_geom_round")} == \
        {k: v for k, v in b.items() if k != "draw_anchors"}
    assert _drawn_lanes(on)[2:] == _drawn_lanes(off)[2:]
    assert _drawn_lanes(on)[:2] != _drawn_lanes(off)[:2]


def test_non_flag_rows_and_undrawn_flags_are_untouched():
    c = CASES[0]
    other = {"pattern_id": "bear_flag", "pivot_ts": c["today"]["pivot_ts"],
             "geometry": copy.deepcopy(c["today"]["geometry"])}
    stale = copy.deepcopy(c["today"])
    stale["geometry"]["extras"].update(stale=True, stale_reason="short_pole")
    lanes_off = copy.deepcopy(c["today"])
    lanes_off["geometry"]["extras"]["draw_lanes"] = False
    flagging_off = copy.deepcopy(stale)
    flagging_off["geometry"]["extras"]["flagging"] = {"tier": "flagging", "draw_round": 9, "draw_lanes": False}
    no_round = copy.deepcopy(c["today"])
    no_round["geometry"]["extras"].pop("draw_round")
    for row in (other, stale, lanes_off, flagging_off, no_round):
        before = copy.deepcopy(row)
        display.stamp_upper_lane_v3(row, c["bars"])
        assert row == before


def test_the_flagging_tier_gets_the_lane_inside_its_own_stamp():
    c = CASES[0]
    row = copy.deepcopy(c["today"])
    ex = row["geometry"]["extras"]
    ex.update(stale=True, stale_reason="short_pole")
    ex.pop("draw_round")
    ex["flagging"] = {"tier": "flagging", "draw_round": 9, "draw_lanes": True}
    top_level = {k: copy.deepcopy(v) for k, v in ex.items() if k != "flagging"}
    display.stamp_upper_lane_v3(row, c["bars"])
    st = row["geometry"]["extras"]["flagging"]
    assert st["draw_geom_round"] == 3 and st["draw_round"] == 9 and st["tier"] == "flagging"
    assert st["draw_anchors"] == c["expected"]["geometry"]["extras"]["draw_anchors"]
    assert {k: v for k, v in row["geometry"]["extras"].items() if k != "flagging"} == top_level


def test_crossing_lanes_leave_the_row_as_it_is():
    c = CASES[0]
    row = copy.deepcopy(c["today"])
    lanes = copy.deepcopy(_drawn_lanes(row))
    hi = max(b["h"] for b in c["bars"]) * 2
    lanes[2]["price"], lanes[3]["price"] = hi, hi            # lower lane above everything
    row["geometry"]["extras"]["draw_anchors"] = lanes
    before = copy.deepcopy(row)
    display.stamp_upper_lane_v3(row, c["bars"])
    assert row == before


def test_a_log_space_upper_lane_is_redrawn_in_price_space_and_the_lower_keeps_its_space():
    c = CASES[0]
    row = copy.deepcopy(c["today"])
    ex = row["geometry"]["extras"]
    ex.pop("draw_anchors", None)
    ex["line_spaces"] = ["log", "log"]
    display.stamp_upper_lane_v3(row, c["bars"])
    assert row["geometry"]["extras"]["line_spaces"] == ["price", "log"]
    assert row["geometry"]["extras"]["draw_anchors"][2:] == row["geometry"]["anchors"][2:]


def test_too_short_a_flag_is_left_as_it_is():
    c = CASES[0]
    row = copy.deepcopy(c["today"])
    pts = row["pivot_ts"]
    pos = {b["t"]: i for i, b in enumerate(c["bars"])}
    top = max(range(pos[pts[0]], pos[pts[1]] + 1), key=lambda j: (c["bars"][j]["h"], j))
    bars = c["bars"][:top + 2]                               # one flag bar after the top
    row["pivot_ts"] = [pts[0], pts[1], bars[-1]["t"]]
    assert display.flag_upper_lane_v3(bars, row) is None


# -- 3. no lookahead --------------------------------------------------------------------------------------

def _future(bars, k, mult):
    hi = max(b["h"] for b in bars)
    t0 = bars[-1]["t"]
    return bars + [{"t": t0 + j, "o": hi * mult / 2, "h": hi * mult, "l": 0.01, "c": hi * mult / 3, "v": 9}
                   for j in range(1, k + 1)]


@pytest.mark.parametrize("k", range(30))
def test_bars_after_the_flag_never_change_the_stamp(k):
    c = CASES[k]
    want = copy.deepcopy(c["today"])
    display.stamp_upper_lane_v3(want, c["bars"])
    for mult in (3.0, 7.5):
        got = copy.deepcopy(c["today"])
        display.stamp_upper_lane_v3(got, _future(c["bars"], 25, mult))
        assert got == want


def test_the_upper_lane_reads_no_bar_after_the_flags_last_bar():
    d, bars = _tall_flag()
    want = display.flag_upper_lane_v3(bars, d)
    poisoned = copy.deepcopy(bars) + [{"t": bars[-1]["t"] + j, "o": 1e9, "h": 1e9, "l": 1e-9, "c": 1e9, "v": 0}
                                      for j in range(1, 10)]
    assert display.flag_upper_lane_v3(poisoned, d) == want


def test_a_tied_pole_top_anchors_on_the_LATER_bar_as_the_lab_judged():
    """The lab rule (geom_v2.pole_top_index): equal highs resolve to the later bar. display.pole_top_index
    keeps the earliest; the upper lane deliberately follows the lab, because that is what was judged."""
    bars = [{"t": k + 1, "o": 10.0, "h": h, "l": 9.0, "c": 10.0, "v": 0}
            for k, h in enumerate([10.0, 12.0, 15.0, 15.0, 14.0, 13.5, 13.0])]
    d = {"pattern_id": "bull_flag", "pivot_ts": [1, 4, 7]}
    up = display.flag_upper_lane_v3(bars, d)
    assert up[0] == {"t": 4, "price": 15.0}                   # bar index 3, not 2
    assert display.pole_top_index(bars, 0, 3) == 2            # the display helper differs on purpose
