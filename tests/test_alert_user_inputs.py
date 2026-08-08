"""`inputs[].key` — ONE vocabulary, and the alert lane reads it.

⭐ THE DEFECT, IN ONE SENTENCE. `alert_user_series._inputs_for` read
`spec.get("name")`; `name` is not in the input vocabulary at all, so the map it
returns was ALWAYS `{}` — and because the override loop is gated on
`if key in out`, an alert row's `params_json` (spec §8's per-instance knobs) could
never reach a user formula either. Both halves were structurally inert while
every component on both sides was individually correct and individually green.

⛔ WHY A UNIT TEST ON `_inputs_for` WOULD NOT HAVE CAUGHT IT, AND WHY THAT SHAPES
THIS FILE. `assert _inputs_for(defn, None) == {}` passes on the broken tree and
on a tree with the whole feature deleted — it would have been green for years.
So this file asserts the SEAM twice, in the two ways a seam can be asserted:

  * DERIVED — the two server-side readers of an `inputs[]` spec
    (`alert_user_series._inputs_for` and `signature/registry_defs.resolve_inputs`)
    are read out of their own source by AST and required to name the SAME
    identifier field. Neither may name `name`. That case fails on the divergence
    itself, with both components still correct.
  * BEHAVIOURAL — a definition declaring `{key: "lineWidth", default: 1}` and a
    formula reading `lineWidth` is evaluated THROUGH THE EVALUATOR on both lanes,
    with and without an alert row's `params_json`, and the number has to move.

🔴 A MEASURED GAP THIS FILE RIDES OVER, RECORDED RATHER THAN HIDDEN. Fixing
`_inputs_for` is NECESSARY AND NOT SUFFICIENT for a formula that REFERENCES an
input, because two more components have no `inputs` concept either:

  1. `ast_lint.lint_repaint` badges `close * lineWidth` **`repaints`**
     ("unanalysable: `lineWidth` is not a series this table declares"), measured
     on this tree — so `user_definitions.save` STORES a `repaints` verdict and
     `_gate_repaint` refuses the definition outright;
  2. `tools/ast_conformance.run_js` / `run_py` take no inputs, so the arm-time
     1e-9 proof evaluates the same tree with an EMPTY input map — `run_py` raises
     `TableRefusal('resolve:name')` and the cross-lane gate refuses it.

So the tests below that need an input-referencing formula OVERRIDE THE STORED
REPAINT VERDICT — the same technique, for the same stated reason,
`tests/test_alert_user_admission.py::save` documents: what the gate READS is the
verdict stored at save time, so writing that verdict is how a test drives the
door rather than the linter. Neither of those two components is this task's to
edit, and both are reported as follow-ups.

⚠️ AND THE UNGATED HALF IS REAL TODAY: a definition that DECLARES `lineWidth`
without referencing it (which `BuilderSheet.buildDefinition` produces for every
formula it builds) is `non-repainting`, arms normally, and its declared inputs
now reach `interpret` and the catalog. That case is asserted with no override at
all.
"""
import ast as _ast
import json
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import user_definitions as ud
from api.services.signature import registry_defs


USER_A = "user-inputs-a"
DEF_ID = "u_00aabbccddee"
ADDRESS = f"{DEF_ID}.value"

#: `close * lineWidth` — the shape the audit named as reachable today:
#: `buildDefinition` puts `lineWidth` on every builder definition, and
#: `parse.js` deliberately does not validate identifiers against `TABLE.series`,
#: so this parses to a `series` node the input map is expected to resolve.
AST_CLOSE_TIMES_INPUT = {
    "type": "op", "name": "*", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "lineWidth"},
    ],
}
#: …and the one that does NOT reference its declared input, which is what every
#: builder definition looks like until somebody types the name into the formula.
AST_PLAIN = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"},
    {"type": "num", "value": 5},
]}


