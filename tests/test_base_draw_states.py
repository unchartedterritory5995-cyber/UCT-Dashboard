"""The bc:base STATES (base_draw.state_drawing): breakout persistence, 3 weeks tight and base forming.

A member's base used to vanish the session after any close above its pivot (the walk-back in `_evaluate`
starts at the prior bar and rejects any earlier close over the pivot), so the buy point disappeared while
the stock was still in its buy zone; and a base whose right side was still building, or a short tight area
at highs, was never drawn. Each state is drawn ONLY where `base_drawing` draws nothing, so a judged base is
never changed; each reaches a member only while its own MEMBER_BASE_*_ROUND literal matches the stamped
`state_round` (breakout and forming: live, each passed two blind packets; tight: None, it failed its first).

Synthetic bars only: piecewise-linear closes with a small zig-zag, a fixed wick, weekdays from 2024-01-01.
"""
from __future__ import annotations

import copy
import datetime
import json

import pytest

from api.services import auto_structures, base_metrics, textbook_numbers
from api.services.pattern_engine import base_draw as BD


# ---------------------------------------------------------------- synthetic bars

def _days(n):
    out, d = [], datetime.date(2024, 1, 1)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


def _bars(legs, amp=0.3, wick=0.8):
    cl = [legs[0][1]]
    for n, p in legs[1:]:
        a = cl[-1]
        cl += [a + (p - a) * (k + 1) / n for k in range(n)]
    cl = [c + (amp if i % 2 else -amp) for i, c in enumerate(cl)]
    ts = _days(len(cl))
    out = []
    for i, c in enumerate(cl):
        o = cl[i - 1] if i else c
        out.append({"t": ts[i], "o": o, "h": max(o, c) + wick, "l": min(o, c) - wick, "c": c, "v": 1e6})
    return out


#: an advance into a ~90 lip, an ~11% pullback, the right side back at the lip: round 4 draws the base here
BASE = [(1, 40.0), (150, 60.0), (20, 55.0), (60, 90.0), (12, 80.0), (14, 88.5), (4, 89.6)]
#: the same advance (a deeper prior dip, a real low) and the right side still building ~7% under the lip
FORMING = [(1, 40.0), (150, 60.0), (20, 50.0), (60, 90.0), (12, 78.0), (16, 84.0)]
#: an advance, then three weeks of closes within a fraction of a percent, the last bar a Friday
TIGHT = [(1, 40.0), (200, 60.0), (40, 80.0), (14, 80.0)]


def _last(b):
    return len(b) - 1


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


# ---------------------------------------------------------------- the fixtures say what they claim

def test_the_fixtures_are_what_they_claim():
    b = _bars(BASE)
    assert BD.base_drawing(b, _last(b)) is not None
    for legs in (BASE + [(2, 92.6)], FORMING, TIGHT):
        b = _bars(legs)
        assert BD.base_drawing(b, _last(b)) is None, legs[-1]


# ---------------------------------------------------------------- breakout persistence

def test_a_base_broken_out_of_stays_drawn_in_the_buy_zone():
    b = _bars(BASE + [(2, 92.6)])
    i = _last(b)
    d = BD.breakout_drawing(b, i)
    assert d is not None and d["state"] == "breakout" and d["state_round"] == BD.STATE_ROUND
    # the geometry is the base drawn at its own as-of bar, unchanged; only end_t moves to the as-of bar
    j = [x["t"] for x in b].index(d["base_end_t"])
    assert j < i and BD.base_drawing(b, i) is None
    base = BD.base_drawing(b, j)
    assert base is not None
    assert {k: v for k, v in d.items() if k not in ("end_t", "base_end_t", "breakout_t", "state", "state_round")} \
        == {k: v for k, v in base.items() if k != "end_t"}
    assert d["base_end_t"] == base["end_t"] and d["end_t"] == b[i]["t"]
    assert d["breakout_t"] in {x["t"] for x in b[j:i + 1]}


def test_past_the_buy_zone_it_is_extended_and_past_ten_percent_it_is_gone():
    b = _bars(BASE + [(4, 96.0)])
    assert BD.breakout_drawing(b, _last(b))["state"] == "extended"
    b = _bars(BASE + [(4, 102.5)])
    assert BD.breakout_drawing(b, _last(b)) is None


