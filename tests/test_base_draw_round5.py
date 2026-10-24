"""Round 5 of the member base drawing (bc:base): round 4 UNCHANGED, minus the drawings the floor refuses.

base_draw.floor_refuses is a REMOVAL-ONLY guard (the depth-floor lab round, pre-registered): a drawn region is not a
base when it is too shallow (under base_metrics.MIN_LABEL_DEPTH_PCT, the label's own floor) or a dead range (its
median true range a small share of the stock's own normal, and no correction worth a normal daily range or two).

Rails, all on synthetic bars (public repo):
  * PORT PARITY -- the lab rule (its feature code and its rule, embedded below VERBATIM) and floor_refuses give
    the same answer on a dense grid of drawings over seeded series (both rules, both sides of every threshold,
    and the unreadable edges);
  * a price held at a fixed level after an open gap (the shape a pending cash deal draws) is drawn by round 2,
    and so by round 4, and is REFUSED by round 5 -- on the drawing and on the member route;
  * approved-like bases (a real correction at the stock's normal volatility) are KEPT, byte for byte;
  * round 5 == round 4 minus the refusals at every session of the sweep, and reads no later bar.
"""
from __future__ import annotations

import datetime
import importlib.util
import json
import math
import os
import random
import statistics

import pytest

import api.routers.patterns as patterns_router  # noqa: F401 -- registers every detector
from api.services import auto_structures, base_metrics
from api.services.pattern_engine import base_draw as BD
from tests.authclients import PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_round5", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)


# ------------------------------------------------------------------ the lab rule, VERBATIM (frozen 2026-10-23)
# Feature code and rule exactly as the lab ran them (only renamed with a _lab_ prefix and the module constants
# inlined as the lab's frozen values). Do not "fix" anything here: it is the reference the port must match.
_LAB_MIN_DEPTH = 0.03
_LAB_DEAD_VOL_RATIO = 0.30
_LAB_DEAD_DEPTH_NORM = 1.5


def _lab_idx_of(b, t):
    for j in range(len(b) - 1, -1, -1):
        if b[j]['t'] == t:
            return j
    return None


def _lab_trp(b, j):
    """True range of bar j as a fraction of the prior close."""
    pc = b[j - 1]['c']
    return (max(b[j]['h'], pc) - min(b[j]['l'], pc)) / pc if pc > 0 else None


def _lab_feats(b, k, start_t, pivot, low):
    """The lab's point-in-time features of a drawn base (the ones its rule reads)."""
    lip = _lab_idx_of(b, start_t)
    if lip is None or lip >= k:
        return None
    n = k - lip
    f = {'len': n, 'depth': (pivot - low) / pivot if pivot > 0 else None}
    base_tr = [_lab_trp(b, j) for j in range(max(1, lip + 1), k + 1)]
    base_tr = [x for x in base_tr if x is not None]
    f['base_atrp'] = statistics.median(base_tr) if base_tr else None
    n0 = max(1, lip - 252)
    norm_tr = [_lab_trp(b, j) for j in range(n0, lip)]
    norm_tr = [x for x in norm_tr if x is not None]
    f['norm_n'] = len(norm_tr)
    f['norm_atrp'] = statistics.median(norm_tr) if len(norm_tr) >= 60 else None
    f['vol_ratio'] = (f['base_atrp'] / f['norm_atrp']) if f['base_atrp'] and f['norm_atrp'] else None
    f['depth_norm'] = (f['depth'] / f['norm_atrp']) if f['depth'] is not None and f['norm_atrp'] else None
    return f


def _lab_reasons(f):
    """The floor rules a feature dict trips ([] = keep the drawing)."""
    out = []
    if f is None:
        return out
    if f['depth'] is None or f['depth'] < _LAB_MIN_DEPTH:
        out.append('SHALLOW')
    if (f['vol_ratio'] is not None and f['depth_norm'] is not None
            and f['vol_ratio'] < _LAB_DEAD_VOL_RATIO and f['depth_norm'] < _LAB_DEAD_DEPTH_NORM):
        out.append('DEAD')
    return out


def _lab_refuses(b, k, d):
    return bool(_lab_reasons(_lab_feats(b, k, d['start_t'], d['pivot'], d['low'])))


