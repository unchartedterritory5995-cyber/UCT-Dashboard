"""Base drawing ROUND 3: a SHELF UNDER A HIGHER PEAK. Synthetic bars only (public repo).

Rounds 1 and 2 never draw a base with a high more than PEAK_ATR ATR above its pivot in the PEAK_BARS bars
before its lip, nor one whose lip is reached from above. Round 3 draws round 2's drawing wherever round 2
draws one, and only where round 2 draws nothing, a shelf under a higher peak (base_draw._evaluate, shelf
pass). Every test that shows round 3 drawing also shows round 2 NOT drawing the same bars, so none can pass
by both rounds agreeing; every gate test shows the same fixture drawing with the gate's input moved back.
"""
from __future__ import annotations

import importlib.util
import math
import os

import pytest

from api.services.pattern_engine import base_draw as BD

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_round3", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)


def _shelf(shelf_len=40, peak=112.0, top=100.0, low=92.0, last_close=99.4, spike=True):
    """220 sessions of steady advance to ~100, a climb to `peak` and straight back down onto a shelf whose
    body tops reach `top` every 12 sessions and pull back to `low` between, `shelf_len` sessions long, then a
    last session closing at `last_close`. The peak's high is about top + 0.95 x (peak - top) + 0.8."""
    bars, t, p = [], 20240101, 60.0

    def add(o, c, pad):
        nonlocal t
        bars.append({"t": t, "o": o, "h": max(o, c) + pad, "l": min(o, c) - pad, "c": c, "v": 1e6})
        t += 1

    for _ in range(220):
        c = p + 0.18
        add(p, c, 0.6)
        p = c
    if spike:
        for f in (0.3, 0.7, 0.95, 0.8, 0.4, 0.1):
            c = top + (peak - top) * f
            add(p, c, 0.8)
            p = c
    for k in range(shelf_len):
        c = low + (top - low) * (0.5 + 0.5 * math.cos(2 * math.pi * (k % 12) / 12.0))
        add(p, c, 0.5)
        p = c
    add(p, last_close, 0.4)
    return bars


def _draw(b, rnd=None):
    return BD.base_drawing(b, len(b) - 1, draw_round=rnd)


def test_round_three_draws_the_shelf_round_two_withholds():
    b = _shelf()
    assert _draw(b, 1) is None and _draw(b, 2) is None
    d = _draw(b, 3)
    assert d is not None and d == _draw(b)
    # the pivot is the shelf's own top, not the peak; the region starts after the peak
    assert d["pivot"] == pytest.approx(100.0)
    peak_i = max(range(len(b)), key=lambda k: b[k]["h"])
    start_i = [x["t"] for x in b].index(d["start_t"])
    assert start_i > peak_i and b[peak_i]["h"] > d["pivot"] + BD.PEAK_ATR * d["atr"]
    assert d["low"] == pytest.approx(min(x["l"] for x in b[start_i:-1]))
    assert set(d) == {"pivot", "start_t", "end_t", "low", "low_t", "bars", "atr", "label", "low_label"}


def test_the_higher_peak_is_required():
    """A lip reached from above WITHOUT a peak more than PEAK_ATR ATR over the shelf is not a shelf: round 3
    withholds it like round 2 (the peak's high here: ~104.6 vs ~105.0 needed; 105 draws)."""
    assert _draw(_shelf(peak=105.0), 3) is not None
    b = _shelf(peak=104.0)
    assert _draw(b, 2) is None and _draw(b, 3) is None


def test_the_shelf_length_window_uses_the_constants():
    assert (BD.SHELF_MIN_LEN, BD.SHELF_MAX_LEN) == (25, 100)
    assert _draw(_shelf(shelf_len=101), 3)["bars"] == 100
    b = _shelf(shelf_len=102)                      # 101 sessions: longer than SHELF_MAX_LEN
    assert _draw(b, 2) is None and _draw(b, 3) is None


