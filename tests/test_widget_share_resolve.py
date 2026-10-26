"""Task 11.4: resolving a shared widget's "pick yours" choices back into a plan (`share.resolve_plan`)."""
from __future__ import annotations

import pytest

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG
UUID_A = "0a1b2c3d-1111-4222-8333-000000000001"
UUID_B = "0a1b2c3d-1111-4222-8333-000000000002"
PROP = "b" * 32


@pytest.fixture(autouse=True)
def _kinds_offered(monkeypatch):
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)


def _shared(plan, **kw):
    out = share.share_plan(plan, catalog=CAT, **kw)
    return out.payload["plan"], out.slots


def _resolve(plan, slots, answers):
    return share.resolve_plan(plan, slots, answers, catalog=CAT)


CLOSED = {"v": 1, "source": "closed_trades", "accounts": {"id": "acc-1"},
          "filters": [{"field": "setup", "op": "in", "values": ["Flag", "Base"]},
                      {"field": "symbol", "op": "contains", "values": ["AA"]},
                      {"field": "mistake", "op": "has_any", "values": ["fomo"]},
                      {"field": "net", "op": "between", "values": [100, 500]}],
          "measures": [{"key": "net_pnl"}]}


def test_resolve_each_type_and_any():
    plan, slots = _shared(CLOSED)
    assert [s["type"] for s in slots] == ["account", "setup", "symbol", "tag", "number", "number"]
    got = _resolve(plan, slots, {"p1": "acc-7", "p2": "Pullback", "p3": "NV", "p4": ["late", "fomo"],
                                 "p5": 50, "p6": 75.5})
    assert got["accounts"] == {"id": "acc-7"}
    assert [f["values"] for f in got["filters"]] == [["Pullback"], ["NV"], ["late", "fomo"], [50, 75.5]]
    anyway = _resolve(plan, slots, {"p1": {"any": True}, "p2": {"any": True}, "p3": "NV",
                                    "p4": {"any": True}, "p5": 1, "p6": {"any": True}})
    assert anyway["accounts"] == "all"
    assert [f["field"] for f in anyway["filters"]] == ["symbol"]

    notes = {"v": 3, "source": "notes",
             "filters": [{"field": "folder", "op": "in", "values": ["f1"]},
                         {"field": "kind", "op": "in", "values": ["k1"]},
                         {"field": "property", "prop": PROP, "op": "eq", "values": [7]}],
             "measures": [{"key": "property_sum", "prop": PROP}]}
    plan, slots = _shared(notes)
    assert [s["type"] for s in slots] == ["folder", "note_kind", "property", "number"]
    got = _resolve(plan, slots, {"p1": "f9", "p2": "k9", "p3": "c" * 32, "p4": 3})
    assert got["filters"][2] == {"field": "property", "op": "eq", "values": [3], "overridable": False,
                                 "prop": "c" * 32}
    assert got["measures"] == [{"key": "property_sum", "prop": "c" * 32}]

    days = {"v": 2, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
            "filters": [{"field": "routine_done", "op": "in", "values": ["done"], "ref": UUID_A},
                        {"field": "tracker_value", "op": "gte", "values": [2], "ref": UUID_B}],
            "split": {"by": "routine_done", "ref": UUID_A}, "view": {"type": "bar"}}
    plan, slots = _shared(days)
    assert [(s["type"], s["any"]) for s in slots] == [("routine", False), ("tracker", False),
                                                     ("number", True)]
    got = _resolve(plan, slots, {"p1": UUID_B, "p2": UUID_A, "p3": 4})
    assert got["filters"][0]["ref"] == UUID_B and got["split"]["ref"] == UUID_B
    assert got["filters"][1]["ref"] == UUID_A and got["filters"][1]["values"] == [4]

    formula = {"v": 3, "source": "closed_trades", "measures": [{"formula": "f1", "agg": "avg"}],
               "formulas": [{"id": "f1", "name": "Edge", "expr": "[r] * 2 - -3", "format": "r"}]}
    plan, slots = _shared(formula)
    assert plan["formulas"][0]["expr"] == "[r] * [#p1] - [#p2]"
    got = _resolve(plan, slots, {"p1": 1.25, "p2": -4})
    assert got["formulas"][0]["expr"] == "[r] * 1.25 - -4"
    big = _resolve(plan, slots, {"p1": 1e20, "p2": 0.000001})
    assert big["formulas"][0]["expr"] == "[r] * 100000000000000000000 - 0.000001"