# ------------------------------------------------------------------ synthetic bars
def _held(n_up=300, gap=0.18, flat_len=24, band=0.005, vol=0.03, wig=0.0012, up=0.0015, seed=None):
    """An advance at a normal daily range (`vol`), an open gap of `gap`, then `flat_len` sessions held in a
    `band`-deep range at a daily range of `wig`: a price fixed at a level, the shape a pending cash deal draws."""
    rnd = random.Random(seed) if seed is not None else None
    out, d = [], datetime.date(2024, 1, 2)
    while len(out) < n_up + flat_len + 1:
        if d.weekday() >= 5:
            d += datetime.timedelta(days=1)
            continue
        k = len(out)
        jit = 1 + (rnd.uniform(-0.3, 0.3) if rnd else 0.0)
        if k < n_up:
            c = 40 * math.exp(up * k) * (1 + 0.04 * math.sin(k / 5))
            v = vol * jit
            o = c * (1 - v / 3 if k % 2 else 1 + v / 3)
            h, lo = max(o, c) * (1 + v / 3), min(o, c) * (1 - v / 3)
        else:
            j = k - n_up
            top = out[n_up - 1]["c"] * (1 + gap)
            c = top * (1 - band * (0.5 - 0.5 * math.cos(2 * math.pi * j / 12)))
            w = wig * jit
            o = c * (1 + w / 4 if j % 2 else 1 - w / 4)
            h, lo = max(o, c) * (1 + w / 4), min(o, c) * (1 - w / 4)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(h, 4), "l": round(lo, 4),
                    "c": round(c, 4), "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


def _synth(base_len=40, depth=0.12, last=-0.004, up=0.003):
    """300 sessions of advance, then a rounded base `depth` deep over `base_len` sessions at the stock's
    normal daily range, then one session `last` away from the base's starting close (an approved-like base)."""
    out, d = [], datetime.date(2024, 1, 2)
    n_up = 300
    while len(out) < n_up + base_len + 1:
        if d.weekday() >= 5:
            d += datetime.timedelta(days=1)
            continue
        k = len(out)
        if k < n_up:
            c = 50 * math.exp(up * k) * (1 + 0.01 * math.sin(k / 3))
            o = c * 0.995
        else:
            j, top = k - n_up, out[n_up - 1]["c"]
            c = top * (1 - depth * math.sin(math.pi * j / base_len)) if j < base_len else top * (1 + last)
            o = c if j == 0 else c * (1.004 if j % 2 else 0.996)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(max(o, c) * 1.006, 4),
                    "l": round(min(o, c) * 0.994, 4), "c": round(c, 4), "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


#: The held-price shapes: (kwargs, the lab reasons expected on round 4's drawing of the last session).
HELD = [
    ({}, ["SHALLOW", "DEAD"]),                                     # 0.6% deep, range at 4% of normal
    ({"band": 0.004}, ["SHALLOW", "DEAD"]),
    ({"band": 0.04, "wig": 0.004, "vol": 0.04}, ["DEAD"]),         # over 3% deep, but a dead range
]
#: Approved-like bases: a real correction at a normal daily range.
APPROVED = [{}, {"depth": 0.05}, {"depth": 0.04}, {"depth": 0.08, "base_len": 30},
            {"depth": 0.15, "base_len": 60}, {"depth": 0.15, "last": 0.004}]


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    """Synthetic dates are long past: no forming session."""
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


# ------------------------------------------------------------------ the constants
def test_the_shallow_floor_is_the_labels_own_floor_read_never_restated(monkeypatch):
    import inspect
    assert BD._floor_min_depth() == base_metrics.MIN_LABEL_DEPTH_PCT / 100.0 == _LAB_MIN_DEPTH
    src = inspect.getsource(BD)
    assert "0.03" not in src and "MIN_LABEL_DEPTH_PCT" in src
    # moving the label's floor moves the drawing's (one authority)
    b = _synth(depth=0.05)
    d = BD.base_drawing(b, len(b) - 1, draw_round=4)
    assert d is not None and not BD.floor_refuses(b, len(b) - 1, d)
    monkeypatch.setattr(base_metrics, "MIN_LABEL_DEPTH_PCT", 60.0)
    assert BD.floor_refuses(b, len(b) - 1, d)
    assert BD.base_drawing(b, len(b) - 1) is None


