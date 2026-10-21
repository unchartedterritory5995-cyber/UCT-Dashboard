"""flat_base drawing ROUND 2 (lab flatbase_breakdown, 2026-10-20): `broke_down` read as of the LAST bar.

Round 1 judged a flat base broken when its closes left the UPPER half of the range before the base's end
(`consolidation_extent`), so a few closes in the lower half of a healthy flat range withheld it even with the
last bar back near the top. Round 2 (`display.flat_base_breakdown_verdict`):

  * a last close back in the upper half of the range is NOT broken (a dip inside the range, a shakeout);
  * otherwise a rollover out of the upper half IS broken, and so is a close under the base's low (applied
    after the other verdicts, so a base they already withhold keeps their reason).

Members keep round 1 until the new round passes its blind check: the member set serves
auto_structures.MEMBER_FLAT_BASE_ROUND (a literal, 1), and a round-2 row carries round 1's drawing under
extras.draw_r1 wherever the two differ. The round-1 reference below is the pre-round-2 draw_geometry branch,
verbatim, so "members keep today's drawing" is checked against the code that drew it, not against a restatement.

Display-only: anchors, levels, start_t / end_t and confidence are untouched. Synthetic bars only (public repo).
"""
from __future__ import annotations

import copy

import pytest

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars, _fired

FROZEN = ("confidence", "levels", "start_t", "end_t", "pivot_ts")
RUNUP = [85.0, 88.0, 91.0, 94.0, 97.0]


def _base(n):
    """n alternating 99 / 100 closes ending on 100."""
    return [100.0 if (n - 1 - k) % 2 == 0 else 99.0 for k in range(n)]


def _det(closes, s, e, lows=None):
    """A flat_base detection whose detector base is [s, e] over _bars(closes, lows)."""
    bars = _bars(closes, lows=lows)
    hi = max(b["h"] for b in bars[s:e + 1])
    lo = min(b["l"] for b in bars[s:e + 1])
    d = {"pattern_id": "flat_base", "start_t": ymd_t(0), "end_t": ymd_t(len(closes) - 1),
         "confidence": 70, "levels": {"entry": round(hi * 1.001, 2)}, "pivot_ts": [ymd_t(0), ymd_t(s)],
         "display_tier": "trusted",
         "geometry": {"shape": "rectangle", "extras": {"base_bars": e - s + 1},
                      "anchors": [{"t": ymd_t(0), "price": 80.0}, {"t": ymd_t(s), "price": hi},
                                  {"t": ymd_t(e), "price": hi}, {"t": ymd_t(e), "price": lo}]}}
    return d, bars


def _dip_case(tail):
    """RUNUP + a 20-bar 99/100 base + three closes at 97 (lows 96: inside the range, under its midpoint),
    the base ending on the last dip bar, then `tail`. Range 96 .. 100.5, midpoint 98.25."""
    closes = RUNUP + _base(20) + [97.0, 97.0, 97.0] + list(tail)
    lows = [c - 0.5 for c in closes]
    for j in range(25, 28):
        lows[j] = 96.0
    return _det(closes, 5, 27, lows=lows)


def _drawn(d, bars):
    frozen = copy.deepcopy({k: d.get(k) for k in FROZEN})
    anchors = copy.deepcopy(d["geometry"]["anchors"])
    display.draw_geometry([d], bars)
    assert {k: d.get(k) for k in FROZEN} == frozen
    assert d["geometry"]["anchors"] == anchors
    return d["geometry"]["extras"]


def _round1_reference(d, bars):
    """The flat_base branch of display.draw_geometry BEFORE round 2 (origin/master 33bda12807), verbatim
    apart from `continue` -> `return`: what a member was drawn before this round existed."""
    D = display
    geom = d["geometry"]
    anchors = geom.get("anchors") or []
    ext = D.consolidation_extent(bars, anchors[1]["t"], anchors[3]["t"],
                                 anchors[1]["price"], anchors[3]["price"])
    extras = geom.setdefault("extras", {})
    if ext and ext.get("break") == "breakdown":
        extras["draw_anchors"] = D.extent_anchors(ext)
        extras["stale"] = True
        extras["stale_reason"] = "broke_down"
    else:
        fb, why = D.flat_base_box(bars, anchors[1]["t"], anchors[2]["t"],
                                  extras.get("base_bars"), anchors[3]["price"])
        if fb is None and why != "unknown":
            extras["stale"] = True
            extras["stale_reason"] = why
            return d
        box = fb or ext
        extras["draw_anchors"] = (
            D.extent_anchors(box) if box else [dict(anchors[1]), dict(anchors[3])])
        pv = D.pivot_line(box, anchors[1]["t"], anchors[3]["t"],
                          fb["price"] if fb else anchors[1]["price"])
        ok, why = D.pivot_base_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
        if ok and fb:
            ok, why = D.flat_shape_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
        if ok and fb:
            ok, why = D.flat_range_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
        if ok:
            extras["draw_pivot"] = pv
        else:
            extras["stale"] = True
            extras["stale_reason"] = why
    return d


