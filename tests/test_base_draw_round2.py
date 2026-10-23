"""Base drawing ROUND 2 (lab base_draw_v2): the pivot is the TOP of the drawn base, and a deep pullback straight
after a parabolic run is not a base. Synthetic bars only (public repo).

Round 1 put the pivot on the top CLUSTER of body tops, so a base whose highest body stands alone -- a spike bar
at the region's start, one high day inside it -- was drawn with the pivot UNDER that body, in the bar. Blind
judges marked exactly that (lab base_metrics: "the pivot sits mid-body, well under the real left-side top").
Every test here shows round 1 doing the wrong thing on the same bars, so none can pass by both rounds agreeing.
"""
from __future__ import annotations

import datetime
import importlib.util
import math
import os

import pytest

from api.services.pattern_engine import base_draw as BD

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_round2", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)


def _bars(closes, opens=None, hi=None, lo=None):
    out, d = [], datetime.date(2023, 1, 2)
    for k, c in enumerate(closes):
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        o = opens[k] if opens and opens[k] is not None else (c * 0.995 if k % 2 else c * 1.004)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4),
                    "h": round(max(o, c) * (hi[k] if hi else 1.006), 4),
                    "l": round(min(o, c) * (lo[k] if lo else 0.994), 4), "c": round(c, 4), "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


def _rounded(top, n, depth):
    return [top * (1 - depth * math.sin(math.pi * j / n)) for j in range(n)]


def _spike_base(right=None, depth=0.12, n=40):
    """300 sessions of advance, then a base that STARTS on a spike bar (opens 6% over the top, closes back at
    it -- a gap-up reversal), rounds out `depth` deep and either sits back at the old top (right=None) or
    climbs back to `right` x the old top (the spike's level)."""
    adv = [50 * math.exp(0.003 * k) for k in range(300)]
    top = adv[-1]
    cl = adv + [top * 0.99] + _rounded(top, n, depth)[1:]
    if right is None:
        cl += [top * 0.995]
    else:
        cl += [top * (1 + (right - 1) * (k + 1) / 6) for k in range(6)] + [top * right] * 4 + [top * right * 0.998]
    opens = [None] * len(cl)
    opens[300] = top * 1.06
    return _bars(cl, opens)


def _parabolic(run=4.0, n=20, depth=0.40):
    """260 quiet sessions, a `run`-x advance in 40 sessions, then a volatile pullback `depth` deep over `n`
    sessions that has come back to just under the top."""
    flat, up = 260, 40
    cl = [10 * (1 + 0.01 * math.sin(k / 3)) for k in range(flat)]
    cl += [10 * run ** ((k + 1) / up) for k in range(up)]
    top = cl[-1]
    cl += _rounded(top, n, depth)[1:] + [top * (1 - 0.02 * (3 - k) / 3) for k in range(3)]
    hi = [1.045 if k >= flat else 1.006 for k in range(len(cl))]
    lo = [0.955 if k >= flat else 0.994 for k in range(len(cl))]
    return _bars(cl, None, hi, lo)


def _region(b, d):
    s = [x["t"] for x in b].index(d["start_t"])
    return b[s:len(b) - 1]


def _top_body(b, d):
    return max(BD._bt(x) for x in _region(b, d))


def _draw(b, rnd):
    return BD.base_drawing(b, len(b) - 1, draw_round=rnd)


# -- the spike at the region's start ------------------------------------------------------------------------------

def test_spike_start_round_one_draws_the_pivot_inside_the_spike_body():
    b = _spike_base()
    d1 = _draw(b, 1)
    assert d1 is not None and d1["start_t"] == b[300]["t"]          # the region starts ON the spike
    assert d1["pivot"] < _top_body(b, d1) - 2 * d1["atr"]             # ...and its pivot sits in the spike's body


def test_spike_start_round_two_never_draws_a_pivot_under_a_body_in_its_region():
    """The right side never came back up to the spike's level: under the true top there is one touch, so
    there is no base to draw -- withheld rather than drawn with a false pivot."""
    assert _draw(_spike_base(), 2) is None