def test_the_dead_range_constants_are_the_labs_frozen_values():
    assert (BD.FLOOR_DEAD_VOL_RATIO, BD.FLOOR_DEAD_DEPTH_NORM) == (_LAB_DEAD_VOL_RATIO, _LAB_DEAD_DEPTH_NORM)
    assert (BD.FLOOR_NORM_BARS, BD.FLOOR_NORM_MIN) == (252, 60)
    assert BD.BASE_DRAW_ROUND == 5 and BD.DRAW_ROUNDS == (1, 2, 4, 5)


# ------------------------------------------------------------------ port parity
def _grid():
    """(bars, i, drawing) over the held and approved shapes and seeded variants: every drawing round 4 makes
    there, plus a dense family of drawings on the same region with the low moved (depth 0.1% .. 8%) and the
    start moved (the norm window long, short and under FLOOR_NORM_MIN sessions)."""
    out = []
    series = [_held(**kw) for kw, _ in HELD] + [_synth(**kw) for kw in APPROVED]
    for s in range(12):
        r = random.Random(1000 + s)
        series.append(_held(gap=r.uniform(0.05, 0.3), band=r.uniform(0.002, 0.06), vol=r.uniform(0.015, 0.06),
                            wig=r.uniform(0.0005, 0.03), flat_len=r.randint(16, 40), seed=s))
    for b in series:
        i = len(b) - 1
        d4 = BD.base_drawing(b, i, draw_round=4)
        if d4 is not None:
            out.append((b, i, d4))
        piv = max(max(x["o"], x["c"]) for x in b[i - 30:i])
        for start in (i - 30, i - 20, i - 16, 40, 60, 61, 62, 80, 290):   # 60/61/62: FLOOR_NORM_MIN at the edge
            for dep in [x / 2000.0 for x in range(2, 161, 3)]:
                out.append((b, i, {"start_t": b[start]["t"], "pivot": piv, "low": piv * (1 - dep)}))
    return out


def test_the_port_matches_the_lab_rule_on_every_drawing_of_the_grid():
    n = refused = shallow = dead_only = 0
    for b, i, d in _grid():
        lab = _lab_refuses(b, i, d)
        assert BD.floor_refuses(b, i, d) is lab, (i, d)
        why = _lab_reasons(_lab_feats(b, i, d["start_t"], d["pivot"], d["low"]))
        n += 1
        refused += lab
        shallow += "SHALLOW" in why
        dead_only += why == ["DEAD"]
    # not vacuous: both rules fire, alone, and most of the grid is kept
    assert n > 5000 and shallow > 500 and dead_only > 200 and n - refused > 2000, (n, refused, shallow, dead_only)


def test_the_port_matches_the_lab_rule_on_the_unreadable_edges():
    b = _held()
    i = len(b) - 1
    piv = b[i]["c"]
    cases = [
        {"start_t": b[i]["t"], "pivot": piv, "low": piv * 0.999},          # the region starts AT bar i
        {"start_t": 1, "pivot": piv, "low": piv * 0.999},                   # a start that is not a bar
        {"start_t": b[30]["t"], "pivot": piv, "low": piv * 0.999},          # under FLOOR_NORM_MIN sessions before
        {"start_t": b[30]["t"], "pivot": piv, "low": piv * 0.9},            # ... and deep: kept
        {"start_t": b[300]["t"], "pivot": 0.0, "low": -1.0},                # no positive pivot
        {"start_t": b[300]["t"], "pivot": -2.0, "low": -3.0},
    ]
    for d in cases:
        assert BD.floor_refuses(b, i, d) is _lab_refuses(b, i, d), d
    # a region of bars that never move (zero median range) reads as unreadable in both
    flat = [dict(x) for x in b]
    for x in flat[301:]:
        x.update(o=flat[300]["c"], h=flat[300]["c"], l=flat[300]["c"], c=flat[300]["c"])
    d = {"start_t": flat[301]["t"], "pivot": flat[300]["c"] * 1.035, "low": flat[300]["c"]}
    assert BD.floor_refuses(flat, i, d) is _lab_refuses(flat, i, d) is False
    # ... while the same drawing over bars that barely move IS a dead range (the zero median is the edge)
    near = [dict(x) for x in flat]
    for x in near[301:]:
        x.update(h=x["c"] * 1.0005)
    assert BD.floor_refuses(near, i, d) is _lab_refuses(near, i, d) is True


