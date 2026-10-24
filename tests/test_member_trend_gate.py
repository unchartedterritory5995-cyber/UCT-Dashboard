"""The trend floor on every member-visible bullish base drawing: base_draw.trend_ok.

A buyable base sits above a RISING 200-day average (O'Neil; the trend template). A prod eye audit (2026-10-23)
found bullish "pivots" drawn in downtrends: shelf pivots under the 200-day or under a falling one (often labelled
"(cleared)"), and base drawings under a falling 200-day. Base round 4 already had the rule for its own pass; it
now lives in ONE function (base_draw.trend_ok) read by:
  * base_draw.base_drawing, rounds 2 and 4 (round 1, the lab port, is unchanged);
  * shelf_pivot.shelf_eligible;
  * shape_draw.double_bottom_drawing;
  * auto_structures.member_trend_gate, on the member path, for the base rows whose drawing code is a detector or
    the base catalog (flat_base, bc:flat-base, uct_flat_top_breakout).

Synthetic bars only (no ticker, no real price). The two charts end in the SAME base; only the history before it
differs: an advance (a rising 200-day), or a plateau, a drop and a recovery that leaves the close above a FALLING
200-day.
"""
from __future__ import annotations

import datetime
import math

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures as AS
from api.services.pattern_engine import base_draw as BD
from api.services.pattern_engine import shape_draw as SD
from api.services.pattern_engine import shelf_pivot as S
from tests.authclients import PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store


def _path(legs, start):
    """Closes along geometric legs [(n_bars, end_multiple)] from `start`."""
    out, p = [], start
    for n, mult in legs:
        r = mult ** (1.0 / n)
        for _ in range(n):
            p *= r
            out.append(p)
    return out


def _chart(prior, base_len=40, depth=0.12, last=-0.004):
    """`prior` closes, then a rounded base `depth` deep over `base_len` sessions, then one session `last` away from
    the base's starting close."""
    out, d = [], datetime.date(2023, 1, 2)
    n_up = len(prior)
    while len(out) < n_up + base_len + 1:
        if d.weekday() >= 5:
            d += datetime.timedelta(days=1)
            continue
        k = len(out)
        if k < n_up:
            c = prior[k] * (1 + 0.01 * math.sin(k / 3))
            o = c * 0.995
        else:
            j, top = k - n_up, out[n_up - 1]["c"]
            c = top * (1 - depth * math.sin(math.pi * j / base_len)) if j < base_len else top * (1 + last)
            o = c if j == 0 else c * (1.004 if j % 2 else 0.996)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(max(o, c) * 1.006, 4),
                    "l": round(min(o, c) * 0.994, 4), "c": round(c, 4), "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


#: A base after a 300-session advance: the close above a rising 200-day.
UP = _chart(_path([(300, math.exp(0.9))], 50.0))
#: The same base after a plateau, a 47% drop and a recovery: the close above a FALLING 200-day.
DOWN = _chart([150.0] * 100 + _path([(20, 80 / 150), (60, 1.0), (80, 1.5)], 150.0))


def _closes(b):
    return [x["c"] for x in b]


def _sma(cl, i, n=200):
    return sum(cl[i - n + 1:i + 1]) / n


# --------------------------------------------------------------------------- the fixtures are what they say
def test_the_two_charts_differ_only_in_the_trend():
    for b, rising in ((UP, True), (DOWN, False)):
        cl, i = _closes(b), len(b) - 1
        assert cl[i] > _sma(cl, i)                                  # both close above the 200-day ...
        assert (_sma(cl, i) > _sma(cl, i - 20)) is rising           # ... only one of them RISING
    # the same base: the last 41 sessions move by the same ratios
    ru = [UP[k]["c"] / UP[-41]["c"] for k in range(-41, 0)]
    rd = [DOWN[k]["c"] / DOWN[-41]["c"] for k in range(-41, 0)]
    assert max(abs(a - b) for a, b in zip(ru, rd)) < 1e-4


# --------------------------------------------------------------------------- trend_ok
def test_trend_ok():
    assert BD.trend_ok(_closes(UP), len(UP) - 1) is True
    assert BD.trend_ok(_closes(DOWN), len(DOWN) - 1) is False       # above a FALLING 200-day
    under = _closes(UP)[:-1] + [_sma(_closes(UP), len(UP) - 2) * 0.9]
    assert BD.trend_ok(under, len(under) - 1) is False             # under a rising 200-day
    cl = _closes(UP)
    assert BD.trend_ok(cl[:220], 219) is True and BD.trend_ok(cl[:219], 218) is False   # 220 sessions to tell
    assert BD.trend_ok(cl, len(cl)) is False and BD.trend_ok(cl, None) is False
    # only closes[:i+1] are read: a wild future changes nothing
    i = len(cl) - 1
    assert BD.trend_ok(cl + [1.0] * 30, i) is True