def test_the_zone_is_measured_from_the_printed_buy_point():
    b = _bars(BASE + [(4, 96.0)])
    d = BD.breakout_drawing(b, _last(b))
    ts = [x["t"] for x in b]
    lip, j = ts.index(d["start_t"]), ts.index(d["base_end_t"])
    bp = textbook_numbers.buy_point(textbook_numbers.pivot_high(b[lip:j], d["pivot"], d["atr"]))
    assert bp > d["pivot"]
    c = b[-1]["c"]
    assert bp * 1.05 < c <= bp * 1.10                       # extended by the buy point ...
    assert c <= d["pivot"] * 1.10                           # ... and by the line itself too


def test_a_failed_breakout_is_not_drawn():
    b = _bars(BASE + [(2, 93.0), (2, 86.0)])
    assert BD.breakout_drawing(b, _last(b)) is None
    assert BD.state_drawing(b, _last(b)) is None


def test_a_dip_under_the_pivot_less_one_atr_is_a_failed_breakout_even_after_a_recovery():
    # broke out, fell more than 1 ATR under the pivot, then came back into the zone: still failed, not drawn
    b = _bars(BASE + [(2, 93.0), (2, 86.0), (3, 93.0)])
    i = _last(b)
    assert b[-1]["c"] > 91.5 and BD.base_drawing(b, i) is None      # back in the zone, no base drawn today
    assert BD.breakout_drawing(b, i) is None
    # control: the same path with a shallow dip (inside 1 ATR) IS kept
    ok = _bars(BASE + [(2, 93.0), (2, 89.0), (3, 93.0)])
    assert BD.breakout_drawing(ok, _last(ok)) is not None


def test_a_close_back_under_the_buy_point_hides_it():
    b = _bars(BASE + [(2, 92.6), (1, 89.0)])
    assert BD.breakout_drawing(b, _last(b)) is None


def test_only_the_last_ten_sessions_are_searched():
    # the last bar a base is drawn on, then sessions inside the zone: kept for ten, gone on the eleventh
    b = _bars(BASE + [(2, 92.6), (12, 93.0)])
    j = max(k for k in range(len(b)) if BD.base_drawing(b, k) is not None)
    assert BD.PERSIST_BARS == 10
    assert BD.breakout_drawing(b, j + 10) is not None
    assert BD.breakout_drawing(b, j + 11) is None


def test_breakout_reads_no_future_bar():
    b = _bars(BASE + [(2, 92.6), (6, 120.0)])
    i = len(_bars(BASE + [(2, 92.6)])) - 1
    assert BD.breakout_drawing(b, i) == BD.breakout_drawing(b[:i + 1], i)


# ---------------------------------------------------------------- base forming

def test_a_base_whose_right_side_is_building_is_forming():
    b = _bars(FORMING)
    d = BD.forming_drawing(b, _last(b))
    assert d is not None and d["state"] == "forming"
    assert d["pivot"] > b[-1]["c"] > d["low"]
    assert BD.state_drawing(b, _last(b)) == d


def test_forming_needs_a_rising_right_side():
    b = _bars(FORMING + [(3, 79.0)])                   # rolled back over: under its 21-day average
    assert BD.forming_drawing(b, _last(b)) is None


def test_forming_needs_the_close_within_the_band():
    b = _bars(FORMING[:-2] + [(12, 70.0), (16, 76.0)])   # rising, but more than 5 ATR under the lip
    piv = BD.forming_drawing(_bars(FORMING), len(_bars(FORMING)) - 1)["pivot"]
    assert b[-1]["c"] < piv - BD.FORM_BELOW_ATR * BD._atr(b, _last(b))
    assert b[-1]["c"] > BD._ema(b, _last(b), BD.FORM_EMA)  # the right side IS rising: only the band withholds it
    assert BD.forming_drawing(b, _last(b)) is None


def test_the_evaluate_default_is_unchanged_by_the_forming_band():
    # the same candidate the forming state admits is NOT a round-2 base: the forming band is opt-in only
    b = _bars(FORMING)
    i = _last(b)
    a = BD._atr(b, i)
    assert any(BD._evaluate(b, i, a, k, 2, waive=True, forming=True) for k in BD._candidates(b, i))
    assert not any(BD._evaluate(b, i, a, k, 2, waive=True) for k in BD._candidates(b, i))


# ---------------------------------------------------------------- 3 weeks tight

def test_three_tight_weeks_at_highs_are_drawn():
    b = _bars(TIGHT)
    d = BD.tight_drawing(b, _last(b))
    assert d is not None and d["state"] == "tight"
    area = [x for x in b if d["start_t"] <= x["t"]]
    assert d["pivot"] == max(x["h"] for x in area) and d["low"] == min(x["l"] for x in area)


def test_loose_weeks_are_not_tight():
    b = _bars(TIGHT, amp=1.6)
    assert BD.tight_drawing(b, _last(b)) is None


