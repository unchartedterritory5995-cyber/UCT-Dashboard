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
    """The member round IS the drawing round (2): the row is the current drawing with no carrier, and a
    member is served that row unchanged."""
    b = _synth()
    row = auto_structures.base_draw_row("syn", b)
    d = base_draw.base_drawing(b, len(b) - 1)
    assert d is not None
    assert row["pattern_id"] == "bc:base" and row["sym"] == "SYN" and row["tf"] == "D"
    assert row["geometry"]["extras"] == {"draw_base": d, "draw_round": base_draw.BASE_DRAW_ROUND}
    assert "draw_member" not in row["geometry"]["extras"]
    assert row["geometry"]["shape"] == "base_draw" and row["levels"]["entry"] == d["pivot"]
    assert row["display_tier"] == "trusted"
    # a member is served the round-2 row, built exactly as the round-2 code builds it
    served = auto_structures.member_rows([row])
    assert served == [row] == [auto_structures._base_row("SYN", d, 2)]
    assert served[0]["geometry"]["extras"] == {"draw_base": d, "draw_round": 2}
    assert auto_structures._confirmed_base(served[0])


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


def test_the_member_round_is_a_literal_and_it_is_round_two():
    """Round 2 passed its own blind check and the literal was moved BY HAND to 2. It must stay an int
    literal in source, never derived from the drawing code, so a later drawing round reaches members only
    when it passes its own check. Round 1 stays drawable (the rollback target)."""
    import ast
    import inspect
    assert auto_structures.MEMBER_BASE_ROUND == 2
    assert base_draw.BASE_DRAW_ROUND == 2 and 1 in base_draw.DRAW_ROUNDS and 2 in base_draw.DRAW_ROUNDS
    tree = ast.parse(inspect.getsource(auto_structures))
    lits = [n.value for n in ast.walk(tree) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "MEMBER_BASE_ROUND" for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0], ast.Constant) and lits[0].value == 2


def test_the_member_gate_fails_closed_on_every_near_miss():
    # the member-round row (what a member is served) and every near miss of it
    row = auto_structures.member_rows([auto_structures.base_draw_row("SYN", _synth())])[0]
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

    near = [variant(draw_round=1), variant(draw_round=3), variant(draw_round=0), variant(draw_round=None),
            variant(draw_round="2"), variant(draw_round=2.0), variant(draw_round=True),
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
    # the member is served the round-2 drawing, with no carrier
    served = body["structures"][0]["geometry"]["extras"]
    assert served["draw_base"] == row["geometry"]["extras"]["draw_base"]
    assert served["draw_round"] == auto_structures.MEMBER_BASE_ROUND == 2 and "draw_member" not in served
    # a row stamped round 1, or from an unknown drawing round, is not served
    for rnd in (1, 3):
        bad = json.loads(json.dumps(row))
        bad["geometry"]["extras"]["draw_round"] = rnd
        monkeypatch.setattr(auto_structures, "structures_for", lambda sym, _b=bad: [_b])
        assert "structures" not in _get(PAID_MEMBER).json(), rnd


def test_the_id_is_in_the_team_and_member_sets():
    assert "bc:base" in registry.DISPLAY_TEAM_SET and "bc:base" in registry.DISPLAY_MEMBER_SET
    assert registry.display_policy("bc:base")["display_tier"] == "trusted"


def test_a_round_one_or_unknown_round_row_is_dropped_at_round_two():
    """At literal 2 a member is served ONLY a row stamped round 2. A row as the round-1 code built it
    (draw_round 1, no carrier), a round-1-era carrier row whose own drawing is missing, and every unknown
    round are dropped: fail closed."""
    b = _synth()
    d1 = base_draw.base_drawing(b, len(b) - 1, draw_round=1)
    assert d1 is not None
    good = auto_structures.base_draw_row("SYN", b)
    assert good["geometry"]["extras"]["draw_round"] == 2
    assert len(auto_structures.member_rows([good])) == 1
    round_one = auto_structures._base_row("SYN", d1, 1)       # exactly what the round-1 code served
    assert auto_structures.member_rows([round_one]) == []

    def variant(fn):
        r = json.loads(json.dumps(good))
        fn(r["geometry"]["extras"])
        return r

    near = [
        variant(lambda ex: ex.__setitem__("draw_round", 1)),
        variant(lambda ex: ex.__setitem__("draw_round", 3)),     # an unknown later round
        variant(lambda ex: ex.__setitem__("draw_round", 0)),
        variant(lambda ex: ex.__setitem__("draw_round", "2")),
        variant(lambda ex: ex.__setitem__("draw_round", True)),
        variant(lambda ex: ex.pop("draw_round")),
        # a round-1-era carrier row: no own drawing, the round-1 drawing beside it
        variant(lambda ex: ex.update({"draw_base": None, "draw_member": {"round": 1, "draw_base": d1}})),
        # a round-1 stamp carrying a round-1 member drawing is still round 1
        variant(lambda ex: ex.update({"draw_round": 1, "draw_member": {"round": 1, "draw_base": d1}})),
    ]
    for r in near:
        assert auto_structures.member_rows([r]) == [], r["geometry"]["extras"]
    # the row passed in is never modified
    before = json.dumps(good, sort_keys=True)
    auto_structures.member_rows([good])
    assert json.dumps(good, sort_keys=True) == before


def test_only_round_one_draws_then_nobody_gets_a_row(monkeypatch):
    """At literal 2, a session only round 1 would draw (round 2 withholds) produces no bc:base row at all:
    members and admins both get round 2's answer, which is nothing."""
    b = _synth()
    d1 = base_draw.base_drawing(b, len(b) - 1, draw_round=1)
    assert d1 is not None
    real = base_draw.base_drawing
    monkeypatch.setattr(base_draw, "base_drawing",
                        lambda bars, i, draw_round=None: real(bars, i, draw_round=draw_round)
                        if draw_round == 1 else None)
    assert auto_structures.base_draw_row("SYN", b) is None
    # round 2 draws: the row is round 2's drawing, for admins and members alike
    monkeypatch.setattr(base_draw, "base_drawing", real)
    row = auto_structures.base_draw_row("SYN", b)
    assert auto_structures.admin_base_rows([row]) == [row] == auto_structures.member_rows([row])


def test_when_the_literal_catches_up_there_is_no_carrier(monkeypatch):
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_ROUND", base_draw.BASE_DRAW_ROUND)
    b = _synth()
    row = auto_structures.base_draw_row("SYN", b)
    assert row["geometry"]["extras"] == {"draw_base": base_draw.base_drawing(b, len(b) - 1),
                                         "draw_round": base_draw.BASE_DRAW_ROUND}
    assert auto_structures.member_rows([row]) == [row]


def test_admin_base_rows_leaves_every_other_row_alone():
    other = {"pattern_id": "bc:flat-base", "geometry": {"extras": {}}}
    row = auto_structures.base_draw_row("SYN", _synth())
    assert auto_structures.admin_base_rows([other, row]) == [other, row]
    assert auto_structures.admin_base_rows(None) == []
