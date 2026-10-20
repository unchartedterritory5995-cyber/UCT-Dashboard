"""The member inside-day drawing (draw:inside-day): what is drawn, when it is withheld, and the gate.

pattern_engine.inside_day_draw.inside_day_drawing is the lab id_draw_v2 rule (parity:
test_inside_day_draw_lab_parity.py). auto_structures.inside_day_draw_row turns a drawing into a
structures row stamped with the drawing round; auto_structures.member_rows serves it to a member only
while that stamp is the confirmed round (MEMBER_INSIDE_DAY_ROUND, a literal) beside a well-formed
draw_inside_day. The inside-day detectors themselves stay admin-only. Synthetic bars only (public repo).
"""
from __future__ import annotations

import datetime
import json
import math

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import inside_day_draw as ID
from api.services.pattern_engine.detectors import registry
from tests.authclients import PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store


def _synth(up=0.003, mo=1.0, mc=1.03, mhw=1.004, ins=(0.45, 0.85), spike=False, after=None):
    """300 sessions of advance (log slope `up`), then a MOTHER bar (open/close `mo`/`mc` x the last
    close, high `mhw` x its body top), then an INSIDE day spanning `ins` of the mother's range, then
    optionally one more session built by `after(inside)`. `spike` plants a far wick 30 sessions back."""
    out, d = [], datetime.date(2024, 1, 2)

    def nxt(d):
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        return d

    while len(out) < 300:
        d = nxt(d)
        k = len(out)
        c = 50 * math.exp(up * k) * (1 + 0.01 * math.sin(k / 3))
        o = c * 0.995
        h, l = max(o, c) * 1.008, min(o, c) * 0.992
        if spike and k == 270:
            h = c * 1.35
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(h, 4), "l": round(l, 4),
                    "c": round(c, 4), "v": 1e6})
        d += datetime.timedelta(days=1)
    p = out[-1]["c"]
    o_, c_ = p * mo, p * mc
    mh, ml = max(o_, c_) * mhw, min(o_, c_) * 0.99
    d = nxt(d)
    out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o_, 4), "h": round(mh, 4), "l": round(ml, 4),
                "c": round(c_, 4), "v": 1e6})
    d += datetime.timedelta(days=1)
    r = mh - ml
    il, ih = ml + ins[0] * r, ml + ins[1] * r
    d = nxt(d)
    out.append({"t": int(d.strftime("%Y%m%d")), "o": round(il + 0.6 * (ih - il), 4), "h": round(ih, 4),
                "l": round(il, 4), "c": round(il + 0.75 * (ih - il), 4), "v": 1e6})
    d += datetime.timedelta(days=1)
    if after:
        d = nxt(d)
        out.append(dict(after(out[-1]), t=int(d.strftime("%Y%m%d")), v=1e6))
    return out


def _draw(b):
    return ID.inside_day_drawing(b, len(b) - 1)


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    """Synthetic dates are long past: no forming session unless a test says so."""
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


def test_an_inside_day_resting_after_an_advance_is_drawn():
    b = _synth()
    d = _draw(b)
    assert d is not None
    assert (d["label"], d["stop_label"]) == ("trigger", "stop")
    # trigger and stop are the inside day's own high and low; the box is the mother bar's range
    assert d["trigger"] == b[-1]["h"] and d["stop"] == b[-1]["l"]
    assert (d["mother_high"], d["mother_low"]) == (b[-2]["h"], b[-2]["l"])
    assert (d["start_t"], d["inside_t"], d["end_t"]) == (b[-2]["t"], b[-1]["t"], b[-1]["t"])
    assert d["age"] == 0 and d["variant"] == "inside" and d["atr"] > 0
    assert d["ctx_pos"] >= ID.CTX_POS and d["inside_ratio"] <= ID.WIDE_RATIO
    # recognition is the served id4 detector's
    assert ID.served_fire(b, len(b) - 1) is not None


