"""A formula that references its OWN declared input — authored to armed to fired.

🔴 THE DEFECT, IN ONE SENTENCE. `parse.js` turns every identifier into a `series`
node (deliberately — the parser needs no table), `BuilderSheet.buildDefinition`
puts `lineWidth` on every definition it builds, and NEITHER the repaint linter
NOR the cross-lane conformance harness had any concept of an input. So the moment
a member typed a declared knob's name into their formula:

  1. `ast_lint.lint_repaint` badged it `repaints` — *"unanalysable: `lineWidth` is
     not a series this table declares"* — `user_definitions.save` STORED that
     verdict, and `_gate_repaint` refused the definition outright;
  2. and had it got past that, `tools/ast_conformance.run_js` / `run_py` passed
     no inputs, so `run_py` raised `TableRefusal('resolve:name')` and
     `_gate_cross_lane` refused it a second time.

Refused twice over, at two doors, neither of which had anything to say about what
either gate exists to decide. `tests/test_alert_user_inputs.py` measured both and
rode over them by writing the stored verdict by hand; ⛔ NOTHING IN THIS FILE
OVERRIDES ANYTHING. Every verdict here is the shipped linter's own, every
admission runs the real node process, and the number the alert fires on is read
back out of the evaluator.

⭐ AND THE REFUSAL DIRECTION IS HALF THE FILE. An input is a DECLARED SCALAR, not
a licence for any name at all: an undeclared name is still `repaints`, an input
may not decide a WINDOW, a caller may not widen a definition's own input set, and
a definition whose formula genuinely cannot be bounded is still refused — by the
gate that means it. A refusal that moves to the wrong door is this project's
most-repeated defect.
"""
import json
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar                                          # noqa: E402
from api.services import alert_user_series as aus                  # noqa: E402
from api.services import ast_lint as al                            # noqa: E402
from api.services import indicator_alert_evaluator as ev           # noqa: E402
from api.services import indicator_alert_service as ias            # noqa: E402
from api.services import user_definitions as ud                    # noqa: E402


USER_A = "user-inputs-e2e"
DEF_ID = "u_11aabb22ccdd"
ADDRESS = f"{DEF_ID}.value"

#: `close * lineWidth` — the audit's own example, and the shape every builder
#: definition is one keystroke away from.
AST_CLOSE_TIMES_INPUT = {
    "type": "op", "name": "*", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "lineWidth"},
    ],
}

#: An input in the WINDOW position. It is declared, so the name resolves — and
#: the linter must STILL fail closed, because `_resolve_declaration` bounds a
#: window from a literal `num` node and a per-instance knob is not one.
AST_SMA_OF_INPUT_WINDOW = {
    "type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "lineWidth"},
    ],
}

#: A name NOTHING declares — neither the table nor the definition.
AST_UNDECLARED_NAME = {
    "type": "op", "name": "*", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "notAKnob"},
    ],
}


def defn(*, tree, def_id: str = DEF_ID, inputs=None) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "My Line", "shortName": "ML"},
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": inputs if inputs is not None else [
            {"key": "lineWidth", "type": "int", "label": "Line width", "default": 2},
        ],
    }


