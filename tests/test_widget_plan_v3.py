"""Task 10.4 - plan format 3: member formulas, two new sources, four display options.

Ruling W10-R3: `plan.PLAN_VERSION` is 3, a plan is stored with `v = needed_version(plan)`, and the
new keys are written ONLY when used, so every wave 8 and wave 9 plan validates to exactly the dict
it did before (railed against a frozen copy taken BEFORE this task, `widget_plans_w9.json`).

Most cases run against the real catalog. A few run against small stubs whose `view_allowed` answers
None and nothing else: the notes source Task 10.7 builds, and (written before Task 10.6 relaxed the
real catalog for them) a formula split and a goal progress bar with no number target.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pytest

from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import plan as P
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import sources as S
from tests.test_widget_plan import CAT as STUB

CAT = S.CATALOG
FIXTURES = Path(__file__).with_name("fixtures")
FROZEN = json.loads((FIXTURES / "widget_plans_w9.json").read_text(encoding="utf-8"))["plans"]
PID = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
PID2 = "4a1d3b2f-6c7e-4f80-9bac-1d2e3f4a5b6c"
W10_DISPLAY = ("cumulative", "targetGoal", "stopAfter", "quadrants")


class _Lenient:
    """The real sources and measures, with a view rule that refuses nothing."""
    sources = CAT.sources
    measures = CAT.measures
    accents = CAT.accents

    def view_allowed(self, plan):
        return None


LENIENT = _Lenient()


@dataclass(frozen=True)
class _F:
    key: str
    label: str
    type: str | None = None
    ops: tuple | None = None
    hour_key: str | None = None
    split: bool = False


@dataclass(frozen=True)
class _Src:
    label: str
    fields: dict


@dataclass(frozen=True)
class _M:
    label: str
    sources: frozenset
    kind: str = "count"


def _fields(*fs: _F) -> dict:
    return {f.key: f for f in fs}


@dataclass
class _W10Catalog:
    """Stand-ins for Tasks 10.6 and 10.7's two sources (not in the real catalog yet)."""
    sources: dict = field(default_factory=lambda: {
        "notes": _Src("Notes", _fields(
            _F("created", "Created", "day", hour_key="created_hour", split=True),
            _F("folder", "Folder", "enum", split=True),
            _F("property", "Property", None))),
        "options_strategies": _Src("Options strategies", _fields(
            _F("day", "Day", "day", split=True), _F("net", "Net P&L", "number"))),
    })
    measures: dict = field(default_factory=lambda: {
        "notes": _M("Notes", frozenset({"notes"})),
        "property_sum": _M("Sum of a property", frozenset({"notes"}), "sum"),
        "strategies": _M("Strategies", frozenset({"options_strategies"})),
    })
    accents: tuple = ("gold",)

    def view_allowed(self, plan):
        return None


W10 = _W10Catalog()


def ct(**over) -> dict:
    p = {"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
         "range": {"token": "last_30d"}}
    p.update(over)
    return p


def F(fid="f1", name="Edge", expr="[exit_efficiency]", **extra) -> dict:
    return {"id": fid, "name": name, "expr": expr, **extra}


def refused(raw, catalog=CAT) -> P.PlanError:
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(raw, catalog)
    return ei.value


def _cat(name):
    return CAT if name == "real" else STUB


# -- wave 8 and wave 9 plans are untouched ------------------------------------------------------

def test_wave8_and_wave9_plans_validate_byte_identical():
    shelf = [r for r in FROZEN if r["name"].startswith("shelf:")]
    assert len(FROZEN) >= 100 and len(shelf) >= 20          # non-vacuity: the copy is the full set
    assert {r["catalog"] for r in FROZEN} == {"real", "stub"}
    assert {r["valid"]["v"] for r in FROZEN} == {1, 2}       # both older formats are covered
    for row in FROZEN:
        out = P.validate_plan(copy.deepcopy(row["raw"]), _cat(row["catalog"]))
        assert json.dumps(out, sort_keys=True) == json.dumps(row["valid"], sort_keys=True), \
            row["name"]
        assert "formulas" not in out and not set(W10_DISPLAY) & set(out["display"]), row["name"]