#: each withhold, its synthetic case, and the ONE constant whose relaxation brings the drawing back
_WITHHOLDS = [
    ("context: a far wick puts the close low in its 60-session range", dict(spike=True), ("CTX_POS", 0.0), {}),
    ("wide: the inside day spans most of the mother bar", dict(mc=1.005, ins=(0.05, 0.85)),
     ("WIDE_RATIO", 1.0), {}),
    ("wide: the inside high is within a hair of the mother high", dict(ins=(0.75, 0.99)), ("GAP_ATR", 0.0), {}),
    ("tiny: a pinned inside day", dict(ins=(0.6, 0.65)), ("TINY_ATR", 0.0), {}),
    ("rejection: the mother bar sold off and closed low", dict(mo=1.03, mc=1.0), ("REJ_POS", 0.0), {}),
    ("supply: the mother bar's long upper wick", dict(mhw=1.05, ins=(0.15, 0.3)), ("WICK_FRAC", 1.0),
     {"CTX_POS": 0.0}),
]


@pytest.mark.parametrize("why,kw,relax,also", _WITHHOLDS, ids=[w[0].split(":")[0] for w in _WITHHOLDS])
def test_each_withhold_with_a_drawing_contrast(monkeypatch, why, kw, relax, also):
    for k, v in also.items():          # isolate a gate whose case trips a neighbour too
        monkeypatch.setattr(ID, k, v)
    b = _synth(**kw)
    assert ID.served_fire(b, len(b) - 1) is not None, "the case must still be a served fire"
    assert _draw(b) is None, why
    monkeypatch.setattr(ID, *relax)
    assert _draw(b) is not None, f"relaxing {relax[0]} alone must bring it back: {why}"


def test_a_triggered_inside_day_is_not_drawn():
    def above(x):
        return {"o": x["c"], "h": x["h"] * 1.002, "l": x["l"] * 1.001, "c": x["h"]}
    b = _synth(after=above)
    assert ID.served_fire(b, len(b) - 1) is not None       # still a served (prior-session) fire
    assert _draw(b) is None


def test_no_advance_no_drawing():
    assert _draw(_synth(up=-0.002)) is None


def test_the_row_carries_the_drawing_and_the_round():
    b = _synth()
    row = auto_structures.inside_day_draw_row("syn", b)
    d = _draw(b)
    assert row["pattern_id"] == "draw:inside-day" and row["sym"] == "SYN" and row["tf"] == "D"
    ex = row["geometry"]["extras"]
    assert ex["draw_inside_day"] == d and ex["draw_round"] == ID.ID_DRAW_ROUND
    assert row["geometry"]["shape"] == "inside_day_draw"
    assert row["levels"] == {"entry": d["trigger"], "stop": d["stop"]}
    assert row["display_tier"] == "trusted"
    assert auto_structures._confirmed_inside_day(row)
    assert auto_structures.member_rows([row]) == [row]


def test_a_forming_session_is_dropped_before_drawing(monkeypatch):
    b = _synth()
    junk = {"t": b[-1]["t"] + 1, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0}
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: t == junk["t"])
    got = auto_structures.inside_day_draw_row("SYN", b + [junk])
    assert got is not None and got == auto_structures.inside_day_draw_row("SYN", b)


def test_no_drawing_no_row_and_junk_never_raises():
    assert auto_structures.inside_day_draw_row("SYN", _synth(up=-0.002)) is None
    for junk in (None, [], [{}], [{"t": 1}], "x", [{"t": 1, "o": "a", "h": 1, "l": 1, "c": 1}] * 300):
        assert auto_structures.inside_day_draw_row("SYN", junk) is None
    b = _synth()
    assert ID.inside_day_drawing(b, "3") is None
    assert ID.inside_day_drawing(b, True) is None
    assert ID.inside_day_drawing(b, 10 ** 6) is None
    assert ID.inside_day_drawing(b, 10) is None