def test_the_shelf_length_window_is_inclusive_at_both_ends(monkeypatch):
    b = _shelf()
    n = _draw(b, 3)["bars"]
    monkeypatch.setattr(BD, "SHELF_MIN_LEN", n)
    assert _draw(b, 3) is not None
    monkeypatch.setattr(BD, "SHELF_MIN_LEN", n + 1)
    assert _draw(b, 3) is None
    monkeypatch.setattr(BD, "SHELF_MIN_LEN", 25)
    monkeypatch.setattr(BD, "SHELF_MAX_LEN", n)
    assert _draw(b, 3) is not None
    monkeypatch.setattr(BD, "SHELF_MAX_LEN", n - 1)
    assert _draw(b, 3) is None


def test_every_other_round_two_gate_still_applies_to_a_shelf():
    assert _draw(_shelf(), 3) is not None
    assert _draw(_shelf(last_close=95.0), 3) is None       # the close not near the shelf top
    assert _draw(_shelf(last_close=104.5), 3) is None      # extended past it
    assert _draw(_shelf(low=99.0), 3) is None              # no pullback under the top: not a base


def test_round_three_is_round_two_wherever_round_two_draws():
    """On the 24-series synthetic sweep: identical wherever round 2 draws; round 3 adds drawings only where
    round 2 has none (the sweep must contain both, or this proves nothing)."""
    both = only3 = 0
    for s in range(SW.SERIES):
        bars = SW.series(s)
        for i in range(220, len(bars), 2):
            d2 = BD.base_drawing(bars[:i + 1], i, draw_round=2)
            d3 = BD.base_drawing(bars[:i + 1], i, draw_round=3)
            if d2 is not None:
                assert d3 == d2, (s, i)
                both += 1
            else:
                only3 += d3 is not None
    assert both >= 50 and only3 >= 5, (both, only3)


def _base_then_shelf():
    """A base whose body tops reach 100 for 40 sessions, then ONE bar whose WICK reaches 110 (its body stays
    under the base top, so round 2's base is intact), then a lower shelf topping at 97 for 30 sessions, the
    close at 96.9: round 2 draws the 100 base, and a shelf candidate at 97 -- NEARER the close -- also exists."""
    bars, t, p = [], 20240101, 55.0

    def add(o, c, pad, h=None):
        nonlocal t
        bars.append({"t": t, "o": o, "h": h if h else max(o, c) + pad, "l": min(o, c) - pad, "c": c, "v": 1e6})
        t += 1

    for _ in range(220):
        add(p, p + 0.2, 0.6)
        p += 0.2
    for top, low, n in ((100.0, 92.0, 40), (None, None, 0), (97.0, 90.0, 30)):
        if top is None:
            add(p, 98.0, 0.5, h=110.0)
            p = 98.0
            continue
        for k in range(n):
            c = low + (top - low) * (0.5 + 0.5 * math.cos(2 * math.pi * (k % 12) / 12.0))
            add(p, c, 0.5)
            p = c
    add(p, 96.9, 0.4)
    return bars


def test_a_round_two_drawing_wins_over_a_nearer_shelf():
    """Round 3 runs the shelf pass only when round 2 draws nothing: a shelf candidate never replaces a
    round-2 drawing, even one whose pivot is farther from the close."""
    b = _base_then_shelf()
    i = len(b) - 1
    d2 = _draw(b, 2)
    shelf = BD._pick(b, i, BD._atr(b, i), BD._candidates(b, i), 3, True)
    # the fixture really has both, and the shelf really is nearer the close
    assert d2 is not None and d2["pivot"] == pytest.approx(100.0)
    assert shelf is not None and shelf["pivot"] == pytest.approx(97.0)
    assert abs(shelf["close_minus_pivot_atr"]) < abs(b[i]["c"] - d2["pivot"]) / d2["atr"]
    assert _draw(b, 3) == d2


def test_rounds_one_and_two_never_draw_a_shelf():
    """The shelf pass is round 3's only: rounds 1 and 2 still reject both the peak and the lip from above."""
    for kw in ({}, {"shelf_len": 60}, {"peak": 106.0}, {"shelf_len": 101}):
        b = _shelf(**kw)
        assert _draw(b, 3) is not None and _draw(b, 1) is None and _draw(b, 2) is None, kw