def test_tight_needs_a_prior_advance():
    b = _bars([(1, 78.0), (240, 80.0), (14, 80.0)])
    assert BD.tight_drawing(b, _last(b)) is None


def test_a_pinned_price_is_not_tight():
    b = _bars(TIGHT, amp=0.05, wick=0.1)                # ATR far under 1% of the close
    assert BD.tight_drawing(b, _last(b)) is None


# ---------------------------------------------------------------- the row, the label numbers, the member gate

def test_base_draw_row_draws_a_state_only_where_no_base_is_drawn():
    b = _bars(BASE)
    row = auto_structures.base_draw_row("SYN", b)
    assert "state" not in row["geometry"]["extras"]["draw_base"]
    assert row == auto_structures._base_row("SYN", BD.base_drawing(b, _last(b)), BD.BASE_DRAW_ROUND)
    for legs, st in ((BASE + [(2, 92.6)], "breakout"), (FORMING, "forming"), (TIGHT, "tight")):
        r = auto_structures.base_draw_row("SYN", _bars(legs))
        assert r["geometry"]["extras"]["draw_base"]["state"] == st


def test_a_breakout_label_reads_the_base_not_the_bars_since():
    b = _bars(BASE + [(2, 92.6)])
    row = auto_structures.base_draw_row("SYN", b)
    j = [x["t"] for x in b].index(row["geometry"]["extras"]["draw_base"]["base_end_t"])
    base_row = auto_structures._base_row("SYN", BD.base_drawing(b, j), BD.BASE_DRAW_ROUND)
    m_now = base_metrics.compute(row, b)
    m_base = base_metrics.compute(base_row, b[:j + 1])
    assert m_now["length_weeks"] == m_base["length_weeks"]
    assert m_now["pct_from_pivot"] > 0 and m_now["asof_t"] == b[-1]["t"]
    row["geometry"]["extras"]["metrics"] = m_now
    base_row["geometry"]["extras"]["metrics"] = m_base
    t_now = textbook_numbers.compute(row, b, asof_complete=lambda t: True)
    t_base = textbook_numbers.compute(base_row, b[:j + 1], asof_complete=lambda t: True)
    assert t_now["buy_point"] == t_base["buy_point"] and t_now["base_high"] == t_base["base_high"]
    assert t_now["pct_from_buy_point"] > 0


def test_member_gate_serves_breakout_and_withholds_dark_states(monkeypatch):
    rows = {st: auto_structures.base_draw_row("SYN", _bars(legs))
            for legs, st in ((BASE + [(2, 92.6)], "breakout"), (FORMING, "forming"), (TIGHT, "tight"))}
    assert auto_structures.MEMBER_BASE_BREAKOUT_ROUND == 1
    assert auto_structures.MEMBER_BASE_FORMING_ROUND == 1
    assert auto_structures.MEMBER_BASE_TIGHT_ROUND is None
    assert auto_structures.member_rows([rows["breakout"]]) == [rows["breakout"]]
    assert auto_structures.member_rows([rows["forming"]]) == [rows["forming"]]
    assert auto_structures.member_rows([rows["tight"]]) == []
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_FORMING_ROUND", None)
    assert auto_structures.member_rows([rows["forming"]]) == []
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_FORMING_ROUND", 1)
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_TIGHT_ROUND", 1)
    assert auto_structures.member_rows([rows["forming"]]) == [rows["forming"]]
    assert auto_structures.member_rows([rows["tight"]]) == [rows["tight"]]
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_BREAKOUT_ROUND", None)
    assert auto_structures.member_rows([rows["breakout"]]) == []


def test_member_gate_fails_closed_on_a_bad_state_stamp():
    row = auto_structures.base_draw_row("SYN", _bars(BASE + [(2, 92.6)]))
    for over in ({"state": "breakaway"}, {"state": None}, {"state_round": 2}, {"state_round": "1"},
                 {"state_round": None}):
        r = copy.deepcopy(row)
        r["geometry"]["extras"]["draw_base"].update(over)
        assert auto_structures.member_rows([r]) == [], over
    r = copy.deepcopy(row)
    del r["geometry"]["extras"]["draw_base"]["state_round"]
    assert auto_structures.member_rows([r]) == []


def test_a_stateless_base_row_is_served_exactly_as_before():
    row = auto_structures.base_draw_row("SYN", _bars(BASE))
    assert auto_structures.member_rows([row]) == [row]
    assert json.dumps(row["geometry"]["extras"]["draw_base"], sort_keys=True) == json.dumps(
        BD.base_drawing(_bars(BASE), len(_bars(BASE)) - 1), sort_keys=True)