def _draw_view(ex):
    return {k: ex[k] for k in display.FLAT_BASE_DRAW_KEYS if k in ex}


# -- the round-2 verdict ----------------------------------------------------------------------------

def test_a_dip_inside_the_range_with_the_last_bar_back_at_the_top_is_not_broken():
    d, bars = _dip_case([99.5, 100.0])
    ex = _drawn(d, bars)
    assert ex.get("stale_reason") != "broke_down"
    assert ex["draw_round"] == display.FLAT_BASE_DRAW_ROUND == 2
    assert not ex.get("stale") and "draw_pivot" in ex, ex       # drawn, with its pivot line
    # control: round 1 called this very base broken -- the case the round exists for
    assert _round1_reference(_dip_case([99.5, 100.0])[0], bars)["geometry"]["extras"]["stale_reason"] \
        == "broke_down"
    assert ex["draw_r1"] == {"draw_anchors": ex["draw_r1"]["draw_anchors"], "stale": True,
                             "stale_reason": "broke_down"}


def test_a_dip_inside_the_range_still_in_the_lower_half_at_the_last_bar_stays_broken():
    d, bars = _dip_case([97.0])
    ex = _drawn(d, bars)
    assert ex.get("stale") is True and ex.get("stale_reason") == "broke_down"
    assert "draw_pivot" not in ex and "draw_r1" not in ex           # both rounds agree


def _floor_case(tail):
    """RUNUP + a 20-bar 99/100 base ending on 100 (floor 98.5, midpoint 99.5: round 1 sees no rollover),
    the base ending on its last bar, then `tail`."""
    closes = RUNUP + _base(20) + list(tail)
    return _det(closes, 5, 24)


def test_a_close_below_the_floor_is_broken_where_round_1_drew_the_base():
    # one close under the floor (98.0 < 98.5), then a last close in the band but in the lower half
    d, bars = _floor_case([98.0, 99.0])
    r1 = _round1_reference(_floor_case([98.0, 99.0])[0], bars)["geometry"]["extras"]
    assert not r1.get("stale") and "draw_pivot" in r1, r1          # control: round 1 drew it
    ex = _drawn(d, bars)
    assert ex.get("stale") is True and ex.get("stale_reason") == "broke_down"
    assert "draw_pivot" not in ex
    assert ex["draw_r1"] == _draw_view(r1)


def test_a_base_already_withheld_keeps_its_own_reason_when_it_also_broke_the_floor():
    # two closes deep under the floor: round 1 withholds it for another reason, and so does round 2
    d, bars = _floor_case([94.5, 94.0])
    r1 = _round1_reference(_floor_case([94.5, 94.0])[0], bars)["geometry"]["extras"]
    ex = _drawn(d, bars)
    assert r1.get("stale") is True and r1.get("stale_reason") != "broke_down"
    assert _draw_view(ex) == _draw_view(r1) and "draw_r1" not in ex


def test_a_shakeout_under_the_floor_that_recovered_to_the_top_is_not_broken():
    d, bars = _dip_case([95.0, 99.5, 100.0])                    # 95 < the floor 96, then back to 100
    ex = _drawn(d, bars)
    assert ex.get("stale_reason") != "broke_down"
    assert display.flat_base_breakdown_verdict(bars, ymd_t(5), 100.5, 96.0, True) == "recovered"


def test_the_verdict_reads_the_last_bar_and_the_midpoint_is_the_line():
    V = display.flat_base_breakdown_verdict
    bars = _bars(RUNUP + _base(20) + [98.25])                  # exactly the midpoint of 100.5 / 96.0
    assert V(bars, ymd_t(5), 100.5, 96.0, True) == "recovered"
    bars = _bars(RUNUP + _base(20) + [98.24])
    assert V(bars, ymd_t(5), 100.5, 96.0, True) == "rolled_over"
    assert V(bars, ymd_t(5), 100.5, 96.0, False) is None
    bars = _bars(RUNUP + _base(20) + [95.9])                   # under the floor, no rollover needed
    assert V(bars, ymd_t(5), 100.5, 96.0, False) == "below_floor"
    assert V(bars, ymd_t(5), 100.5, 96.0, True) == "rolled_over"
    # unknown span or level: no verdict (the other verdicts decide)
    assert V(bars, 12345, 100.5, 96.0, True) is None
    assert V(bars, ymd_t(5), None, 96.0, True) is None
    assert V([], ymd_t(5), 100.5, 96.0, True) is None