def test_spike_start_round_two_moves_the_pivot_up_to_the_spike_when_the_base_reaches_it():
    b = _spike_base(right=1.05, depth=0.10)
    d1, d2 = _draw(b, 1), _draw(b, 2)
    assert d1 is not None and d2 is not None
    assert d1["start_t"] == d2["start_t"] == b[300]["t"]              # same region, starting on the spike
    assert d1["pivot"] < _top_body(b, d1)                             # round 1: under the spike's body
    assert d2["pivot"] == _top_body(b, d2) == BD._bt(b[300])          # round 2: on the spike's body top


# -- every body in the region sits at or under the pivot -----------------------------------------------------------

def test_on_the_whole_sweep_the_round_two_pivot_is_the_regions_highest_body():
    r2 = under1 = 0
    for s in range(SW.SERIES):
        bars = SW.series(s)
        for i in range(220, len(bars), 2):
            b = bars[:i + 1]
            d2, d1 = _draw(b, 2), _draw(b, 1)
            if d2 is not None:
                r2 += 1
                assert d2["pivot"] == _top_body(b, d2), (s, i)
            if d1 is not None:
                under1 += d1["pivot"] < _top_body(b, d1)
    assert r2 >= 50 and under1 >= 5, (r2, under1)                       # round 1 really did leave bodies above


# -- a deep pullback straight after a parabolic run is not a base -------------------------------------------------

def test_a_deep_short_pullback_after_a_parabolic_run_is_withheld():
    b = _parabolic()
    assert _draw(b, 1) is not None                                    # round 1 drew it as a base
    assert _draw(b, 2) is None


@pytest.mark.parametrize("kw,why", [
    ({"run": 2.0}, "a 2x advance is not parabolic"),
    ({"depth": 0.25}, "a 25%-deep pullback is shallow enough to be a base after a big run"),
    ({"n": 40}, "a deep base that has taken 8+ weeks has digested the run"),
])
def test_the_parabolic_gate_needs_all_three_conditions(kw, why):
    assert _draw(_parabolic(**kw), 2) is not None, why


def test_the_parabolic_constants_are_the_preregistered_ones():
    assert (BD.RUN_BARS, BD.PARABOLIC_RUN, BD.PARABOLIC_DEPTH, BD.PARABOLIC_MAX_LEN) == (60, 3.0, 0.30, 35)


# -- a normal base is unchanged ---------------------------------------------------------------------------------

def _plain(base_len=40, depth=0.12, last=-0.004):
    """The member-drawing tests' rounded base after an advance (tests/test_base_draw_member_drawing._synth)."""
    cl, op = [], []
    for k in range(300):
        c = 50 * math.exp(0.003 * k) * (1 + 0.01 * math.sin(k / 3))
        cl.append(c)
        op.append(c * 0.995)
    top = cl[-1]
    for j in range(base_len + 1):
        c = top * (1 - depth * math.sin(math.pi * j / base_len)) if j < base_len else top * (1 + last)
        cl.append(c)
        op.append(c if j == 0 else c * (1.004 if j % 2 else 0.996))
    return _bars(cl, op)


@pytest.mark.parametrize("kw", [{}, {"base_len": 60}, {"depth": 0.16}, {"last": 0.01}])
def test_a_normal_base_draws_identically_in_both_rounds(kw):
    b = _plain(**kw)
    d1 = _draw(b, 1)
    assert d1 is not None and _draw(b, 2) == d1


def test_an_unknown_round_draws_nothing():
    b = _plain()
    for rnd in (0, 3, 5, "2", "4", True, 2.0, 4.0):
        assert BD.base_drawing(b, len(b) - 1, draw_round=rnd) is None
    assert BD.base_drawing(b, len(b) - 1) == _draw(b, BD.BASE_DRAW_ROUND)