# --------------------------------------------------------------------------- the base drawing
def test_the_base_in_an_uptrend_is_drawn():
    i = len(UP) - 1
    assert BD.base_drawing(UP, i, draw_round=2) is not None
    assert BD.base_drawing(UP, i) is not None                       # round 4, the member round
    assert AS.base_draw_row("SYN", UP) is not None


def test_the_same_base_under_a_falling_200_day_is_not_drawn():
    i = len(DOWN) - 1
    assert BD.base_drawing(DOWN, i, draw_round=1) is not None       # the geometry IS a base (the lab port) ...
    assert BD.base_drawing(DOWN, i, draw_round=2) is None           # ... but the member rounds draw nothing
    assert BD.base_drawing(DOWN, i) is None
    assert AS.base_draw_row("SYN", DOWN) is None


def test_control_without_the_floor_the_downtrend_base_is_drawn(monkeypatch):
    monkeypatch.setattr(BD, "trend_ok", lambda closes, i: True)
    assert BD.base_drawing(DOWN, len(DOWN) - 1) is not None


# --------------------------------------------------------------------------- the shelf pivot
def _cand(b):
    f = {"touch_g": 4, "last_touch_age": 2, "recovery": 1.0, "n": 40, "depth_pct": 0.12, "slope_20": 0.0,
         "c_sma50": 0.05, "adv120": 0.3}
    return {"src": "ceil", "P": b[-1]["c"] * 1.005, "left": len(b) - 41, "f": f}


def test_a_shelf_in_an_uptrend_is_eligible_and_under_a_falling_200_day_is_not():
    for b, want in ((UP, (True, "ok")), (DOWN, (False, "below_or_falling_200"))):
        T, O, H, L, C, V = S.arrays([(x["t"], x["o"], x["h"], x["l"], x["c"], x["v"]) for x in b])
        i = len(b) - 1
        a = S.atr14(H, L, C, i)
        assert S.shelf_eligible(H, C, i, a, _cand(b), []) == want


# --------------------------------------------------------------------------- the double bottom
def test_a_double_bottom_is_never_drawn_under_a_falling_200_day():
    why = []
    assert SD.double_bottom_drawing(DOWN, len(DOWN) - 1, _why=why) is None
    assert why == ["below_or_falling_200"]
    why = []
    SD.double_bottom_drawing(UP, len(UP) - 1, _why=why)
    assert "below_or_falling_200" not in why                       # the uptrend chart reaches the shape rules


# --------------------------------------------------------------------------- the member path
def _row(pid):
    t0, t1 = UP[-41]["t"], UP[-1]["t"]
    return {"id": pid, "pattern_id": pid, "start_t": t0, "end_t": t1, "levels": {"entry": 100.0},
            "geometry": {"shape": "base_box", "anchors": [{"t": t0, "price": 100.0}, {"t": t1, "price": 90.0}],
                         "extras": {"top": 100.0}}}


def test_member_trend_gate_drops_only_the_gated_rows_under_a_falling_200_day(monkeypatch):
    det = [_row("flat_base"), _row("uct_flat_top_breakout"), _row("uct_pullback_ma_v5")]
    st = [_row("bc:flat-base"), _row("bc:cup-with-handle")]
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: DOWN)
    d, s = AS.member_trend_gate("SYN", det, st)
    assert [r["pattern_id"] for r in d] == ["uct_pullback_ma_v5"]
    assert [r["pattern_id"] for r in s] == ["bc:cup-with-handle"]
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: UP)
    assert AS.member_trend_gate("SYN", det, st) == (det, st)


def test_member_trend_gate_reads_no_bars_without_a_gated_row_and_a_read_error_leaves_rows_ungated(monkeypatch):
    calls = []

    def boom(sym):
        calls.append(sym)
        raise RuntimeError("store down")
    monkeypatch.setattr(AS, "_daily_bars", boom)
    other = [_row("uct_pullback_ma_v5")]
    assert AS.member_trend_gate("SYN", other, []) == (other, []) and calls == []   # the store is never asked
    det, st = other + [_row("flat_base")], [_row("bc:flat-base")]
    assert AS.member_trend_gate("SYN", det, st) == (det, st) and calls == ["SYN"]  # unknown is not a downtrend
    # too short a history to read a rising 200-day is a known answer: the gated rows go
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: UP[:219])
    assert AS.member_trend_gate("SYN", det, st) == (other, [])
    assert AS.MEMBER_TREND_GATED_IDS == frozenset({"flat_base", "bc:flat-base", "uct_flat_top_breakout"})


@pytest.fixture
def member_route(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    monkeypatch.setattr(AS, "structures_for", lambda sym: [_row("bc:flat-base")])
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)
    monkeypatch.setattr(AS, "member_rows", lambda rows: list(rows or []))


def test_the_member_route_applies_the_gate(member_route, monkeypatch):
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: UP)
    assert [r["pattern_id"] for r in _get(PAID_MEMBER).json().get("structures", [])] == ["bc:flat-base"]
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: DOWN)
    assert "structures" not in _get(PAID_MEMBER).json()