def _crafted(norm_tr, inside_tr, lip_tr, n_norm=120):
    """A flat series: `n_norm` sessions of true range `norm_tr` (a fraction of the close), a region-start bar
    of range `lip_tr`, then one bar per entry of `inside_tr`. Every close is 100."""
    out, d = [], datetime.date(2024, 1, 2)
    for tr in [norm_tr] * n_norm + [lip_tr] + list(inside_tr):
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": 100.0, "h": 100.0 + 100 * tr / 2,
                    "l": 100.0 - 100 * tr / 2, "c": 100.0, "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


def test_the_dead_test_needs_sixty_readable_sessions_before_the_region():
    """FLOOR_NORM_MIN at its edge: 59 readable ranges before the region (bar 0 has no prior close) and the DEAD
    test is not applied; 60 and it is."""
    for n_norm, want in ((60, False), (61, True)):
        b = _crafted(0.04, [0.004] * 20, 0.004, n_norm=n_norm)
        i = len(b) - 1
        d = {"start_t": b[n_norm]["t"], "pivot": 100.0 * 1.035, "low": 100.0}
        assert BD.floor_refuses(b, i, d) is _lab_refuses(b, i, d) is want, n_norm


def test_the_region_start_bar_is_not_inside_the_region():
    """The lab reads the region's ranges from the bar AFTER its start: a wide start bar (the gap) must not lift
    the region's median. Here it decides the answer: without it the median is a quarter of normal (dead), with
    it 40% (not)."""
    b = _crafted(0.04, [0.004, 0.004, 0.016, 0.016], 0.03)
    i = len(b) - 1
    d = {"start_t": b[120]["t"], "pivot": 100.0 * 1.035, "low": 100.0}   # 3.4% deep, 0.85 normal ranges
    assert BD.floor_refuses(b, i, d) is _lab_refuses(b, i, d) is True


# ------------------------------------------------------------------ the held price is refused
@pytest.mark.parametrize("kw,why", HELD)
def test_a_held_price_after_a_gap_is_drawn_by_round_four_and_refused_by_round_five(kw, why):
    b = _held(**kw)
    i = len(b) - 1
    d2 = BD.base_drawing(b, i, draw_round=2)
    d4 = BD.base_drawing(b, i, draw_round=4)
    assert d2 is not None and d4 == d2                                 # the round-2 path draws it
    assert _lab_reasons(_lab_feats(b, i, d4["start_t"], d4["pivot"], d4["low"])) == why
    assert BD.floor_refuses(b, i, d4)
    assert BD.base_drawing(b, i, draw_round=5) is None
    assert BD.base_drawing(b, i) is None                               # the current round is 5
    assert auto_structures.base_draw_row("SYN", b) is None             # no row: nobody is drawn it


@pytest.mark.parametrize("kw", APPROVED)
def test_an_approved_like_base_is_kept_byte_for_byte(kw):
    b = _synth(**kw)
    i = len(b) - 1
    d4 = BD.base_drawing(b, i, draw_round=4)
    assert d4 is not None and not BD.floor_refuses(b, i, d4)
    assert BD.base_drawing(b, i) == d4
    row = auto_structures.base_draw_row("SYN", b)
    assert auto_structures.member_rows([row]) == [auto_structures._base_row("SYN", d4, 5)]


#: Every member drawing id that draws a base: bc:base (floor in its own round) and the rest (the member path).
BASE_IDS = auto_structures.MEMBER_FLOOR_IDS | {"bc:base", auto_structures.SHELF_PIVOT_ID}


def _route_bars(monkeypatch, b):
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(b)))
    monkeypatch.setattr(auto_structures, "deal_hold", lambda sym, **k: None)    # the floor alone, no deal list
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    auto_structures._CACHE.clear()


def _member_structures(monkeypatch, b):
    """The member route (confirmed_only=false, include_structures=true, a paid member) on bars `b`."""
    _route_bars(monkeypatch, b)
    try:
        body = _get(PAID_MEMBER).json()
    finally:
        auto_structures._CACHE.clear()
    return body.get("structures") or []


def _floor_off(monkeypatch):
    """The control: the same route with the floor refusing nothing (round 5 == round 4, the member path open)."""
    monkeypatch.setattr(BD, "floor_refuses", lambda bars, i, d: False)