def test_the_member_round_is_a_literal_and_is_the_drawing_round():
    assert auto_structures.MEMBER_INSIDE_DAY_ROUND == 3
    assert ID.ID_DRAW_ROUND == auto_structures.MEMBER_INSIDE_DAY_ROUND


_DEL = object()


def test_the_member_gate_fails_closed_on_every_near_miss():
    row = auto_structures.inside_day_draw_row("SYN", _synth())
    good = json.loads(json.dumps(row))
    d = good["geometry"]["extras"]["draw_inside_day"]

    def variant(**over):
        r = json.loads(json.dumps(good))
        ex = r["geometry"]["extras"]
        for k, v in over.items():
            tgt, key = (ex["draw_inside_day"], k[2:]) if k.startswith("d_") else (ex, k)
            if v is _DEL:
                tgt.pop(key, None)
            else:
                tgt[key] = v
        return r

    near = [variant(draw_round=2), variant(draw_round="3"), variant(draw_round=True), variant(draw_round=_DEL),
            variant(draw_inside_day=_DEL), variant(draw_inside_day="x"), variant(stale=True),
            variant(d_label="pivot"), variant(d_stop_label=_DEL), variant(d_trigger=float("nan")),
            variant(d_trigger="x"), variant(d_stop=None), variant(d_atr=0), variant(d_atr=_DEL),
            variant(d_trigger=d["stop"]), variant(d_mother_high=d["trigger"] - 1e-6),
            variant(d_mother_low=d["stop"] + 1e-6), variant(d_start_t=d["inside_t"]),
            variant(d_inside_t=d["end_t"] + 1), variant(d_end_t=None), variant(d_start_t="x")]
    assert auto_structures.member_rows([good]) == [good]
    for r in near:
        assert auto_structures.member_rows([r]) == [], r["geometry"]["extras"]
    # an inside-day row that is not trusted, and another id carrying a perfect stamp, are not served
    assert auto_structures.member_rows([{**good, "display_tier": "experimental"}]) == []
    assert auto_structures.member_rows([{**good, "pattern_id": "uct_inside_day_id4"}]) == []


def test_structures_for_appends_the_inside_day_last_and_leaves_the_rest_alone(monkeypatch):
    b = _synth()
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(b)))
    monkeypatch.setattr(auto_structures, "inside_day_draw_row", lambda sym, bars: None)
    auto_structures._CACHE.clear()
    without = auto_structures.structures_for("SYN")
    monkeypatch.undo()
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(b)))
    auto_structures._CACHE.clear()
    got = auto_structures.structures_for("SYN")
    auto_structures._CACHE.clear()
    assert got[:-1] == without and got[-1] == auto_structures.inside_day_draw_row("SYN", b)


def test_flag_on_a_member_is_served_the_inside_day_on_a_daily_chart(monkeypatch):
    row = auto_structures.inside_day_draw_row("SYN", _synth())
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [json.loads(json.dumps(row))])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    body = _get(PAID_MEMBER).json()
    assert [s["pattern_id"] for s in body["structures"]] == ["draw:inside-day"]
    assert body["structures"][0]["geometry"]["extras"]["draw_inside_day"] == \
        row["geometry"]["extras"]["draw_inside_day"]
    # a row from another drawing round is not served
    bad = json.loads(json.dumps(row))
    bad["geometry"]["extras"]["draw_round"] = 2
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [bad])
    assert "structures" not in _get(PAID_MEMBER).json()


def test_the_id_is_in_the_team_and_member_sets_and_the_detectors_stay_internal():
    pid = auto_structures.INSIDE_DAY_DRAW_ID
    assert pid in registry.DISPLAY_TEAM_SET and pid in registry.DISPLAY_MEMBER_SET
    assert registry.display_policy(pid)["display_tier"] == "trusted"
    # the drawing does not make the recognition member-served: the id4 detector is still internal
    assert "uct_inside_day_id4" in registry.INTERNAL_PATTERN_IDS
    assert "uct_inside_day_id4" not in registry.DISPLAY_MEMBER_SET