V3_RAWS = {
    "formula measure": ct(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"}]),
    "aggregate formula": ct(formulas=[F(expr="SumIf([net], [r] > 0) / CountIf([r] > 0)")],
                            measures=[{"formula": "f1"}, {"key": "win_rate"}]),
    "formula filter": ct(formulas=[F(expr="[r] > 1")],
                         filters=[{"field": "formula:f1", "op": "is", "values": [True]}]),
    "cumulative": ct(split={"by": "day"}, view={"type": "line"}, measures=[{"key": "net_pnl"}],
                     display={"cumulative": True}),
    "stop after": ct(measures=[{"key": "current_streak"}], display={"stopAfter": 3}),
    # Task 10.9 (10.18 m6): quadrants only on the excursion pair, |MAE| across and MFE up, in R
    "quadrants": ct(formulas=[F("f1", "MAE", "Abs([mae_r])", format="r"),
                              F("f2", "MFE", "[mfe_r]", format="r")],
                    measures=[{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "avg"}],
                    view={"type": "scatter"}, display={"quadrants": "excursion"}),
}


def test_stored_plans_of_every_format_round_trip():
    """A stored plan (the validator's own output) reloads to itself: v1, v2 and v3 alike."""
    stored = [(r["valid"], _cat(r["catalog"])) for r in FROZEN]
    stored += [(P.validate_plan(copy.deepcopy(raw), CAT), CAT) for raw in V3_RAWS.values()]
    assert {p["v"] for p, _c in stored} == {1, 2, 3}
    for p, cat in stored:
        again = P.validate_plan(copy.deepcopy(p), cat)
        assert json.dumps(again, sort_keys=True) == json.dumps(p, sort_keys=True), p


# -- the version ----------------------------------------------------------------------------------

def _seven_features() -> dict:
    return {
        "formula": ct(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"}]),
        "options source": {"v": 1, "source": "options_strategies",
                           "measures": [{"key": "strategies"}]},
        "notes source": {"v": 1, "source": "notes", "measures": [{"key": "notes"}]},
        "cumulative": V3_RAWS["cumulative"],
        "targetGoal": ct(view={"type": "progress"}, range={"token": "this_week"},
                         display={"targetGoal": True}),
        "stopAfter": V3_RAWS["stop after"],
        "quadrants": V3_RAWS["quadrants"],
    }


def test_needed_version_three_only_for_wave10_features():
    features = _seven_features()
    assert len(features) == 7
    for name, raw in features.items():
        assert P.needed_version(raw) == 3 and P.uses_wave10(raw), name
    # the four the real catalog (or the lenient one) can validate are stored as v3
    for name in ("formula", "cumulative", "stopAfter", "quadrants"):
        assert P.validate_plan(copy.deepcopy(features[name]), CAT)["v"] == 3, name
    assert P.validate_plan(copy.deepcopy(features["targetGoal"]), LENIENT)["v"] == 3
    # both new sources are in the real catalog: options strategies since Task 10.6, notes 10.7
    assert P.validate_plan(copy.deepcopy(features["options source"]), CAT)["v"] == 3
    assert P.validate_plan(copy.deepcopy(features["notes source"]), CAT)["v"] == 3
    for name in ("options source", "notes source"):
        assert P.validate_plan(copy.deepcopy(features[name]), W10)["v"] == 3
    # tools alone: 2; neither: 1
    tools = {"v": 1, "source": "routine_history", "measures": [{"key": "routine_days_done"}]}
    assert P.needed_version(tools) == 2 and not P.uses_wave10(tools)
    assert P.needed_version(ct()) == 1 and not P.uses_wave10(ct())
    assert P.validate_plan(ct(), CAT)["v"] == 1
    # an option set to false is not "off", it is a value no app writes
    for bad in (False, "yes", 1):
        assert refused(ct(split={"by": "day"}, view={"type": "line"},
                          display={"cumulative": bad})).sentence == P.S_UNREADABLE
    off = P.validate_plan(ct(), CAT)
    assert not set(W10_DISPLAY) & set(off["display"]) and "formulas" not in off


def test_uses_tools_is_still_the_wave9_answer():
    """A wave 10 plan over closed trades does not read routines or trackers: the wave 9 gate, the
    sample-book rule and the trading-days stamp all ask `uses_tools`, never the version."""
    for name, raw in _seven_features().items():
        assert not P.uses_tools(raw), name
    both = {"v": 1, "source": "routine_history", "measures": [{"key": "routine_days_done"}],
            "formulas": [F(expr="[consistency]")]}
    assert P.uses_tools(both) and P.uses_wave10(both) and P.needed_version(both) == 3


def test_v3_plan_too_new_for_a_v2_server(monkeypatch):
    v3 = P.validate_plan(copy.deepcopy(V3_RAWS["formula measure"]), CAT)
    v2 = P.validate_plan({"v": 1, "source": "routine_history",
                          "measures": [{"key": "routine_days_done"}]}, CAT)
    assert (v3["v"], v2["v"], P.PLAN_VERSION) == (3, 2, 3)
    monkeypatch.setattr(P, "PLAN_VERSION", 2)                    # a server still on wave 9
    with pytest.raises(P.PlanTooNew) as e:
        P.validate_plan(copy.deepcopy(v3), CAT)
    assert e.value.sentence == P.S_TOO_NEW
    assert P.validate_plan(copy.deepcopy(v2), CAT) == v2           # v2 and v1 still run
    assert P.validate_plan(ct(), CAT)["v"] == 1


def test_uses_wave10_total():
    for odd in (None, [], "x", 5, 2.5, True, {"formulas": "x"}, {"formulas": []},
                {"display": "y"}, {"display": {"title": "t"}}, {"source": ["notes"]},
                {"source": {"a": 1}}, {"display": None, "formulas": None}):
        assert P.uses_wave10(odd) is False, odd
        assert P.needed_version(odd) in (1, 2), odd
        assert P.formula_of(odd, "f1") is None
    for odd in ({"formulas": [{}]}, {"display": {"quadrants": "x"}}, {"source": "notes"}):
        assert P.uses_wave10(odd) is True, odd
    p = P.validate_plan(copy.deepcopy(V3_RAWS["formula measure"]), CAT)
    assert P.formula_of(p, "f1") == p["formulas"][0] and P.formula_of(p, "f2") is None
    assert P.formula_of({"formulas": ["x", None, {"id": "f2"}]}, "f2") == {"id": "f2"}
    assert P.formula_of(p, ["f1"]) is None


# -- formulas ---------------------------------------------------------------------------------------

def test_formula_stored_canonical():
    raw = ct(formulas=[F(expr="  [Net P&L] / [risk $]  "),
                       F("f2", "Big wins", 'sumif([NET], [r] >= 2) / countif(true)', format="money")],
             measures=[{"formula": "f1", "agg": "sum"}, {"formula": "f2"}])
    p = P.validate_plan(raw, CAT)
    assert p["formulas"] == [
        {"id": "f1", "name": "Edge", "expr": "[net] / [risk_dollars]", "format": "number"},
        {"id": "f2", "name": "Big wins", "expr": "SumIf([net], [r] >= 2) / CountIf(TRUE)",
         "format": "money"},
    ]
    assert raw["formulas"][0]["expr"] == "  [Net P&L] / [risk $]  "   # the input is not mutated
    assert P.validate_plan(copy.deepcopy(p), CAT) == p


def test_formula_error_carries_id_and_pos():
    e = refused(ct(formulas=[F(), F("f2", "Odd", "[net] + [nope]")],
                   measures=[{"formula": "f1", "agg": "avg"}]))
    assert isinstance(e, wf.FormulaError) and isinstance(e, P.PlanError)
    assert (e.code, e.pos, e.formula_id) == ("unknown_field", 8, "f2")
    assert e.sentence == str(e) and "nope" in e.sentence


def test_formula_error_keeps_its_position_ahead_of_the_size_check():
    """The surrogate is the FORMULA's bad_char at its own position, never the plan-level
    S_BAD_CHARACTER; and a formula error outranks the plan being too large (formulas compile
    BEFORE plan_size_ok)."""
    e = refused(ct(formulas=[F(expr="[net] + " + chr(0xD800))],
                   measures=[{"formula": "f1", "agg": "sum"}]))
    assert isinstance(e, wf.FormulaError)
    assert (e.code, e.pos, e.formula_id) == ("bad_char", 8, "f1")
    assert e.sentence != P.S_BAD_CHARACTER
    big = ct(formulas=[F(expr="[net] +")], measures=[{"formula": "f1", "agg": "sum"}],
             filters=[{"field": "symbol", "op": "in", "values": ["q" * 200] * 50}] * 8)
    assert not P.plan_size_ok({k: v for k, v in big.items() if k != "formulas"})
    e = refused(big)
    assert isinstance(e, wf.FormulaError) and e.formula_id == "f1"
    # control: the same plan without the broken formula is refused for its size
    assert refused(dict(big, formulas=[F(expr="[net]")])).sentence == P.S_TOO_LARGE


def test_formula_text_may_be_longer_than_other_text():
    """A formula may be 2,000 characters; every other string stays at 200."""
    expr = " + ".join(["[exit_efficiency]"] * 15)
    assert 200 < len(expr) <= wf.MAX_LENGTH
    p = P.validate_plan(ct(formulas=[F(expr=expr)], measures=[{"formula": "f1", "agg": "sum"}]),
                        CAT)
    assert p["formulas"][0]["expr"] == expr
    e = refused(ct(formulas=[F(expr="1" + " " * 2000)], measures=[{"formula": "f1", "agg": "sum"}]))
    assert e.code == "too_long" and e.formula_id == "f1"
    assert refused(ct(display={"title": "x" * 201})).sentence == P.S_TEXT_TOO_LONG


def test_formula_measure_shapes():
    num, boo, txt = F(), F("f2", "Big", "[r] > 2"), F("f3", "Tag", "[setup]")
    agg = F("f4", "Avg win", "SumIf([net], [net] > 0) / CountIf([net] > 0)")
    fs = [num, boo, txt, agg]

    def with_(measures, catalog=CAT, **over):
        return P.validate_plan(ct(formulas=copy.deepcopy(fs), measures=measures, **over), catalog)

    assert with_([{"formula": "f4"}])["measures"] == [{"formula": "f4"}]
    for a in P.ROW_AGGS:
        assert with_([{"formula": "f1", "agg": a}])["measures"] == [{"formula": "f1", "agg": a}]
    for a in P.BOOL_AGGS:
        assert with_([{"formula": "f2", "agg": a}])["measures"] == [{"formula": "f2", "agg": a}]
    cases = [
        ([{"formula": "f1"}], P.S_FORMULA_AGG),
        ([{"formula": "f1", "agg": "count"}], P.S_FORMULA_AGG),
        ([{"formula": "f2"}], P.S_FORMULA_BOOL_AGG),
        ([{"formula": "f2", "agg": "sum"}], P.S_FORMULA_BOOL_AGG),
        ([{"formula": "f3"}], P.S_FORMULA_TEXT_MEASURE),
        ([{"formula": "f3", "agg": "count"}], P.S_FORMULA_TEXT_MEASURE),
        ([{"formula": "f4", "agg": "sum"}], P.S_UNREADABLE),
        ([{"formula": "f9", "agg": "sum"}], P.S_FORMULA_UNKNOWN),
        ([{"formula": 1, "agg": "sum"}], P.S_FORMULA_UNKNOWN),
        ([{"formula": "f1", "key": "net_pnl"}], P.S_UNREADABLE),
    ]
    for measures, sentence in cases:
        assert refused(ct(formulas=copy.deepcopy(fs), measures=measures)).sentence == sentence, \
            measures
    # an aggregate formula neither filters nor splits
    e = refused(ct(formulas=copy.deepcopy(fs),
                   filters=[{"field": "formula:f4", "op": "gt", "values": [1]}]))
    assert e.sentence == P.S_FORMULA_AGG_SPLIT
    for split in ({"by": "formula:f4"}, {"by": "setup", "then": "formula:f4"}):
        assert refused(ct(formulas=copy.deepcopy(fs), split=split, view={"type": "table"}),
                       LENIENT).sentence == P.S_FORMULA_AGG_SPLIT
    # a number formula splits through Bucket, never on its own
    assert refused(ct(formulas=copy.deepcopy(fs), split={"by": "formula:f1"}),
                   LENIENT).sentence == P.S_FORMULA_SPLIT_NUMBER
    assert refused(ct(formulas=copy.deepcopy(fs), split={"by": "formula:f9"}),
                   LENIENT).sentence == P.S_FORMULA_UNKNOWN
    for by in ("formula:f2", "formula:f3"):
        assert with_([{"key": "net_pnl"}], LENIENT, split={"by": by})["split"] == \
            {"by": by, "then": None}
    bucket = F("f5", "R band", "Bucket([r], 0, 1, 2)")
    p = P.validate_plan(ct(formulas=[bucket], split={"by": "setup", "then": "formula:f5"},
                           view={"type": "table"}), LENIENT)
    assert p["split"] == {"by": "setup", "then": "formula:f5"}
    # filters on a row formula take the ops of its type
    ok = [({"field": "formula:f1", "op": "between", "values": [0.2, 0.9]}),
          ({"field": "formula:f2", "op": "is", "values": [True]}),
          ({"field": "formula:f3", "op": "not_in", "values": ["Flag"]})]
    for f in ok:
        got = with_([{"key": "net_pnl"}], filters=[dict(f)])["filters"]
        assert got == [dict(f, overridable=False)], f
    bad = [({"field": "formula:f1", "op": "in", "values": [1]}, P.S_UNKNOWN_OP),
           ({"field": "formula:f3", "op": "contains", "values": ["x"]}, P.S_UNKNOWN_OP),
           ({"field": "formula:f2", "op": "is", "values": ["yes"]}, P.S_FILTER_VALUE_TYPE),
           ({"field": "formula:f9", "op": "is", "values": [True]}, P.S_FORMULA_UNKNOWN),
           ({"field": "formula:f2", "op": "is", "values": [True], "ref": PID}, P.S_UNREADABLE),
           ({"field": "formula:f2", "op": "is", "values": [True], "prop": PID}, P.S_UNREADABLE)]
    for f, sentence in bad:
        assert refused(ct(formulas=copy.deepcopy(fs), filters=[f])).sentence == sentence, f


def test_formula_names_unique_and_not_a_field_label():
    def names(*ns):
        return ct(formulas=[F(f"f{i + 1}", n) for i, n in enumerate(ns)],
                  measures=[{"formula": "f1", "agg": "avg"}])

    assert [f["name"] for f in P.validate_plan(names(" Edge ", "Édge", "édge"), CAT)
            ["formulas"]] == ["Edge", "Édge", "édge"]       # ASCII folding only; outer space trimmed
    for ns in (("Edge", "EDGE"), ("edge", "Edge ")):
        assert refused(names(*ns)).sentence == P.S_FORMULA_NAME_TAKEN, ns
    # the adherence label is read from its field (impl renamed it to "Followed my trading plan %" in wave 8)
    adherence = S.CLOSED_FIELDS["adherence_pct"].label
    for label in ("Net P&L", "net p&l", "R", "ET HOUR", adherence, adherence.upper()):
        assert refused(names(label)).sentence == P.S_FORMULA_NAME_TAKEN, label
    for blank in ("", "   ", "\t", None, 7):
        assert refused(names(blank)).sentence == P.S_FORMULA_NAME, blank
    assert P.validate_plan(names("x" * wf.NAME_MAX), CAT)["formulas"][0]["name"] == "x" * 60
    assert refused(names("x" * 61)).sentence == P.S_FORMULA_NAME_LONG
    assert refused(names("🚀" * 61)).sentence == P.S_FORMULA_NAME_LONG     # code points
    assert P.validate_plan(names("🚀" * 60), CAT)
    # ids, formats and the entry's shape
    dup = ct(formulas=[F(), F("f1", "Other")], measures=[{"formula": "f1", "agg": "avg"}])
    assert refused(dup).sentence == P.S_UNREADABLE
    for bad_id in ("f0", "f6", "F1", "f01", 1, None, "f1 "):
        assert refused(ct(formulas=[F(bad_id)])).sentence == P.S_UNREADABLE, bad_id
    for fmt in ("money", "percent", "r", "number"):
        assert P.validate_plan(ct(formulas=[F(format=fmt)]), CAT)["formulas"][0]["format"] == fmt
    for fmt in ("pct", "", None, 3):
        assert refused(ct(formulas=[F(format=fmt)])).sentence == P.S_FORMULA_FORMAT, fmt
    assert refused(ct(formulas=[F(colour="red")])).sentence == P.S_UNREADABLE
    assert refused(ct(formulas=[{"id": "f1", "name": "x"}])).sentence == wf.ERRORS["empty"]
    for shape in ("x", {"id": "f1"}, ["f1"]):
        assert refused(ct(formulas=shape)).sentence in (P.S_UNREADABLE, P.S_FORMULA_NAME)
    # an unused formula is allowed; an empty list is not written
    assert P.validate_plan(ct(formulas=[F()]), CAT)["formulas"][0]["id"] == "f1"
    assert "formulas" not in P.validate_plan(ct(formulas=[]), CAT)


def test_six_formulas_refused():
    five = [F(f"f{i}", f"Field {i}") for i in range(1, 6)]
    assert len(P.validate_plan(ct(formulas=five), CAT)["formulas"]) == wf.MAX_FORMULAS == 5
    six = five + [F("f5", "Field six")]
    assert refused(ct(formulas=six)).sentence == P.S_TOO_MANY_FORMULAS


def test_hour_of_a_day_field_is_a_derived_field_never_unknown():
    """`Hour([day])` reads `hour_et` (the day field's `hour_key`), which appears in the compiled
    `fields` beside `day`. It is derived, so the validator must never call it unknown, even on a
    source where the hour key is no field of its own."""
    c = wf.compile_formula("Hour([day])", S.formula_fields("closed_trades"))
    assert set(c.fields) == {"day", "hour_et"}
    p = P.validate_plan(ct(formulas=[F(expr="Hour([day]) >= 10")],
                           measures=[{"formula": "f1", "agg": "share"}]), CAT)
    assert p["formulas"][0]["expr"] == "Hour([day]) >= 10"
    notes = {"v": 1, "source": "notes", "measures": [{"key": "notes"}],
             "formulas": [F(expr="Hour([created])")]}
    assert "created_hour" not in W10.sources["notes"].fields
    assert P.validate_plan(notes, W10)["formulas"][0]["expr"] == "Hour([created])"


def test_formula_fields_type_map():
    ff = S.formula_fields("closed_trades")
    assert set(ff) == {k for k, f in S.CLOSED_FIELDS.items() if f.filterable}
    assert ff["setup"].type == "text" and ff["side"].type == "text"        # enum -> text
    assert ff["symbol"].type == "text" and ff["net"].type == "number"
    assert ff["mistake"].type == "tag" and ff["had_stop"].type == "bool"
    assert ff["day"].type == "day" and ff["day"].hour_key == "hour_et"
    assert ff["hold_minutes"].needs_times and not ff["net"].needs_times
    assert ff["net"].label == "Net P&L"
    with pytest.raises(wf.FormulaError) as e:                              # a tag is refused by name
        wf.compile_formula("[mistake]", ff)
    assert e.value.code == "tag_field"
    # every source answers; a field that needs a routine or tracker is not a formula field
    for key, src in S.SOURCES.items():
        assert S.formula_fields(key), key
    days = S.formula_fields("trading_days")
    assert "day_net" in days and not {"routine_done", "tracker_value", "tracker_bucket"} & set(days)
    assert "item" not in S.formula_fields("routine_history")             # split-only
    # control: the type map is not one answer
    assert len({fi.type for fi in ff.values()}) == 5


def test_formulas_compile_against_the_catalogs_fields():
    """The validator compiles against the catalog it is handed (one conversion,
    `plan.formula_field_infos`), the same one `sources.formula_fields` uses."""
    assert P.formula_field_infos(S.CLOSED_FIELDS) == S.formula_fields("closed_trades")
    e = refused({"v": 1, "source": "notes", "measures": [{"key": "notes"}],
                 "formulas": [F(expr="[net]")]}, W10)
    assert e.code == "unknown_field"


# -- note properties (the source itself is Task 10.7) -------------------------------------------

def _notes(**over) -> dict:
    p = {"v": 1, "source": "notes", "measures": [{"key": "notes"}], "range": {"token": "ytd"}}
    p.update(over)
    return p


def test_property_filter_needs_prop_and_may_repeat():
    two = [{"field": "property", "op": "gte", "values": [3], "prop": PID},
           {"field": "property", "op": "in", "values": ["A"], "prop": PID2},
           {"field": "property", "op": "gte", "values": [5], "prop": PID}]
    p = P.validate_plan(_notes(filters=copy.deepcopy(two)), W10)
    assert [(f["field"], f["prop"]) for f in p["filters"]] == [("property", PID),
                                                               ("property", PID2),
                                                               ("property", PID)]
    # Task 10.7: a member's property id is `uuid4().hex` (`note_properties.create_property_def`)
    hexid = PID.replace("-", "")
    assert P.validate_plan(_notes(filters=[{"field": "property", "op": "gte", "values": [3],
                                            "prop": hexid}]), W10)["filters"][0]["prop"] == hexid
    for prop in (None, "", "nope", PID.upper(), 7, "checkin:mood", hexid.upper(), hexid[:-1],
                 hexid + "0"):
        f = {"field": "property", "op": "gte", "values": [3]}
        if prop is not None:
            f["prop"] = prop
        assert refused(_notes(filters=[f]), W10).sentence == P.S_PROP_REQUIRED, prop
    assert refused(_notes(filters=[{"field": "folder", "op": "in", "values": ["x"],
                                    "prop": PID}]), W10).sentence == P.S_UNREADABLE
    assert P.validate_plan(_notes(filters=[{"field": "folder", "op": "in", "values": ["x"]}]),
                           W10)["filters"][0] == {"field": "folder", "op": "in", "values": ["x"],
                                                  "overridable": False}


def test_property_sum_needs_prop():
    p = P.validate_plan(_notes(measures=[{"key": "property_sum", "prop": PID}]), W10)
    assert p["measures"] == [{"key": "property_sum", "prop": PID}] and p["v"] == 3
    for m in ({"key": "property_sum"}, {"key": "property_sum", "prop": "x"},
              {"key": "property_sum", "prop": None}):
        assert refused(_notes(measures=[m]), W10).sentence == P.S_PROP_MEASURE, m
    assert refused(_notes(measures=[{"key": "notes", "prop": PID}]), W10).sentence == \
        P.S_UNREADABLE
    assert P.PROP_MEASURES == frozenset({"property_sum"})


def test_new_sources_refuse_last_n_trades():
    assert P.WAVE10_SOURCES == frozenset({"options_strategies", "notes"}) <= set(P.SOURCES)
    for raw in (_notes(), {"v": 1, "source": "options_strategies",
                           "measures": [{"key": "strategies"}]}):
        for tok in ("last_20_trades", "last_50_trades", "last_100_trades"):
            assert refused(dict(raw, range={"token": tok}), W10).sentence == P.S_UNKNOWN_RANGE
        assert P.validate_plan(dict(raw, range={"token": "last_30d"}), W10)["v"] == 3
        # both are in the real catalog (Tasks 10.6 and 10.7)
        for tok in ("last_20_trades", "last_50_trades", "last_100_trades"):
            assert refused(dict(raw, range={"token": tok})).sentence == P.S_UNKNOWN_RANGE
        assert P.validate_plan(copy.deepcopy(raw), CAT)["v"] == 3
    # control: closed trades still take a number of trades
    assert P.validate_plan(ct(range={"token": "last_20_trades"}), CAT)["v"] == 1


# -- display options ----------------------------------------------------------------------------

def test_display_options_rules():
    line = dict(split={"by": "day"}, view={"type": "line"})
    goal = dict(view={"type": "progress"}, range={"token": "this_week"})
    cases = [
        # cumulative: a line of totals
        (ct(**line, display={"cumulative": True}, measures=[{"key": "win_rate"}]), CAT,
         P.S_CUMULATIVE),
        (ct(split={"by": "setup"}, view={"type": "bar"}, display={"cumulative": True}), CAT,
         P.S_CUMULATIVE),
        (ct(**line, display={"cumulative": True}, formulas=[F()],
            measures=[{"key": "net_pnl"}, {"formula": "f1", "agg": "avg"}]), CAT, P.S_CUMULATIVE),
        # targetGoal
        (ct(view={"type": "progress"}, range={"token": "last_30d"},
            display={"targetGoal": True}), LENIENT, P.S_GOAL_RANGE),
        (ct(view={"type": "progress"}, range={"from": "2026-10-01", "to": "2026-10-24"},
            display={"targetGoal": True}), LENIENT, P.S_GOAL_RANGE),
        (ct(**goal, measures=[{"key": "win_rate"}], display={"targetGoal": True}), LENIENT,
         P.S_GOAL_MEASURE),
        (ct(**goal, measures=[{"key": "net_pnl"}, {"key": "trades"}],
            display={"targetGoal": True}), LENIENT, P.S_GOAL_MEASURE),
        (ct(**goal, display={"targetGoal": True, "target": 500}), LENIENT, P.S_GOAL_AND_TARGET),
        (ct(range={"token": "this_week"}, display={"targetGoal": True}), LENIENT, P.S_UNREADABLE),
        # stopAfter
        (ct(display={"stopAfter": 3}), CAT, P.S_STOP_AFTER),
        (ct(measures=[{"key": "current_streak"}], display={"stopAfter": 0}), CAT,
         P.S_STOP_AFTER_RANGE),
        (ct(measures=[{"key": "current_streak"}], display={"stopAfter": 21}), CAT,
         P.S_STOP_AFTER_RANGE),
        (ct(measures=[{"key": "current_streak"}], display={"stopAfter": True}), CAT,
         P.S_STOP_AFTER_RANGE),
        (ct(measures=[{"key": "current_streak"}], display={"stopAfter": 2.5}), CAT,
         P.S_STOP_AFTER_RANGE),
        # quadrants
        (ct(display={"quadrants": "excursion"}), CAT, P.S_QUADRANTS),
        (ct(measures=[{"key": "total_r"}, {"key": "net_pnl"}], view={"type": "scatter"},
            display={"quadrants": "corners"}), CAT, P.S_UNREADABLE),
        (ct(measures=[{"key": "total_r"}, {"key": "net_pnl"}], view={"type": "scatter"},
            display={"quadrants": "excursion"}), CAT, P.S_QUADRANTS_PAIR),
    ]
    for raw, cat, sentence in cases:
        assert refused(raw, cat).sentence == sentence, raw
    sentences = {c[2] for c in cases}
    assert {P.S_CUMULATIVE, P.S_GOAL_RANGE, P.S_GOAL_MEASURE, P.S_GOAL_AND_TARGET,
            P.S_STOP_AFTER, P.S_STOP_AFTER_RANGE, P.S_QUADRANTS} <= sentences
    # each one, used as intended, is written exactly as given
    p = P.validate_plan(ct(**line, display={"cumulative": True},
                           measures=[{"key": "net_pnl"}, {"key": "total_r"}]), CAT)
    assert p["display"]["cumulative"] is True and p["v"] == 3
    p = P.validate_plan(ct(**line, display={"cumulative": True}, formulas=[F()],
                           measures=[{"formula": "f1", "agg": "sum"}]), CAT)
    assert p["display"]["cumulative"] is True
    p = P.validate_plan(ct(**line, display={"cumulative": True},
                           formulas=[F(expr="SumIf([net], [r] > 0)")],
                           measures=[{"formula": "f1"}]), CAT)
    assert p["display"]["cumulative"] is True
    for tok in P.GOAL_TOKENS:
        p = P.validate_plan(ct(view={"type": "progress"}, range={"token": tok},
                               display={"targetGoal": True}), LENIENT)
        assert p["display"]["targetGoal"] is True and p["display"]["target"] is None
    for n in (1, 20):
        p = P.validate_plan(ct(measures=[{"key": "current_streak"}], display={"stopAfter": n}),
                            CAT)
        assert p["display"]["stopAfter"] == n
    p = P.validate_plan(V3_RAWS["quadrants"], CAT)
    assert p["display"]["quadrants"] == "excursion"
    assert P.GOAL_TOKENS == {"today": "daily", "this_week": "weekly", "this_month": "monthly",
                             "ytd": "yearly"}
    assert (P.STOP_AFTER_MAX, P.QUADRANTS) == (20, ("excursion",))


def test_wave10_member_copy_avoids_internal_words():
    names = [n for n in dir(P) if n.startswith("S_") and n[2:].split("_")[0] in
             ("FORMULA", "TOO", "PROP", "CUMULATIVE", "GOAL", "STOP", "QUADRANTS")]
    assert len(names) >= 20
    for n in names:
        for w in ("plan", "source", "scope", "definition", "shelf", "formula"):
            assert w not in getattr(P, n).lower().replace("formula field", ""), (n, w)


# -- summary -----------------------------------------------------------------------------------

def test_summary_names_formula_measures_with_the_aggregation_in_words():
    p = P.validate_plan(ct(formulas=[F(name="Exit efficiency x"), F("f2", "Big", "[r] > 2"),
                                     F("f3", "Edge sum", "SumIf([net], [r] > 0)")],
                           measures=[{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "share"},
                                     {"formula": "f3"}]), CAT)
    text = P.summary(p, CAT, None, "trades")
    assert text.startswith("Exit efficiency x (average), Big (share) and Edge sum for closed trades")
    words = {a: P.summary(P.validate_plan(ct(formulas=[F(), F("f2", "B", "[r] > 2")],
                                             measures=[m]), CAT), CAT, None, "trades")
             for a, m in (("sum", {"formula": "f1", "agg": "sum"}),
                          ("min", {"formula": "f1", "agg": "min"}),
                          ("max", {"formula": "f1", "agg": "max"}),
                          ("count", {"formula": "f2", "agg": "count"}))}
    assert words["sum"].startswith("Edge (total)") and words["min"].startswith("Edge (lowest)")
    assert words["max"].startswith("Edge (highest)") and words["count"].startswith("B (how many)")
    p = P.validate_plan(ct(formulas=[F("f1", "Tilted", "[r] < -1")], split={"by": "formula:f1"},
                           filters=[{"field": "formula:f1", "op": "is", "values": [True]}]), LENIENT)
    assert "split by Tilted" in P.summary(p, CAT, None, "trades")
    assert "filtered by Tilted" in P.summary(p, CAT, None, "trades")
    assert P.default_name(p, CAT) == "Net P&L by Tilted, last 30 days"
    assert "incl. options" not in P.summary(p, CAT, None, "trades")


# -- shared rails ------------------------------------------------------------------------------

def _label_key_clashes(fields: dict) -> list[tuple[str, str]]:
    fold = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
    keys = {k.translate(fold): k for k in fields}
    out = []
    for k, f in fields.items():
        other = keys.get(f.label.translate(fold))
        if other is not None and other != k:
            out.append((k, other))
    return out


def test_no_label_equals_another_fields_key():
    """W10-R2: a member may type a key or a label and keys win, so a label equal to a DIFFERENT
    field's key would silently read the other field."""
    assert len(CAT.sources) >= 5
    for key, src in CAT.sources.items():
        assert src.fields, key
        assert _label_key_clashes(src.fields) == [], key
    planted = {"a": _F("a", "B"), "b": _F("b", "Bee")}
    assert _label_key_clashes(planted) == [("a", "b")]                     # non-vacuity
    assert _label_key_clashes({"r": _F("r", "R")}) == []                   # its own key is fine


def test_bool_fields_emit_a_python_bool_or_none(conn):
    """A bool field reaches the formula dialect as True / False / None, never SQLite's 0 / 1
    (`[had_stop] = 1` would otherwise compare a bool with a number)."""
    from tests.test_widget_sources import UID, add_position, add_trade
    add_trade(conn, UID, day="2026-10-20")
    add_trade(conn, UID, day="2026-10-21", stop=100.0)          # placeholder stop: no stop
    add_position(conn, UID)
    add_position(conn, UID, symbol="MSFT", stop=100.0)        # placeholder stop: no stop
    from tests.test_widget_options_source import add_opt      # Task 10.6: a source with rows
    add_opt(conn, UID, closed_at="2026-10-20T19:00:00Z")
    from tests.test_widget_notes_source import add_n          # Task 10.7: a note too
    add_n(conn, UID, created="2026-10-20T15:00:00Z")
    want = {(s.key, f.key) for s in S.SOURCES.values() for f in s.fields.values()
            if f.type == "bool"}
    assert len(want) >= 4
    seen: dict[tuple[str, str], set] = {}
    today = date(2026, 10, 24)
    for key in S.SOURCES:
        if key in P.TOOL_SOURCES:
            continue
        raw = {"v": 1, "source": key, "range": {"from": "2026-10-01", "to": "2026-10-24"},
               "measures": [{"key": next(k for k, m in CAT.measures.items() if key in m.sources)}]}
        p = P.validate_plan(raw, CAT)
        sc = S.scan(conn, p, {}, P.resolve_range(p["range"], today), UID, today=today)
        assert sc.rows, key
        for row in sc.rows:
            for fkey in (f for s, f in want if s == key):
                v = row.get(fkey)
                assert v is None or type(v) is bool, (key, fkey, v)
                seen.setdefault((key, fkey), set()).add(v)
    assert set(seen) == {w for w in want if w[0] not in P.TOOL_SOURCES}
    assert any(True in vals or False in vals for vals in seen.values())


def test_wave10_shared_rows_for_both_new_sources():
    for key, empty, unit in (("options_strategies", "No options strategies in this range.",
                              "strategies"), ("notes", "No notes match.", "notes")):
        assert wpayload.S_EMPTY[key] == empty
        assert wpayload._CAP_ROWS[key] == wcompile.SCAN_ROWS == 5000
        assert wpayload._CAP_UNIT[key] == unit
    assert wrun.NO_SAMPLE_SOURCES == P.TOOL_SOURCES | P.WAVE10_SOURCES
    assert wrun._never_sample({"source": "notes"}) and wrun._never_sample(
        {"source": "options_strategies"})
    assert not wrun._never_sample(ct(formulas=[F()]))          # a formula plan may use the sample


def test_the_stamps_of_the_two_new_sources(conn):
    from tests.test_widget_sources import UID
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        opt = wrun.data_stamp(conn, UID, "options_strategies")
        notes = wrun.data_stamp(conn, UID, "notes")
    finally:
        conn.set_trace_callback(None)
    want = ["j2_option_strategies", "j2_accounts", "j2_notes", "j2_note_folders",
            "j2_note_kinds", "j2_note_properties"]
    assert len(seen) == len(want)
    for sql, table in zip(seen, want):
        assert f"FROM {table} WHERE user_id = " in sql, (table, sql)
    assert opt.startswith("o|") and notes.startswith("n|")
    assert opt != wrun.data_stamp(conn, UID, "closed_trades")
    conn.execute("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at)"
                 " VALUES ('n1', ?, 't', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')", (UID,))
    conn.commit()
    after_note = wrun.data_stamp(conn, UID, "notes")
    assert after_note != notes                                           # a new note moves it
    # fix round 1, M5: folders and kinds carry their names, so a RENAME moves the stamp
    conn.execute("INSERT INTO j2_note_folders (id, user_id, name, created_at)"
                 " VALUES ('f1', ?, 'Ideas', '2026-10-01T00:00:00Z')", (UID,))
    conn.execute("INSERT INTO j2_note_kinds (id, user_id, name, created_at)"
                 " VALUES ('k1', ?, 'Thesis', '2026-10-01T00:00:00Z')", (UID,))
    conn.commit()
    before = wrun.data_stamp(conn, UID, "notes")
    conn.execute("UPDATE j2_note_folders SET name = 'Theses' WHERE id = 'f1'")
    conn.commit()
    renamed_folder = wrun.data_stamp(conn, UID, "notes")
    assert renamed_folder != before
    conn.execute("UPDATE j2_note_kinds SET name = 'Setup' WHERE id = 'k1'")
    conn.commit()
    assert wrun.data_stamp(conn, UID, "notes") != renamed_folder


def test_engine_constants_in_the_vectors_are_the_servers():
    """W10-R36: the client twin reads the scan cap from the shared vectors, never its own copy."""
    doc = json.loads((FIXTURES / "widgetFormulaVectors.json").read_text(encoding="utf-8"))
    assert doc["engine_constants"] == {"SCAN_ROWS": wcompile.SCAN_ROWS}
    assert not set(doc["engine_constants"]) & set(doc["constants"])


@pytest.fixture
def conn(monkeypatch, tmp_path):
    from api.services import auth_db
    from tests.test_widget_sources import UID, add_user
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "wv3.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, UID)
    try:
        yield c
    finally:
        c.close()


# -- fix round 1 ----------------------------------------------------------------------------------

def test_the_stored_canonical_formula_is_held_to_the_length_limit():
    """I-2: `[Risk $]` canonicalises to `[risk_dollars]`, so 1,997 typed characters store as 3,329.
    The stored form is refused as that formula's too_long, at the limit's position; a formula whose
    stored form fits round-trips."""
    typed = "+".join(["[Risk $]"] * 222)
    c = wf.compile_formula(typed, S.formula_fields("closed_trades"))
    assert (len(typed), len(c.canonical)) == (1997, 3329)            # the review's measurement
    e = refused(ct(formulas=[F(expr=typed)], measures=[{"formula": "f1", "agg": "sum"}]))
    assert isinstance(e, wf.FormulaError)
    assert (e.code, e.pos, e.formula_id) == ("too_long", wf.MAX_LENGTH, "f1")
    assert e.sentence == wf.ERRORS["too_long"]
    # N-2, the boundary: a stored form of exactly 2,000 is accepted, 2,001 refused (typed far
    # shorter, so only the canonical check can decide). 133 * 14 + 132 = 1,994, plus padding.
    for pad, stored_ok in ((6, True), (7, False)):
        expr = "[Risk $]" + " " * pad + "+" + "+".join(["[Risk $]"] * 132)
        assert len(expr) < 1300
        raw = ct(formulas=[F(expr=expr)], measures=[{"formula": "f1", "agg": "sum"}])
        if stored_ok:
            got = P.validate_plan(raw, CAT)["formulas"][0]["expr"]
            assert len(got) == wf.MAX_LENGTH == 2000
        else:
            e = refused(raw)
            assert (e.code, e.pos, e.formula_id) == ("too_long", 2000, "f1")
    fits = "+".join(["[Risk $]"] * 133)                              # 133 * 14 + 132 = 1,994
    p = P.validate_plan(ct(formulas=[F(expr=fits)], measures=[{"formula": "f1", "agg": "sum"}]),
                        CAT)
    assert len(p["formulas"][0]["expr"]) == 1994 <= wf.MAX_LENGTH
    assert P.validate_plan(copy.deepcopy(p), CAT) == p               # the stored plan reloads


def test_every_formula_measure_kind():
    """M1: every kind `formula_measure_kind` can answer, each from the shape that gives it."""
    ff = S.formula_fields("closed_trades")

    def kind(expr, agg=None):
        return P.formula_measure_kind(wf.compile_formula(expr, ff), agg)

    assert {a: kind("[net]", a) for a in P.ROW_AGGS} == {
        "sum": "sum", "avg": "average", "min": "extreme", "max": "extreme"}
    assert {a: kind("[r] > 1", a) for a in P.BOOL_AGGS} == {"count": "count", "share": "rate"}
    assert kind("CountIf([r] > 0)") == "count"
    assert kind("SumIf([net], [r] > 0)") == "sum"
    assert kind("Share([r] > 0)") == "rate"
    assert kind("AvgIf([net], [r] > 0)") == "average"
    assert kind("SumIf([net], [r] > 0) / CountIf([r] > 0)") == "average"   # not exactly one call
    assert kind("CountIf([r] > 0) * 2") == "average"


def test_a_goal_on_data_it_does_not_follow_names_the_data():
    """M2: Net P&L picked correctly on options strategies (once 10.6 widens net_pnl) is told about
    the data, never "works with Net P&L"."""
    cat = _W10Catalog()
    cat.measures["net_pnl"] = _M("Net P&L", frozenset({"options_strategies", "closed_trades"}),
                                 "sum")
    goal = {"v": 1, "measures": [{"key": "net_pnl"}], "view": {"type": "progress"},
            "range": {"token": "this_week"}, "display": {"targetGoal": True}}
    e = refused(dict(goal, source="options_strategies"), cat)
    assert e.sentence == P.S_GOAL_SOURCE != P.S_GOAL_MEASURE
    assert "Net P&L" not in e.sentence
    assert refused(dict(goal, source="options_strategies", measures=[{"key": "strategies"}]),
                   cat).sentence == P.S_GOAL_MEASURE
    assert P.GOAL_SOURCES == ("closed_trades", "trading_days")
    # control: the same goal on closed trades is accepted
    cat.sources["closed_trades"] = _Src("Closed trades", _fields(_F("day", "Day", "day")))
    assert P.validate_plan(dict(goal, source="closed_trades"), cat)["display"]["targetGoal"]


def test_formula_names_refuse_what_the_member_cannot_see():
    """M3: the widget name's trim, then no invisible, format or line-end character, so one
    zero-width character cannot dodge the unique-name and not-a-label rules."""
    def named(n):
        return ct(formulas=[F(name=n)], measures=[{"formula": "f1", "agg": "avg"}])

    for bad in ("Net P&L\u200b", "Setup\u2060", "a\nb", "a\tb", "Edge\u00a0x", "x\u202ey"):
        assert refused(named(bad)).sentence == P.S_BAD_CHARACTER, repr(bad)
    for blank in ("\u00a0", "\u3000", " \u2028 ", "\n\t"):
        assert refused(named(blank)).sentence == P.S_FORMULA_NAME, repr(blank)
    assert P.validate_plan(named("\u3000Edge\u00a0"), CAT)["formulas"][0]["name"] == "Edge"
    assert P.validate_plan(named("Exit eff 🚀"), CAT)["formulas"][0]["name"] == "Exit eff 🚀"


def test_formula_names_keep_a_members_emoji():
    """Fix round 2, ruling W10-R47: the parts of an ordinary emoji are allowed in a name (the
    dialect's text-literal rule); every other invisible character is still refused."""
    def named(n, *more):
        fs = [F(name=n)] + [F(f"f{i + 2}", m) for i, m in enumerate(more)]
        return ct(formulas=fs, measures=[{"formula": "f1", "agg": "avg"}])

    ok = ["\u2764\ufe0f wins",                                     # heart + VS16
          "\U0001F44D\U0001F3FD days",                              # thumbs up + skin tone
          "\U0001F468\u200d\U0001F469\u200d\U0001F467 family",    # ZWJ family
          "1\ufe0f\u20e3 setup", "#\u20e3 tag",                    # keycaps
          "\u2764\ufe0e text heart",                                # text presentation
          # W10-R48: a joiner after an emoji's variation selector
          "\u2764\ufe0f\u200d\U0001F525 hot",                       # heart on fire
          "\U0001F3F3\ufe0f\u200d\U0001F308 flag",                  # rainbow flag
          "\U0001F441\ufe0f\u200d\U0001F5E8\ufe0f eye"]            # eye in speech bubble
    for n in ok:
        assert P.validate_plan(named(n), CAT)["formulas"][0]["name"] == n, repr(n)
    bad = ["\ufe0f wins",                                           # a leading selector
           "x \ufe0f",                                              # a selector after a space
           "a\u200db",                                              # a joiner outside an emoji
           "\U0001F468\u200d",                                     # a trailing joiner
           "\u200d\U0001F468",                                     # a leading joiner
           "x\u20e3",                                               # a keycap on a letter
           "\u2764\ufe0f\u200d",                                    # VS16 + ZWJ, nothing after
           "\u2764\ufe0f\u200d x",                                  # ... a space after
           "a\u200d\U0001F525",                                     # ZWJ after plain text
           "a\ufe0f\u200d\U0001F525",                               # VS16 on a letter, then ZWJ
           "Net P&L\u200b", "wins\u2060", "a\u00adb", "\u202ewins", "a\u00a0b", "a\nb"]
    for n in bad:
        assert refused(named(n)).sentence == P.S_BAD_CHARACTER, repr(n)
    # a zero-width-suffixed duplicate is still refused
    assert refused(named("Edge", "Edge\u200b")).sentence == P.S_BAD_CHARACTER
    assert refused(named("Edge", "edge")).sentence == P.S_FORMULA_NAME_TAKEN


def test_formula_filter_ops_are_the_field_ops():
    """M4: one authority: formula filters take the very tuples `sources` gives its fields."""
    assert P._FORMULA_OPS["number"] is S.OPS_NUMBER is P.OPS_NUMBER
    assert P._FORMULA_OPS["text"] is S.OPS_ENUM is P.OPS_ENUM
    assert P._FORMULA_OPS["bool"] is S.OPS_BOOL is P.OPS_BOOL
    assert S.CLOSED_FIELDS["net"].ops is P.OPS_NUMBER
    assert S.CLOSED_FIELDS["setup"].ops is P.OPS_ENUM
    assert S.CLOSED_FIELDS["had_stop"].ops is P.OPS_BOOL


def _former_pending_plans() -> dict:
    """One plan per feature W10-R46's interim guard used to refuse, validated against the REAL
    catalog: Task 10.6 relaxed `sources.view_allowed` for a formula split and a goal progress bar."""
    line = dict(split={"by": "day"}, view={"type": "line"})
    raws = {
        "formula_measure": ct(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"}]),
        "formula_filter": ct(formulas=[F(expr="[r] > 1")],
                             filters=[{"field": "formula:f1", "op": "is", "values": [True]}]),
        "formula_split": ct(formulas=[F(expr="[setup]")], split={"by": "formula:f1"}),
        "formula_split_then": ct(formulas=[F(expr="[setup]")], view={"type": "table"},
                                 split={"by": "side", "then": "formula:f1"}),
        "cumulative": ct(**line, display={"cumulative": True}),
        "targetGoal": ct(view={"type": "progress"}, range={"token": "this_week"},
                         display={"targetGoal": True}),
        "stopAfter": V3_RAWS["stop after"],
        "quadrants": V3_RAWS["quadrants"],
    }
    return {k: P.validate_plan(copy.deepcopy(r), CAT) for k, r in raws.items()}


def test_the_w10_interim_guard_is_gone():
    """W10-R46's interim engine guard EXPIRED in Task 10.6: both doors' pending sets reached empty
    (formula filters skip the SQL, the drill reads formula splits and measures through
    `aggregate.measure_of`), so the guard and its sets were deleted rather than left empty -- an
    empty refusal list reads as coverage. Every feature it refused now validates against the real
    catalog (the run / preview / drill doors are railed by the router sweep)."""
    for name in ("refuse_w10_pending", "w10_pending", "W10_FEATURES", "_W10_PENDING",
                 "_W10_DRILL_PENDING"):
        assert not hasattr(wrun, name), name
    plans = _former_pending_plans()
    assert set(plans) - {"formula_split_then"} == {"formula_measure", "formula_filter",
                                                     "formula_split", *P.WAVE10_DISPLAY}
    for name, p in plans.items():
        assert p["v"] == 3, name
    assert plans["formula_split"]["split"]["by"] == "formula:f1"
    assert plans["targetGoal"]["display"]["targetGoal"] is True
    # controls: the relaxed rules are narrow -- an UNDECLARED formula split and a progress bar with
    # neither target are still the sentences they were
    assert S.CATALOG.view_allowed({**plans["formula_split"], "formulas": []}) == S.S_SPLIT_FIELD
    no_target = {**plans["targetGoal"], "display": {**plans["targetGoal"]["display"]}}
    del no_target["display"]["targetGoal"]
    assert S.CATALOG.view_allowed(no_target) == S.S_VIEW_PROGRESS