def defn(*, tree=None, inputs=None, def_id: str = DEF_ID) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "My Line", "shortName": "ML"},
        "compute": {"kind": "ast", "ast": tree if tree is not None else AST_PLAIN},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": inputs if inputs is not None else [
            {"key": "lineWidth", "type": "int", "default": 1},
        ],
    }


def _bars(n: int = 40, start_t: int = 1_700_000_000, step: int = 300):
    return [{"t": start_t + i * step, "o": 100.0 + i, "h": 101.0 + i,
             "l": 99.0 + i, "c": 100.0 + i, "v": 1_000} for i in range(n)]


BARS = _bars()
LAST_CLOSE = BARS[-1]["c"]


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


def save(user_id: str, definition: dict, *, repaint: dict | None = None) -> dict:
    """Store a definition, optionally OVERRIDING the linter's stored verdict.

    ⛔ THE OVERRIDE IS NOT A CHEAT AND THE REASON IS MEASURED — see this module's
    header, item 1. `_gate_repaint` reads the verdict STORED at save time (Phase D
    Task 10 pinned that deliberately), so writing that verdict is exactly how a
    test drives the door instead of the linter. Every test that does NOT need an
    input-referencing formula passes no override at all.
    """
    row = ud.save(user_id, definition["id"], definition)
    if repaint is not None:
        with sqlite3.connect(str(ud._DB_PATH)) as c:
            c.execute("UPDATE user_definitions SET repaint=? "
                      "WHERE user_id=? AND def_id=? AND version=?",
                      (json.dumps(repaint), str(user_id), definition["id"],
                       row["version"]))
    return row


# ═══ 1. THE SEAM, DERIVED — the two readers must name the SAME field ═════════

def _spec_fields(module, fn_name: str, var: str) -> set:
    """Every string field read off `var` inside `fn_name`, by AST.

    ⛔ AST, NEVER A GREP. Both files are dense with prose that names `key`,
    `name` and `default` in running text; a grep over either would report the
    vocabulary from a comment and pass on a tree where the CODE reads the other
    one. Only `var["x"]` and `var.get("x")` count.

    ⛔ AND THE FILE IS RE-PARSED FROM DISK, never `inspect.getsource`, which
    slices at the line numbers captured at import time and hands back the wrong
    slice when a co-worker inserts lines above the target — measured for real on
    this branch.
    """
    with open(module.__file__, encoding="utf-8") as fh:
        tree = _ast.parse(fh.read())
    fn = next(n for n in _ast.walk(tree)
              if isinstance(n, _ast.FunctionDef) and n.name == fn_name)
    out = set()
    for node in _ast.walk(fn):
        if isinstance(node, _ast.Subscript) and isinstance(node.value, _ast.Name) \
                and node.value.id == var and isinstance(node.slice, _ast.Constant) \
                and isinstance(node.slice.value, str):
            out.add(node.slice.value)
        if isinstance(node, _ast.Call) and isinstance(node.func, _ast.Attribute) \
                and node.func.attr == "get" and isinstance(node.func.value, _ast.Name) \
                and node.func.value.id == var and node.args \
                and isinstance(node.args[0], _ast.Constant) \
                and isinstance(node.args[0].value, str):
            out.add(node.args[0].value)
    return out