@pytest.mark.parametrize("kw,why", HELD)
def test_on_the_member_route_the_held_price_draws_no_base_by_any_door(monkeypatch, kw, why):
    """No base drawing of ANY member id on the held price. Control: with the floor refusing nothing the same
    route serves one (so the route does reach a drawing here, through bc:base or a base box)."""
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    b = _held(**kw)
    assert [s["pattern_id"] for s in _member_structures(monkeypatch, b) if s["pattern_id"] in BASE_IDS] == []
    _floor_off(monkeypatch)
    assert [s["pattern_id"] for s in _member_structures(monkeypatch, b) if s["pattern_id"] in BASE_IDS]


def test_a_rollback_to_round_four_serves_round_two_and_the_box_floor_still_holds(monkeypatch):
    """At literal 4 (a rollback, the round-5 row carrying round 4's drawing) the held price's round-2 drawing is
    what round 4 serves -- and the member path still draws no base box over it."""
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    b = _held()
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_ROUND", 4)
    got = [s for s in _member_structures(monkeypatch, b) if s["pattern_id"] in BASE_IDS]
    assert [s["pattern_id"] for s in got] == ["bc:base"]
    assert got[0]["geometry"]["extras"]["draw_base"] == BD.base_drawing(b, len(b) - 1, draw_round=2)


@pytest.mark.parametrize("kw", APPROVED)
def test_on_the_member_route_an_approved_like_base_is_served_unchanged(monkeypatch, kw):
    """An approved-like base: the route serves a base drawing, byte-identical to the route with the floor off."""
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    b = _synth(**kw)
    got = _member_structures(monkeypatch, b)
    assert [s for s in got if s["pattern_id"] in BASE_IDS]
    _floor_off(monkeypatch)
    want = _member_structures(monkeypatch, b)
    for s in want:                                        # the round stamp is the only byte the round moves
        s["geometry"]["extras"].pop("draw_round", None)
    for s in got:
        s["geometry"]["extras"].pop("draw_round", None)
    assert json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True)


def test_a_base_state_drawn_over_the_held_price_is_refused(monkeypatch):
    """Where round 5 refuses, base_draw_row asks the base STATES; a state drawn over the same held range goes
    through the same floor. Control: with the floor off, the state row is built."""
    b = _held()
    i = len(b) - 1
    held = dict(BD.base_drawing(b, i, draw_round=4), state="forming", state_round=BD.STATE_ROUND)
    monkeypatch.setattr(BD, "state_drawing", lambda bars, j: dict(held))
    assert BD.base_drawing(b, i) is None
    assert auto_structures.base_draw_row("SYN", b) is None
    _floor_off(monkeypatch)
    monkeypatch.setattr(BD, "base_drawing", lambda bars, j, draw_round=None: None)
    row = auto_structures.base_draw_row("SYN", b)
    assert row is not None and row["geometry"]["extras"]["draw_base"]["state"] == "forming"


def test_on_the_member_route_a_shelf_line_over_the_held_price_is_refused(monkeypatch):
    """The shelf pivot (added after the other structures) goes through the member floor too."""
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    b = _held()
    i = len(b) - 1
    shelf = {"id": "x", "sym": "ZZZ", "tf": "D", "pattern_id": auto_structures.SHELF_PIVOT_ID,
             "start_t": b[302]["t"], "end_t": b[i]["t"], "display_tier": "trusted",
             "geometry": {"extras": {"draw_shelf": {"price": max(x["h"] for x in b[302:i])},
                                     "draw_round": auto_structures.MEMBER_SHELF_PIVOT_ROUND}}}
    monkeypatch.setattr(auto_structures, "shelf_pivot_row", lambda sym, **k: json.loads(json.dumps(shelf)))
    monkeypatch.setattr(auto_structures, "member_rows", lambda rows: list(rows or []))
    ids = [s["pattern_id"] for s in _member_structures(monkeypatch, b)]
    assert auto_structures.SHELF_PIVOT_ID not in ids
    _floor_off(monkeypatch)
    assert auto_structures.SHELF_PIVOT_ID in [s["pattern_id"] for s in _member_structures(monkeypatch, b)]