@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.fixture
def alerts_db(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(ias, "_DB_PATH", str(path))
    ias.init_schema()
    return path


@pytest.fixture(scope="module")
def real_bars():
    """The 579-bar shared parity series, digest-checked on load.

    The same tape `tools/ast_conformance.py` proved the two lanes equal on, so
    the arm-time equality below is taken on the series the contract was
    established against rather than on a synthetic ramp.
    """
    return ar.load_fixture("intraday5m")["bars"]


def _alert(params_json=None) -> dict:
    return {"id": 1, "user_id": USER_A, "sym": "TEST", "tf": "5",
            "indicator": ADDRESS, "condition": "above", "threshold": -1e9,
            "params_json": params_json, "last_value": None}


# ═══ 1. THE GATE — authored, saved, linted, budgeted, PROVEN, armed, fired ════

def test_an_input_referencing_formula_is_LINTED_CLEAN_by_the_shipped_linter(defs_db):
    """⛔ THE STORED VERDICT, WRITTEN BY `save`, WITH NO OVERRIDE.

    `_gate_repaint` reads what `user_definitions.save` stored — Phase D Task 10
    pinned that deliberately — so this row is the input the arm below is refused
    or admitted on. Before the fix it read `{"value": "repaints"}`.
    """
    row = ud.save(USER_A, DEF_ID, defn(tree=AST_CLOSE_TIMES_INPUT))
    assert row["repaint"] == {"value": "non-repainting"}, (
        "the shipped linter still cannot see the definition's own declared "
        "input, so `_gate_repaint` refuses every formula that names one")

    with sqlite3.connect(str(ud._DB_PATH)) as c:
        stored = c.execute(
            "SELECT repaint FROM user_definitions WHERE def_id=?",
            (DEF_ID,)).fetchone()[0]
    assert json.loads(stored) == {"value": "non-repainting"}, (
        "the verdict in the ROW is what the gate reads; a clean return value "
        "over a dirty row would admit nothing")


def test_the_arm_ADMITS_it_through_the_real_gates_on_real_bars(defs_db, real_bars):
    """⭐ THE WHOLE CHAIN, WITH NOTHING STUBBED.

    `admit_user_definition` runs the definition gate, the lane gate, the repaint
    gate, the budget gate and then SPAWNS A NODE PROCESS to compare the two
    interpreters at 1e-9 over 579 real bars — with the definition's declared
    inputs threaded into BOTH lanes off one case object. A single one of those
    five doors refusing means no alert can ever be created.
    """
    ud.save(USER_A, DEF_ID, defn(tree=AST_CLOSE_TIMES_INPUT))
    out = aus.admit_user_definition(USER_A, DEF_ID, None, bars=real_bars)

    assert out["addresses"] == [ADDRESS]
    assert out["compared"] == len(real_bars), (
        "the cross-lane proof covered %r of %d bars — agreement over a short "
        "column agrees on every row it happens to have"
        % (out["compared"], len(real_bars)))
    assert out["rel_tol"] == 1e-9
    assert aus.scoped_key(USER_A, ADDRESS) in aus.USER_FUNCS


def test_the_armed_alert_FIRES_on_the_value_the_INPUT_actually_produces(
        defs_db, real_bars):
    """🔴 THE DELIVERABLE. Not "a function returned a dict" — the NUMBER.

    `lineWidth` defaults to 2, so the formula is worth exactly twice the close.
    An alert that armed but computed the bare close would pass every structural
    assertion above and be wrong about the only thing a member sees.
    """
    ud.save(USER_A, DEF_ID, defn(tree=AST_CLOSE_TIMES_INPUT))
    aus.admit_user_definition(USER_A, DEF_ID, None, bars=real_bars)

    last_close = real_bars[-1]["c"]
    value, triggered = ev._evaluate_one(_alert(), bars=real_bars, mode="forming")
    assert value == pytest.approx(last_close * 2.0), (
        "the armed formula did not resolve its own declared input at fire time")
    assert triggered is True

    # …and the per-instance knob moves it, on the row the popover writes.
    tripled, _ = ev._evaluate_one(_alert('{"lineWidth": 3}'), bars=real_bars,
                                  mode="forming")
    assert tripled == pytest.approx(last_close * 3.0)
    assert tripled != value


def test_the_router_level_create_path_arms_it_end_to_end(
        defs_db, alerts_db, real_bars, monkeypatch):
    """⛔ THROUGH `ias.create`, WHICH IS THE FUNCTION THE ROUTER POSTS TO.

    A call to `admit_user_definition` proves the gates; it does not prove
    anything can REACH them. The seam this branch already found dead once was
    exactly that, so the admitted case is driven through the shipped create path
    and the row is read back out of the alerts table.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in real_bars])
    ud.save(USER_A, DEF_ID, defn(tree=AST_CLOSE_TIMES_INPUT))

    created = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                         condition="above", threshold=1.0, tf="5")
    assert created is not None
    with sqlite3.connect(str(alerts_db)) as c:
        rows = c.execute("SELECT indicator FROM indicator_alerts").fetchall()
    assert [r[0] for r in rows] == [ADDRESS]


def test_the_CROSS_LANE_PROOF_is_taken_on_the_inputs_PRODUCTION_uses(
        defs_db, real_bars):
    """⭐⭐ THE AUDIT'S DEEPER FINDING, ASSERTED RATHER THAN ASSUMED.

    *"The arm-time 'lanes agree at 1e-9' proof runs on an input map neither
    production lane uses."* A gate measuring something nobody runs is worse than
    no gate: it is a green nobody may cite. The same tree offered to
    `cross_lane_report` with an EMPTY map is refused by BOTH interpreters — so
    the map is load-bearing, and a harness that quietly stopped threading it
    could not keep reporting agreement.
    """
    definition = defn(tree=AST_CLOSE_TIMES_INPUT)
    production = aus._inputs_for(definition, None)
    assert production == {"lineWidth": 2.0}

    report = aus.cross_lane_report(AST_CLOSE_TIMES_INPUT, real_bars, production)
    assert report["differences"] == []
    assert report["compared"] == len(real_bars)

    # ⛔ THE CONTROL. Without the map this comparison cannot even be taken —
    # which is what every arm-time proof of an input-referencing tree used to be.
    with pytest.raises(Exception) as caught:
        aus.cross_lane_report(AST_CLOSE_TIMES_INPUT, real_bars, {})
    assert "lineWidth" in str(caught.value), (
        "the empty-map run failed for some reason other than the unresolved "
        "input, so it is not a control on this")


# ═══ 2. THE OTHER DIRECTION — a declared knob is not a licence ════════════════

def test_an_UNDECLARED_name_is_still_repaints_and_still_refused(defs_db, real_bars):
    """⛔ THE FAIL-OPEN DIRECTION, AND IT IS THE ONE THAT COSTS THE BRAND.

    An input is a name the DOCUMENT declares. A formula naming something neither
    the table nor the definition declares is unanalysable, exactly as before, and
    the refusal names `repaint` — the gate that read the verdict — not some door
    further down.
    """
    row = ud.save(USER_A, DEF_ID, defn(tree=AST_UNDECLARED_NAME))
    assert row["repaint"] == {"value": "repaints"}

    with pytest.raises(aus.AdmissionRefused) as caught:
        aus.admit_user_definition(USER_A, DEF_ID, None, bars=real_bars)
    assert caught.value.gate == "repaint", (
        "an unreadable formula was refused by %r — a refusal that moves to the "
        "wrong door is this project's most-repeated defect"
        % caught.value.gate)
    assert aus.scoped_key(USER_A, ADDRESS) not in aus.USER_FUNCS


def test_a_declared_input_may_NOT_decide_a_WINDOW(defs_db, real_bars):
    """⛔ `sma(close, lineWidth)` — DECLARED, RESOLVABLE, AND STILL REFUSED.

    The name resolves; the WINDOW does not. `_resolve_declaration` bounds an
    `argK` from a literal `num` node, and a per-instance knob is not one — so the
    call is unanalysable and fails closed. Reading the knob's VALUE here is the
    tempting fix and it is the wrong one: the window would then change with a
    setting, and the badge promises a property of the FORMULA.

    ⭐ AND IT IS REFUSED AT `repaint`, WHICH IS THE ATTRIBUTION THAT MATTERS. One
    door further on, `_gate_budget` calls `max_lookback`, which raises
    `TableRefusal('resolve:window')` for this same tree — a refusal that is not a
    budget refusal and is not caught, so it would leave the arm path as an
    unhandled exception rather than a named gate.
    """
    row = ud.save(USER_A, DEF_ID, defn(tree=AST_SMA_OF_INPUT_WINDOW))
    assert row["repaint"] == {"value": "repaints"}, (
        "a knob in the window position was bounded — the linter read a "
        "per-instance value as a window")

    with pytest.raises(aus.AdmissionRefused) as caught:
        aus.admit_user_definition(USER_A, DEF_ID, None, bars=real_bars)
    assert caught.value.gate == "repaint"


def test_the_input_is_the_DEFINITIONS_and_a_caller_cannot_widen_it(defs_db):
    """⛔ NOT AN ALLOW-LIST, AND NOT THE CALLER'S TO EXTEND.

    `lint_definition` DERIVES the scalar set from `defn["inputs"]` and overwrites
    whatever `opts` carried. A caller that could hand one in would have a general
    escape hatch for any name at all, which is the closed table quietly opening.
    """
    bare = defn(tree=AST_CLOSE_TIMES_INPUT, inputs=[])
    smuggled = al.lint_definition(bare, {"inputs": {"lineWidth": 1.0}})
    assert smuggled["plots"][0]["mode"] == "repaints"

    # …and the positive control: the SAME tree on a definition that really
    # declares it is clean, so "repaints" above is not what this always says.
    assert al.lint_definition(defn(tree=AST_CLOSE_TIMES_INPUT)
                              )["plots"][0]["mode"] == "non-repainting"


def test_the_OLD_spelling_declares_nothing_so_there_is_ONE_vocabulary(defs_db):
    """⛔ `inputs[].key`, AND `name` IS NOT A FALLBACK.

    `_inputs_for` read `spec.get("name")` for its whole life and agreed with
    nobody. A linter that accepted either would rebuild that divergence one level
    down and make the next author's spelling unobservable again.
    """
    legacy = defn(tree=AST_CLOSE_TIMES_INPUT,
                  inputs=[{"name": "lineWidth", "type": "int", "default": 2}])
    assert al.declared_inputs(legacy) == {}
    assert ud.save(USER_A, DEF_ID, legacy)["repaint"] == {"value": "repaints"}


def test_an_input_that_SHADOWS_a_table_series_never_changes_what_close_means(defs_db):
    """⛔ THE TABLE IS CONSULTED FIRST, AND THE ORDER IS LOAD-BEARING.

    `interpret` raises a plain error for an input that shadows a table name — a
    wiring defect, not a formula the table refuses. What the linter must never do
    is let the ANSWER depend on which map was consulted second, so a shadowing
    declaration leaves `close` reading as the series it has always been.
    """
    shadowing = defn(tree={"type": "series", "name": "close"},
                     inputs=[{"key": "close", "type": "int", "default": 7}])
    verdict = al.lint_definition(shadowing)["plots"][0]
    assert verdict["mode"] == "non-repainting"
    assert verdict["back"] == 0 and verdict["forward"] == 0