def test_any_refused_where_not_allowed():
    days = {"v": 2, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
            "filters": [{"field": "routine_done", "op": "in", "values": ["done"], "ref": UUID_A}]}
    plan, slots = _shared(days)
    with pytest.raises(share.ShareError) as e:
        _resolve(plan, slots, {"p1": {"any": True}})
    assert e.value.code == "invalid" and "Routine" in e.value.sentence
    formula = {"v": 3, "source": "closed_trades", "measures": [{"formula": "f1", "agg": "avg"}],
               "formulas": [{"id": "f1", "name": "Edge", "expr": "[r] * 2", "format": "r"}]}
    plan, slots = _shared(formula)
    with pytest.raises(share.ShareError) as e:
        _resolve(plan, slots, {"p1": {"any": True}})
    assert e.value.code == "invalid"


def test_unresolved_refused():
    plan, slots = _shared(CLOSED)
    for answers in ({}, {"p1": "acc", "p2": "Flag", "p3": "AA", "p4": "x", "p5": 1}):
        with pytest.raises(share.ShareError) as e:
            _resolve(plan, slots, answers)
        assert e.value.code == "unresolved"
        assert e.value.sentence == "Pick a value for each choice, or Any."


def test_number_slot_needs_a_number():
    plan, slots = _shared(CLOSED)
    base = {"p1": "acc", "p2": "Flag", "p3": "AA", "p4": "x", "p5": 1}
    for bad in ("12", True, None, float("nan"), float("inf"), [3]):
        with pytest.raises(share.ShareError) as e:
            _resolve(plan, slots, {**base, "p6": bad})
        assert e.value.code == "invalid" and e.value.sentence == "Type a number for Net P&L."


def test_resolved_plan_validates_and_has_no_marker():
    plan, slots = _shared(CLOSED)
    got = _resolve(plan, slots, {"p1": "acc", "p2": "Flag", "p3": "AA", "p4": "x", "p5": 1, "p6": 2})
    assert not share.has_unresolved(got)
    assert got == wplan.validate_plan(got, CAT)
    # a resolution that does not validate is a member sentence, never a server error
    with pytest.raises(share.ShareError) as e:
        _resolve(plan, slots, {"p1": "acc", "p2": "Flag", "p3": "AA", "p4": "x", "p5": 9, "p6": 2})
    assert e.value.code == "invalid" and e.value.sentence == wplan.S_FILTER_LOW_ABOVE_HIGH
    # a hostile shared plan whose formula NAME carries a token: validate_plan accepts the name, so
    # only the post-validation rail stops the marker leaving resolve_plan
    hostile = {"v": 3, "source": "closed_trades", "measures": [{"formula": "f1", "agg": "sum"}],
               "formulas": [{"id": "f1", "name": "Field [#p1]", "expr": "[r] + [#p1]", "format": "r"}]}
    hp, hs = _shared({**hostile, "formulas": [{**hostile["formulas"][0], "name": "x",
                                               "expr": "[r] + 1"}]})
    assert hp["formulas"][0]["expr"] == "[r] + [#p1]"
    with pytest.raises(share.ShareError) as e:
        _resolve({**hp, "formulas": [{**hp["formulas"][0], "name": "Field [#p1]"}]}, hs, {"p1": 2})
    assert e.value.code == "unresolved"
    # has_unresolved is total and finds a marker anywhere
    assert share.has_unresolved({"a": [{"b": {"pick": "p3"}}]})
    assert share.has_unresolved(["x", "[r] * [#p12]"])
    assert not share.has_unresolved({"a": [1, "[r]", None, 2.5, True]})
    for odd in (None, 3, "x", object(), b"[#p1]"):
        assert share.has_unresolved(odd) in (True, False)
    loop: list = []
    loop.append(loop)
    assert share.has_unresolved(loop) is False


def test_resolve_round_trip_preserves_needed_version():
    v3 = {"v": 3, "source": "closed_trades", "measures": [{"formula": "f1", "agg": "sum"}],
          "formulas": [{"id": "f1", "name": "Edge", "expr": "[r] + 1", "format": "r"}]}
    plan, slots = _shared(v3)
    assert plan["v"] == 3
    assert _resolve(plan, slots, {"p1": 2})["v"] == 3
    v1 = {"v": 3, "source": "closed_trades", "measures": [{"key": "win_rate"}],
          "filters": [{"field": "setup", "op": "in", "values": ["Flag"]}]}
    plan, slots = _shared(v1)
    assert plan["v"] == 1                       # the version is what the plan needs (W9-R3)
    got = _resolve(plan, slots, {"p1": "Base"})
    assert got["v"] == 1 == wplan.needed_version(got)