def test_the_two_server_side_readers_of_an_inputs_SPEC_name_the_SAME_FIELD():
    """🔴 THE CONTRACT CASE, AND IT IS THE ONE THAT WOULD HAVE CAUGHT THIS.

    `defSchema.validateInput` REQUIRES `input.key` and does not know the word
    `name`; `nativeRegistry.resolveInputs` reads `input.key`; and the house's own
    server-side reader, `registry_defs.resolve_inputs`, reads `spec["key"]`. The
    alert lane read `spec.get("name")` and so agreed with nobody — while every
    one of those components passed its own tests, because the disagreement lives
    in the SEAM and nothing was reading both sides.
    """
    alert_lane = _spec_fields(aus, "_inputs_for", "spec")
    house = _spec_fields(registry_defs, "resolve_inputs", "spec")

    # ⛔ THE CONTROL ON THE EXTRACTOR ITSELF. A walk that found nothing would
    # report every divergence as compliance — the shape of a scan that stopped
    # reading the file.
    assert len(alert_lane) >= 2, f"the AST walk found {alert_lane} in _inputs_for"
    assert len(house) >= 2, f"the AST walk found {house} in resolve_inputs"

    assert "key" in alert_lane, (
        "the alert lane does not read `inputs[].key`. That is the whole input "
        "vocabulary — `defSchema.validateInput` requires it and "
        "`registry_defs.resolve_inputs` reads it — so a reader that names "
        "anything else returns an EMPTY map for every schema-valid definition")
    assert "key" in house, (
        "`registry_defs.resolve_inputs` stopped reading `key` — the anchor this "
        "case measures the alert lane against just moved, so fix that first")
    assert "name" not in alert_lane | house, (
        "`name` is back in an inputs reader. It is not in the vocabulary at all: "
        "reading it is what made `_inputs_for` return `{}` for every definition, "
        "and accepting it AS WELL would be a second vocabulary for one field")
    assert {"key", "default"} <= alert_lane, (
        f"the alert lane reads {sorted(alert_lane)} — it needs the identifier "
        "and the declared default to build an instance's input map")


# ═══ 2. THE MAP IS NON-EMPTY, AND THERE IS EXACTLY ONE VOCABULARY ════════════

def test_a_definition_whose_input_is_keyed_lineWidth_produces_a_NON_EMPTY_map():
    """The audit's own example, as the smallest possible statement of the bug."""
    out = aus._inputs_for(defn(), None)
    assert out == {"lineWidth": 1.0}, (
        "the declared inputs did not reach the map — this is the `{}` every "
        "user formula was evaluated with")


def test_the_OLD_spelling_produces_NOTHING_so_there_is_exactly_one_vocabulary():
    """⛔ THE OTHER DIRECTION, AND IT IS NOT PEDANTRY.

    A reader that accepted `key` OR `name` would pass the case above while
    keeping the divergence alive — and would make the next author's choice of
    spelling unobservable again. One vocabulary, asserted from both sides.
    """
    legacy = defn(inputs=[{"name": "lineWidth", "type": "int", "default": 1}])
    assert aus._inputs_for(legacy, None) == {}
    # …and the positive control, so "empty" is not what this reader always says.
    assert aus._inputs_for(defn(), None)


def test_an_UNDECLARED_param_still_cannot_reach_the_formula():
    """The whitelist half survives the fix. `params_json` is whatever a client
    sent; only a knob the definition DECLARES may move, or an alert row could
    seed a name the author never wrote."""
    out = aus._inputs_for(defn(), {"lineWidth": 4, "nope": 9, "close": 1})
    assert out == {"lineWidth": 4.0}


def test_a_non_numeric_or_non_finite_override_is_dropped_not_passed_through():
    out = aus._inputs_for(defn(), {"lineWidth": "3"})
    assert out == {"lineWidth": 1.0}, "a string override displaced the default"
    assert aus._inputs_for(defn(), {"lineWidth": float("nan")}) == {"lineWidth": 1.0}
    assert aus._inputs_for(defn(), {"lineWidth": True}) == {"lineWidth": 1.0}


# ═══ 3. THE WIRE — `params_json` reaches the formula, on BOTH lanes ══════════

def _alert(params_json=None) -> dict:
    return {"id": 1, "user_id": USER_A, "sym": "TEST", "tf": "5",
            "indicator": ADDRESS, "condition": "above", "threshold": -1e9,
            "params_json": params_json, "last_value": None}