def test_the_member_floor_reads_the_box_region_and_fails_open(monkeypatch):
    b = _held()
    box = [r for r in auto_structures.member_rows(auto_structures._structure_rows("SYN", b))
           if r["pattern_id"] == "bc:flat-base"]
    assert box, "the held price draws a flat-base box (the door this guards)"
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(b)))
    assert auto_structures.member_base_floor("SYN", [], box) == ([], [])
    # removal only: other rows are untouched, and a row with no readable region is kept
    other = {"pattern_id": "bull_flag", "geometry": {"extras": {}}}
    blind = json.loads(json.dumps(box[0]))
    blind["start_t"] = 1
    assert auto_structures.member_base_floor("SYN", [other], [blind]) == ([other], [blind])
    # the region's low runs THROUGH the as-of session: a box broken lower today is a real correction, kept
    drop = json.loads(json.dumps(b))
    last = drop[-1]
    drop.append({"t": last["t"] + 1, "o": last["c"], "h": last["c"], "l": last["c"] * 0.94, "c": last["c"] * 0.95,
                 "v": 1e6})
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(drop)))
    assert auto_structures.member_base_floor("SYN", [], box) == ([], box)
    # unreadable bars: nothing removed
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: (_ for _ in ()).throw(OSError("x")))
    assert auto_structures.member_base_floor("SYN", [], box) == ([], box)
    # no member base row: the bars are never read
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: pytest.fail("read bars"))
    assert auto_structures.member_base_floor("SYN", [other], []) == ([other], [])


def test_the_member_floor_ids_cover_every_member_base_id_but_bc_base():
    """Every member-set id whose row draws a base region is guarded on the member path, except bc:base, whose
    drawing round applies the floor itself (one guard, asked once)."""
    from api.services.pattern_engine.detectors import registry
    ids = auto_structures._member_floor_ids()
    assert "bc:base" not in ids and auto_structures.SHELF_PIVOT_ID in ids
    # The setup-drawing layer (setup_draw / setup_draw_r2: auto_structures.SETUP_DRAW_IDS, the one authority)
    # is served as its own `setup_draws` key and never passes through member_base_floor, so its ids are not
    # base ids. Derived, never listed, so a newly released setup id cannot drift this rail red.
    setup_ids = set(auto_structures.SETUP_DRAW_IDS)
    assert not (ids & setup_ids)
    not_bases = {"bull_flag", "uct_pullback_ma_v5", "draw:inside-day"} | (setup_ids & set(registry.DISPLAY_MEMBER_SET))
    assert ids | {"bc:base"} | not_bases == set(registry.DISPLAY_MEMBER_SET)


# ------------------------------------------------------------------ round 5 == round 4 minus refusals, no lookahead
def _wild(b, n=30):
    c = b[-1]["c"]
    return b + [{"t": b[-1]["t"] + 1 + j, "o": c * 1.3, "h": c * 1.6, "l": c * 0.5, "c": c * 1.5, "v": 1e9}
                for j in range(n)]


def _sweep():
    for s in range(SW.SERIES):
        yield SW.series(s), 220, 2
    for kw, _ in HELD:
        yield _held(**kw, flat_len=40), 300, 1
    for kw in APPROVED[:3]:
        yield _synth(**kw), 300, 1


def test_round_five_is_round_four_minus_the_refusals_and_reads_no_later_bar():
    seen = drawn = refused = 0
    for bars, first, step in _sweep():
        for i in range(first, len(bars), step):
            d4 = BD.base_drawing(bars[:i + 1], i, draw_round=4)
            want = None if d4 is not None and BD.floor_refuses(bars[:i + 1], i, d4) else d4
            now = BD.base_drawing(bars[:i + 1], i)
            assert now == want, i
            key = json.dumps(now, sort_keys=True)
            assert json.dumps(BD.base_drawing(bars, i), sort_keys=True) == key, i
            assert json.dumps(BD.base_drawing(_wild(bars[:i + 1]), i), sort_keys=True) == key, i
            if d4 is not None:
                # the floor itself reads bars[:i+1] only
                assert BD.floor_refuses(bars, i, d4) is BD.floor_refuses(_wild(bars[:i + 1]), i, d4)
            seen += 1
            drawn += now is not None
            refused += d4 is not None and now is None
    assert seen > 700 and drawn >= 10 and refused >= 10, (seen, drawn, refused)