# -- members keep round 1 ---------------------------------------------------------------------------

def _member(row):
    out = auto_structures.member_rows([row])
    return out[0] if out else None


def test_members_are_served_round_1s_drawing_of_a_round_2_row():
    assert auto_structures.MEMBER_FLAT_BASE_ROUND == 1
    d, bars = _dip_case([99.5, 100.0])
    _drawn(d, bars)
    admin = copy.deepcopy(d)
    m = _member(d)
    assert d == admin                                               # the stored row is not modified
    ex = m["geometry"]["extras"]
    assert ex.get("stale") is True and ex.get("stale_reason") == "broke_down"
    assert "draw_pivot" not in ex and "draw_r1" not in ex
    assert _draw_view(ex) == _draw_view(_round1_reference(_dip_case([99.5, 100.0])[0], bars)
                                        ["geometry"]["extras"])


def test_once_the_literal_names_round_2_members_get_the_round_2_drawing(monkeypatch):
    d, bars = _dip_case([99.5, 100.0])
    _drawn(d, bars)
    monkeypatch.setattr(auto_structures, "MEMBER_FLAT_BASE_ROUND", 2)
    m = _member(copy.deepcopy(d))
    assert m == d and "draw_pivot" in m["geometry"]["extras"] and not m["geometry"]["extras"].get("stale")


def test_the_member_gate_fails_closed(monkeypatch):
    d, bars = _dip_case([99.5, 100.0])
    _drawn(d, bars)

    def with_extras(**kw):
        r = copy.deepcopy(d)
        r["geometry"]["extras"].update(kw)
        return r

    unstamped = copy.deepcopy(d)
    del unstamped["geometry"]["extras"]["draw_round"]
    del unstamped["geometry"]["extras"]["draw_r1"]
    assert _member(unstamped) == unstamped                         # stored by the round-1 code itself
    agree = copy.deepcopy(d)
    del agree["geometry"]["extras"]["draw_r1"]
    assert _member(agree) == agree                                 # round 2 drew it as round 1 did
    for bad in ({"draw_round": 3}, {"draw_round": "2"}, {"draw_round": True}, {"draw_round": None},
                {"draw_r1": None}, {"draw_r1": []}, {"draw_r1": {}}, {"draw_r1": {"draw_pivot_x": 1}}):
        assert _member(with_extras(**bad)) is None, bad
    monkeypatch.setattr(auto_structures, "MEMBER_FLAT_BASE_ROUND", 2)
    assert _member(unstamped) is None                              # an unstamped row is round 1
    assert _member(with_extras(draw_round=3)) is None


def test_members_keep_round_1_on_every_fixture_fire_and_synthetic_case():
    """Parity with the pre-round-2 code on every flat_base fixture fire plus the synthetic cases here: the
    member's drawing keys equal what that code drew (and the admin row is round 2's)."""
    cases = []
    for bars, d in _fired("flat_base"):
        raw = copy.deepcopy(d)
        for k in list(display.FLAT_BASE_DRAW_KEYS) + ["draw_round", "draw_r1"]:
            raw["geometry"]["extras"].pop(k, None)
        cases.append((raw, bars))
    for tail in ([99.5, 100.0], [97.0], [95.0, 99.5, 100.0]):
        cases.append(_dip_case(tail))
    cases.append(_floor_case([94.5, 94.0]))
    cases.append(_floor_case([98.0, 99.0]))
    assert len(cases) >= 6
    differ = 0
    for raw, bars in cases:
        raw = {**raw, "display_tier": "trusted"}
        ref = _round1_reference(copy.deepcopy(raw), bars)["geometry"]["extras"]
        new = copy.deepcopy(raw)
        display.draw_geometry([new], bars)
        differ += "draw_r1" in new["geometry"]["extras"]
        m = _member(new)
        assert m is not None
        assert _draw_view(m["geometry"]["extras"]) == _draw_view(ref)
    assert differ >= 2, "control: no case where the rounds differ"