def test_the_declared_DEFAULT_reaches_the_formula_through_the_evaluator(defs_db):
    """⛔ BEFORE THE FIX THIS IS `(None, False)`, NOT AN ERROR — which is the
    whole reason the defect survived. `interpret` refuses `resolve:name` for a
    `lineWidth` it was never seeded, `_evaluate_one` absorbs the exception into a
    silent no-fire, and the alert is armed and mute forever with nothing to say
    so.
    """
    save(USER_A, defn(tree=AST_CLOSE_TIMES_INPUT),
         repaint={"value": "non-repainting"})
    value, triggered = ev._evaluate_one(_alert(), bars=BARS, mode="forming")
    assert value == pytest.approx(LAST_CLOSE * 1.0), (
        "the formula did not resolve its own declared input")
    assert triggered is True


def test_params_json_REACHES_the_formula_and_MOVES_the_number(defs_db):
    """⭐ THE SECOND HALF OF THE SAME BUG, AND IT IS THE ONE §8 EXISTS FOR.

    The override loop was gated on membership of a map that was always empty, so
    an alert row's stored per-instance knobs could never reach a user formula.
    Two alert rows, one definition, one set of bars: the only difference is
    `params_json`, and the number has to move by exactly that factor.
    """
    save(USER_A, defn(tree=AST_CLOSE_TIMES_INPUT),
         repaint={"value": "non-repainting"})

    default_value, _ = ev._evaluate_one(_alert(), bars=BARS, mode="forming")
    tripled, _ = ev._evaluate_one(_alert('{"lineWidth": 3}'), bars=BARS,
                                  mode="forming")

    assert default_value is not None and tripled is not None
    assert tripled != default_value, (
        "`params_json` changed nothing — the knob is still structurally inert")
    assert tripled == pytest.approx(default_value * 3.0)
    assert tripled == pytest.approx(LAST_CLOSE * 3.0)


def test_the_CLOSED_lane_reads_the_same_params_as_the_forming_one(defs_db):
    """Both lanes share ONE registered object (`fn` and `fn.column`), so a knob
    that reached one and not the other would mean the shipped lane and the
    rollback lane compute different numbers from the same row."""
    save(USER_A, defn(tree=AST_CLOSE_TIMES_INPUT),
         repaint={"value": "non-repainting"})
    now = float(BARS[-1]["t"]) + 86_400.0

    plain, _, idx = ev._evaluate_one_closed(_alert(), bars=BARS, now_epoch=now)
    tripled, _, _ = ev._evaluate_one_closed(_alert('{"lineWidth": 3}'),
                                            bars=BARS, now_epoch=now)
    assert idx == len(BARS) - 1
    assert plain == pytest.approx(LAST_CLOSE)
    assert tripled == pytest.approx(LAST_CLOSE * 3.0)


# ═══ 4. THE UNGATED HALF — a DECLARED input on an ordinary formula ═══════════

def test_a_definition_that_only_DECLARES_an_input_needs_no_override_at_all(defs_db):
    """⛔ THE NON-VACUITY OF THE OVERRIDE ABOVE, AND THE CASE THAT IS LIVE TODAY.

    `buildDefinition` puts `lineWidth` on EVERY definition it builds, and most
    formulas never mention it. Such a definition is `non-repainting`, admits
    through the front door with nothing written by hand, and its declared inputs
    now reach both `interpret` and the catalog.
    """
    row = ud.save(USER_A, DEF_ID, defn())
    assert row["repaint"] == {"value": "non-repainting"}, (
        "the plain formula is not clean — the override in the tests above would "
        "be hiding a refusal that applies to every user definition, not just the "
        "ones that reference an input")

    value, _ = ev._evaluate_one(_alert(), bars=BARS, mode="forming")
    assert value == pytest.approx(sum(b["c"] for b in BARS[-5:]) / 5)

    entry = next(e for e in aus.user_catalog(USER_A) if e["indicator"] == DEF_ID)
    assert entry["plots"][0]["inputs"] == {"lineWidth": 1.0}, (
        "the catalog offered the formula with no knobs — the popover would send "
        "no params and every alert would be on the default instance, which is "
        "spec §8's two sentences being unrepresentable again")
    assert entry["plots"][0]["instance_label"] == "My Line(1)"
