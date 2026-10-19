"""The member base drawing (bc:base): what is drawn, when it is withheld, and the fail-closed gate.

pattern_engine.base_draw.base_drawing is the lab base_draw rule (parity: test_base_draw_lab_parity.py).
auto_structures.base_draw_row turns a drawing into a structures row stamped with the drawing round;
auto_structures.member_rows serves it to a member only while that stamp is the confirmed round
(MEMBER_BASE_ROUND, a literal) beside a well-formed draw_base. Synthetic bars only (public repo).
"""
from __future__ import annotations

import datetime
import json
import math

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import base_draw
from api.services.pattern_engine.detectors import registry
from tests.authclients import PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store


def _synth(base_len=40, depth=0.12, last=-0.004, up=0.003):
    """300 sessions of advance (log slope `up`), then a rounded base `depth` deep over `base_len`
    sessions, then one session `last` away from the base's starting close."""
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


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    """Synthetic dates are long past: no forming session unless a test says so."""
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


def test_a_base_after_an_advance_is_drawn():
    b = _synth()
    d = base_draw.base_drawing(b, len(b) - 1)
    assert d is not None
    assert d["label"] == "pivot" and d["low_label"] == "base low"
    assert d["end_t"] == b[-1]["t"] and d["start_t"] < d["end_t"]
    assert d["low"] < d["pivot"] and d["bars"] >= base_draw.MIN_LEN
    # the pivot is a real body top inside the base, the low a real low inside it
    s = [x["t"] for x in b].index(d["start_t"])
    span = b[s:-1]
    assert d["pivot"] in {max(x["o"], x["c"]) for x in span}
    assert d["low"] == min(x["l"] for x in span)


@pytest.mark.parametrize("kw,why", [
    ({"up": -0.002}, "no advance into the base, price under its long average"),
    ({"last": 0.08}, "extended far past the pivot"),
    ({"last": -0.10}, "still deep in the base, not near its pivot"),
    ({"depth": 0.01}, "no pullback: not a base"),
    ({"base_len": 8}, "too short to be a base"),
])
def test_each_gate_withholds_with_a_drawing_contrast(kw, why):
    assert base_draw.base_drawing(_synth(), len(_synth()) - 1) is not None
    b = _synth(**kw)
    assert base_draw.base_drawing(b, len(b) - 1) is None, why


def test_the_row_carries_the_drawing_and_the_round():
    b = _synth()
    row = auto_structures.base_draw_row("syn", b)
    d = base_draw.base_drawing(b, len(b) - 1)
    assert row["pattern_id"] == "bc:base" and row["sym"] == "SYN" and row["tf"] == "D"
    ex = row["geometry"]["extras"]
    assert ex["draw_base"] == d and ex["draw_round"] == base_draw.BASE_DRAW_ROUND
    assert row["geometry"]["shape"] == "base_draw" and row["levels"]["entry"] == d["pivot"]
    assert row["display_tier"] == "trusted"
    assert auto_structures._confirmed_base(row)
    assert auto_structures.member_rows([row]) == [row]


def test_a_forming_session_is_dropped_before_drawing(monkeypatch):
    b = _synth()
    junk = {"t": b[-1]["t"] + 1, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0}
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: t == junk["t"])
    assert auto_structures.base_draw_row("SYN", b + [junk]) == auto_structures.base_draw_row("SYN", b)
    assert auto_structures.base_draw_row("SYN", b) is not None


def test_no_base_no_row_and_junk_never_raises():
    b = _synth(up=-0.002)
    assert auto_structures.base_draw_row("SYN", b) is None
    for junk in (None, [], [{}], [{"t": 1}], "x", [{"t": 1, "o": "a", "h": 1, "l": 1, "c": 1}] * 300):
        assert auto_structures.base_draw_row("SYN", junk) is None
    assert base_draw.base_drawing(_synth(), "3") is None
    assert base_draw.base_drawing(_synth(), True) is None
    assert base_draw.base_drawing(_synth(), 10 ** 6) is None


def test_the_member_round_is_a_literal_and_is_the_drawing_round():
    assert auto_structures.MEMBER_BASE_ROUND == 1
    assert base_draw.BASE_DRAW_ROUND == auto_structures.MEMBER_BASE_ROUND


def test_the_member_gate_fails_closed_on_every_near_miss():
    row = auto_structures.base_draw_row("SYN", _synth())
    good = json.loads(json.dumps(row))

    def variant(**over):
        r = json.loads(json.dumps(good))
        ex = r["geometry"]["extras"]
        for k, v in over.items():
            if k.startswith("bd_"):
                if v is _DEL:
                    ex["draw_base"].pop(k[3:], None)
                else:
                    ex["draw_base"][k[3:]] = v
            elif v is _DEL:
                ex.pop(k, None)
            else:
                ex[k] = v
        return r

    near = [variant(draw_round=2), variant(draw_round="1"), variant(draw_round=True),
            variant(draw_round=_DEL), variant(draw_base=_DEL), variant(draw_base="x"),
            variant(stale=True), variant(bd_label="flat top"), variant(bd_low_label=_DEL),
            variant(bd_pivot=float("nan")), variant(bd_pivot="x"), variant(bd_low=None),
            variant(bd_pivot=good["geometry"]["extras"]["draw_base"]["low"]),
            variant(bd_start_t=good["geometry"]["extras"]["draw_base"]["end_t"]),
            variant(bd_end_t=None), variant(bd_start_t="x")]
    assert auto_structures.member_rows([good]) == [good]
    for r in near:
        assert auto_structures.member_rows([r]) == [], r["geometry"]["extras"]
    # a bc:base row that is not trusted, and another id carrying a perfect stamp, are not served either
    assert auto_structures.member_rows([{**good, "display_tier": "experimental"}]) == []
    other = {**good, "pattern_id": "bc:cup-with-handle"}
    assert auto_structures.member_rows([other]) == []


_DEL = object()


def test_structures_for_appends_the_base_after_every_box_and_leaves_the_boxes_alone(monkeypatch):
    b = _synth()
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(b)))
    auto_structures._CACHE.clear()
    from api.services.screener import base_catalog
    boxes = []
    for box in base_catalog.current_base_structures(b) or []:
        det = auto_structures.box_to_detection("SYN", box, b)
        if not (det.get("geometry") or {}).get("extras", {}).get("stale"):
            boxes.append(det)
    got = auto_structures.structures_for("SYN")
    auto_structures._CACHE.clear()
    assert got[:-1] == boxes and got[-1] == auto_structures.base_draw_row("SYN", b)
    assert all(r["pattern_id"] != "bc:base" for r in boxes)


def test_flag_on_a_member_is_served_the_base_in_structures(monkeypatch):
    b = _synth()
    row = auto_structures.base_draw_row("SYN", b)
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [json.loads(json.dumps(row))])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    body = _get(PAID_MEMBER).json()
    assert [s["pattern_id"] for s in body["structures"]] == ["bc:base"]
    assert body["structures"][0]["geometry"]["extras"]["draw_base"] == row["geometry"]["extras"]["draw_base"]
    # a row from another drawing round is not served
    bad = json.loads(json.dumps(row))
    bad["geometry"]["extras"]["draw_round"] = 2
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [bad])
    assert "structures" not in _get(PAID_MEMBER).json()


def test_the_id_is_in_the_team_and_member_sets():
    assert "bc:base" in registry.DISPLAY_TEAM_SET and "bc:base" in registry.DISPLAY_MEMBER_SET
    assert registry.display_policy("bc:base")["display_tier"] == "trusted"
