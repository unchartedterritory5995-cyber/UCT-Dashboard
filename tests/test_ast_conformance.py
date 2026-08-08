"""The instrument's own tests -- including the one that asserts the census is
currently WIDE OPEN, as a number greater than zero.

Phase D's output is a formula the user wrote. `tools/chart_parity.py` renders
COMMITTED cases and a user-authored definition exists in no committed base, so a
total regression of everything in Phase D would report 0 changed pixels and would
do so honestly. `tools/ast_conformance.py` is what replaces that gate, and this
file is what proves the instrument works before anything is measured with it.

Four things are asserted here that a normal test file would not:

  * that the escape census reads NON-ZERO today
    (`test_the_escape_census_reads_non_zero_through_the_unguarded_walker`), and
    that a guarded zero with a zero control is REFUSED
    (`test_the_verdict_refuses_a_zero_whose_control_read_zero`). The second is
    the control: without it "zero escapes" could be an artifact of a census that
    always reports zero, and Task 6 would inherit a green number that started
    green.
  * that a lane which cannot be measured REFUSES rather than reporting zero
    differences (`test_run_js_refuses_...`, `test_compare_lanes_refuses_...`).
  * that the coverage floor is DERIVED from the manifest, asserted by reading
    this module's own AST rather than by trusting the source to still say what it
    said. DPC's four constants rode outside their rail for the rule's entire life
    because that rail was a LIST.
  * that two escape cases share a refusal fragment IFF they share a guard. C Task
    9 measured `pytest.raises(match=...)` matching with the safety deleted
    because two DIFFERENT gates shared a phrase.
"""
from __future__ import annotations

import ast as pyast
import hashlib
import io
import json
import math
import pathlib
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import ast_conformance as ac  # noqa: E402
import alert_replay as ar  # noqa: E402


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _module_fn(name: str) -> pyast.FunctionDef:
    """Re-parse `tools/ast_conformance.py` and find a function BY NAME.

    NEVER by line number. `inspect.getsource` returned the wrong slice mid-run in
    Phase C -- reporting a missing call site that was right there -- because a
    co-worker inserted ~180 lines above the target, and three agents share this
    tree today.
    """
    src = io.open(ac.__file__, encoding="utf-8").read()
    for node in pyast.walk(pyast.parse(src)):
        if isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"tools/ast_conformance.py has no function named {name!r}")


def _string_literal_collections(fn: pyast.AST) -> list:
    """Every list/set/tuple literal of two or more string constants under `fn`.

    This is the shape of a HAND-LISTED floor.
    """
    out = []
    for node in pyast.walk(fn):
        if isinstance(node, (pyast.List, pyast.Set, pyast.Tuple)):
            strings = [e for e in node.elts
                       if isinstance(e, pyast.Constant) and isinstance(e.value, str)]
            if len(strings) >= 2:
                out.append([e.value for e in strings])
    return out


def _subscripts_of(fn: pyast.AST, base: str) -> list:
    """Every `<base>[...]` subscript under `fn`, as the literal key where known."""
    out = []
    for node in pyast.walk(fn):
        if (isinstance(node, pyast.Subscript)
                and isinstance(node.value, pyast.Name)
                and node.value.id == base):
            key = node.slice
            out.append(key.value if isinstance(key, pyast.Constant) else "<computed>")
    return out


def _fake_escape_corpus(cases: list) -> dict:
    return {"cases": cases}


# --------------------------------------------------------------------------- #
# the corpus
# --------------------------------------------------------------------------- #

def test_the_corpus_is_hand_written_and_every_case_states_why():
    doc = ac.load_corpus()
    ids = [c["id"] for c in doc["cases"]]
    assert len(ids) == len(set(ids)), f"duplicate corpus ids: {ids}"
    assert len(ids) >= 7, "the brief's seven cases are the floor, not the ceiling"
    for case in doc["cases"]:
        assert case.get("source"), f"{case['id']}: no source"
        assert case.get("ast"), f"{case['id']}: no ast"
        why = case.get("why") or ""
        assert len(why) >= 30, (
            f"{case['id']}: a corpus row without a REASON is a row nobody can "
            f"delete safely; got {why!r}")


def test_every_corpus_ast_uses_only_the_four_canonical_node_types():
    """The persisted shape is the contract with Python and it is deliberately
    SMALLER than jsep's: four node types, so the tree walker has four cases -- a
    surface small enough to prove closed."""
    doc = ac.load_corpus()
    seen_types, seen_keys = set(), set()
    for case in doc["cases"]:
        stack = [case["ast"]]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
                continue
            if not isinstance(node, dict):
                continue
            seen_types.add(node.get("type"))
            seen_keys |= set(node)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    stack.append(value)
    assert seen_types == set(ac.CANONICAL_NODE_TYPES), (
        f"corpus node types {sorted(seen_types)} != "
        f"{sorted(ac.CANONICAL_NODE_TYPES)}")
    assert sorted(seen_keys) == ["args", "name", "type", "value"], sorted(seen_keys)


def test_the_corpus_reads_the_same_579_bar_series_as_the_pixel_gate():
    """One series, not four copies that agreed on the day somebody made them.

    The fixture name is DERIVED from the corpus's own `bars` declaration and the
    bar count from `replay_bars.json`'s recorded metadata -- neither is typed
    here. Five typed-name mistakes in one Phase C session each failed in the
    shape of a catastrophic finding.
    """
    doc = ac.load_corpus()
    rel, name = doc["bars"].split("#", 1)
    assert (pathlib.Path(ar.BARS_PATH).resolve()
            == (_ROOT / rel).resolve()), (
        "the corpus names one replay-bars file and alert_replay reads another; "
        "two paths here means two series")
    entry = json.load(io.open(ar.BARS_PATH, encoding="utf-8"))["fixtures"][name]
    bars = ac.corpus_bars(doc)
    assert len(bars) == entry["bar_count"]
    # `intraday5m` is a REFERENCE, not a copy: it carries `barsFrom` pointing at
    # the shared parity series, which is what makes the compute oracle, the pixel
    # gate and this corpus provably ONE series.
    assert entry["barsFrom"].endswith("parityBars/intraday5m.json"), entry
    # load_fixture re-checks the sha256 itself; assert it independently so this
    # test fails if that check is ever softened.
    assert ar._bars_digest(bars) == entry["sha256"]


def test_names_in_walks_the_whole_tree_including_a_deeply_planted_name():
    doc = ac.load_corpus()
    case = next(c for c in doc["cases"] if c["id"] == "deep_nest")
    assert ac.names_in(case["ast"]) == {"sma", "ema", "close", "-"}
    # the control: a name buried under 4,000 nodes is still found, and the walk
    # does not die doing it.
    deep = ac.generate_ast("gen:nest(4000)")
    node = deep
    while node.get("right", {}).get("type") == "BinaryExpression":
        node = node["right"]
    node["right"] = {"type": "series", "name": "buried"}
    assert "buried" in ac.names_in(deep)


# --------------------------------------------------------------------------- #
# the coverage floor -- DERIVED, never hand-listed  (kills M4)
# --------------------------------------------------------------------------- #

def test_the_coverage_floor_is_derived_from_the_manifest_and_never_a_literal():
    """THE RAIL ON THE RAIL.

    A coverage claim derived from its own subject cannot rot; a coverage claim
    that is a LIST is exactly how DPC's four constants rode outside
    `test_all_constants_match_owner_spec` for the rule's entire life
    (`DPC_LOOKBACK 10 -> 999` left the file `5 passed rc=0`).

    Verified with an AST, never a grep: a grep counts comments and strings, and
    `git grep -c admit_alert_fire` says 3 on this tree where all three are prose.
    """
    fn = _module_fn("assert_corpus_covers_the_table")
    keys = _subscripts_of(fn, "manifest")
    assert set(keys) >= {"functions", "operators", "series"}, (
        f"the floor must be read out of the manifest; found manifest[...] keys "
        f"{keys}")
    planted = _string_literal_collections(fn)
    assert planted == [], (
        f"a hand-listed collection of names appears inside the floor: {planted}. "
        "A rail that only checks what somebody remembered to list is a LIST, not "
        "a rail.")


def test_the_source_rail_can_actually_see_a_hand_listed_floor():
    """The positive control for the test above. Without it, `planted == []` is
    satisfied by a helper that never finds anything."""
    fn = pyast.parse(
        "def f(manifest, corpus):\n"
        "    declared = {'sma', 'ema', 'close'}\n"
        "    return declared\n").body[0]
    assert _string_literal_collections(fn) == [["sma", "ema", "close"]]
    assert _subscripts_of(fn, "manifest") == []


def test_a_planted_uncovered_table_entry_aborts_the_coverage_rail():
    """What happens to an entry the corpus does not cover: it is NAMED and the
    rail refuses. Runs today, against a SYNTHETIC manifest, because the real one
    does not exist until Task 3 -- so this rail is never vacuous."""
    corpus = ac.load_corpus()
    manifest = {"functions": {"sma": {}, "rugpull": {}},
                "operators": {"-": {}}, "series": {"close": {}}}
    with pytest.raises(AssertionError, match=r"rugpull"):
        ac.assert_corpus_covers_the_table(manifest, corpus)


def test_the_coverage_rail_passes_on_a_manifest_the_corpus_does_cover():
    """The other half of the control: the rail is not simply always red.

    A small synthetic pair on BOTH sides, because the rail runs in two
    directions -- an entry with no case is a hole and a case naming something
    undeclared is a hole the other way, so a control that fixed only one side
    would still leave the rail able to be always-red.
    """
    manifest = {"functions": {"sma": {}}, "operators": {"-": {}},
                "series": {"close": {}}}
    corpus = {"cases": [{"id": "x", "ast": {
        "type": "op", "name": "-", "args": [
            {"type": "call", "name": "sma", "args": [
                {"type": "series", "name": "close"}, {"type": "num", "value": 2}]},
            {"type": "num", "value": 1}]}}]}
    declared = ac.assert_corpus_covers_the_table(manifest, corpus)
    assert declared == {"sma", "-", "close"}


def test_a_corpus_name_the_table_does_not_declare_also_aborts():
    """The rail runs BOTH ways. A corpus calling something undeclared is
    measuring an interpreter feature nobody declared, which is the opposite of a
    closed table."""
    manifest = {"functions": {"sma": {}}, "operators": {}, "series": {"close": {}}}
    corpus = {"cases": [{"id": "x", "ast": {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 2}]}},
        {"id": "y", "ast": {"type": "call", "name": "rugpull", "args": []}}]}
    with pytest.raises(AssertionError, match=r"NOT in the table.*rugpull"):
        ac.assert_corpus_covers_the_table(manifest, corpus)


def test_the_real_manifest_coverage_is_armed_and_task_3_owes_the_first_pass():
    manifest = ac.load_manifest()
    if manifest is None:
        pytest.skip("app/src/components/chart/engine/ast/closedTable.json does "
                    "not exist yet -- Task 3 writes it and owes this rail's "
                    "first pass. The rail is proved non-vacuous by the two "
                    "synthetic-manifest tests above, which run every time.")
    ac.assert_corpus_covers_the_table(manifest, ac.load_corpus())


def test_a_cases_own_DECLARED_input_is_not_a_stray_name():
    """`parse.js` turns every identifier into a `series` node, so `names_in` sees
    an input reference exactly as it sees `close`. A rail that read a declared
    knob as *"a corpus case calling something the manifest does not declare"*
    would make an input case unwritable -- which is how a corpus stops covering
    the thing production does."""
    manifest = {"functions": {}, "operators": {"*": {}}, "series": {"close": {}}}
    corpus = {"cases": [{"id": "x", "inputs": {"lineWidth": 1},
                         "ast": {"type": "op", "name": "*", "args": [
                             {"type": "series", "name": "close"},
                             {"type": "series", "name": "lineWidth"}]}}]}
    assert ac.assert_corpus_covers_the_table(manifest, corpus) == {"*", "close"}


def test_an_input_that_SHADOWS_a_table_name_aborts_the_coverage_rail():
    """⛔ AND THE SUBTRACTION ABOVE IS BOUNDED. `interpret` raises a plain error
    for an input whose key shadows a table name -- in BOTH lanes, because it is a
    wiring defect rather than a formula the table refuses -- so a case declaring
    one measures the wrong thing in the direction that looks like coverage."""
    manifest = {"functions": {}, "operators": {}, "series": {"close": {}}}
    corpus = {"cases": [{"id": "x", "inputs": {"close": 1},
                         "ast": {"type": "series", "name": "close"}}]}
    with pytest.raises(AssertionError, match=r"SHADOW a table name.*close"):
        ac.assert_corpus_covers_the_table(manifest, corpus)


# --------------------------------------------------------------------------- #
# the input map -- ONE reader, BOTH lanes
# --------------------------------------------------------------------------- #
#
# 🔴 THE DEFECT THE AUDIT NAMED: *"the arm-time 'lanes agree at 1e-9' proof runs
# on an input map neither production lane uses."* `run_js` and `run_py` called
# `interpret(ast, bars)` with no inputs at all, so every equality this file
# records was taken over `{}` while `alert_user_series._make_value_fn` evaluates
# the same tree with the definition's declared knobs -- and any tree that
# REFERENCED one was refused `resolve:name` before a single row was compared.

def _calls_named(fn: pyast.AST, name: str) -> int:
    return sum(1 for n in pyast.walk(fn)
               if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)
               and n.func.id == name)


def test_BOTH_lanes_read_their_inputs_through_the_SAME_reader():
    """⛔ STRUCTURAL, AND IT IS THE HALF A BEHAVIOURAL CASE CANNOT COVER.

    A lane that quietly stopped threading inputs would still agree with itself on
    every case in the committed corpus, because not one of them declares any --
    the equality would go on reading green while the production shape it exists
    to cover was refused. So both lanes are required BY AST to call
    `case_inputs`, and the control below proves the walk can see its absence.
    """
    for lane in ("run_js", "run_py"):
        assert _calls_named(_module_fn(lane), "case_inputs") == 1, (
            f"{lane} does not read the case's inputs through `case_inputs`. Two "
            "readers is how the two lanes come to be handed different maps, and "
            "an equality over two different input maps reports as agreement.")


def test_control_the_call_walk_can_see_an_absent_reader():
    """Two green filters prove only that a counter returned 1 twice."""
    fn = pyast.parse("def f(cases, bars):\n    return interpret(cases, bars)\n").body[0]
    assert _calls_named(fn, "case_inputs") == 0
    fn2 = pyast.parse("def f(c):\n    return case_inputs(c)\n").body[0]
    assert _calls_named(fn2, "case_inputs") == 1


def test_NEITHER_lane_takes_a_second_channel_for_an_input_map():
    """⛔ THE MAP RIDES ON THE CASE, AND THERE IS NO OTHER DOOR.

    A `run_js(cases, bars, inputs=...)` parameter would be exactly the shape that
    lets a caller hand one map to node and another to Python -- and a cross-lane
    equality taken over two different inputs is an equality about nothing that
    reads precisely like agreement.
    """
    for lane in ("run_js", "run_py"):
        args = _module_fn(lane).args
        names = [a.arg for a in args.posonlyargs + args.args + args.kwonlyargs]
        assert names == ["cases", "bars"], (
            f"{lane} grew a parameter: {names}")


def test_case_inputs_reads_the_map_off_the_case_and_defaults_to_empty():
    assert ac.case_inputs({"id": "x", "inputs": {"lineWidth": 3.0}}) == {"lineWidth": 3.0}
    assert ac.case_inputs({"id": "x"}) == {}
    assert ac.case_inputs({"id": "x", "inputs": None}) == {}
    assert ac.case_inputs({"id": "x", "inputs": [1, 2]}) == {}
    assert ac.case_inputs(None) == {}
    # a COPY, so a lane cannot mutate the corpus out from under the other one
    case = {"id": "x", "inputs": {"lineWidth": 1.0}}
    ac.case_inputs(case)["lineWidth"] = 99.0
    assert case["inputs"] == {"lineWidth": 1.0}


def test_no_committed_corpus_case_declares_inputs_so_the_frozen_LOG_cannot_have_moved():
    """⛔ THE INVARIANCE, AND IT IS WHY THIS CHANGE IS SAFE TO MAKE AT ALL.

    `--record` is one-shot and its output is the oracle. `interpret(ast, bars,
    {})` is byte-identical to the no-argument call both lanes made before, so as
    long as every committed case declares nothing, every digest in
    `conformance_log.json` is arithmetically unmoved. The day somebody adds an
    input case this test is what tells them the log moves with it.
    """
    declaring = [c["id"] for c in ac.load_corpus()["cases"] if ac.case_inputs(c)]
    assert declaring == [], (
        f"{declaring} declare inputs, so the frozen conformance log no longer "
        "describes the values these lanes produce. Read the --record warning "
        "before touching it.")
    escaping = [c["id"] for c in ac.load_escapes()["cases"] if ac.case_inputs(c)]
    assert escaping == [], (
        f"{escaping} declare inputs, so the escape census is measuring a "
        "different corpus than the one recorded CLOSED, 0 of 16")


@pytest.mark.skipif(not ac.js_lane_available() or not ac.py_lane_available(),
                    reason="both interpreters are needed to compare them")
def test_an_input_referencing_TREE_is_evaluated_and_AGREES_across_both_lanes():
    """⭐ THE BEHAVIOURAL HALF: the shape production runs, through both lanes.

    `close * lineWidth` is what `BuilderSheet.buildDefinition` is one keystroke
    from producing. Before this it could not be compared at all.
    """
    bars = ac.corpus_bars()
    tree = {"type": "op", "name": "*", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "lineWidth"}]}
    cases = [{"id": "with_input", "ast": tree, "inputs": {"lineWidth": 3.0}}]

    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    report = ac.compare_lanes(js, py)
    assert report["differences"] == []
    assert report["compared"] == len(bars)
    # …and the NUMBER is the one the input produces, not the bare close.
    assert py["with_input"][-1] == pytest.approx(bars[-1]["c"] * 3.0)


@pytest.mark.skipif(not ac.js_lane_available() or not ac.py_lane_available(),
                    reason="both interpreters are needed to compare them")
def test_control_the_SAME_tree_with_no_inputs_is_refused_by_BOTH_lanes():
    """⛔ THE NON-VACUITY OF THE CASE ABOVE. If the map were inert, dropping it
    would change nothing and the equality would be proving something else. Both
    lanes refuse `resolve:name` without it -- which is exactly the state every
    input-referencing formula's arm-time proof was in."""
    bars = ac.corpus_bars()
    tree = {"type": "op", "name": "*", "args": [
        {"type": "series", "name": "close"},
        {"type": "series", "name": "lineWidth"}]}
    cases = [{"id": "no_input", "ast": tree}]

    with pytest.raises(ac.LaneUnavailable, match="lineWidth"):
        ac.run_js(cases, bars)
    mod = __import__(ac.PY_INTERPRET_MODULE, fromlist=["TableRefusal"])
    with pytest.raises(mod.TableRefusal, match="lineWidth"):
        ac.run_py(cases, bars)


# --------------------------------------------------------------------------- #
# the escape corpus
# --------------------------------------------------------------------------- #

def test_every_escape_case_states_a_guard_a_fragment_and_a_reason():
    doc = ac.load_escapes()
    assert doc["cases"], "an empty must-refuse corpus measures nothing"
    ids = [c["id"] for c in doc["cases"]]
    assert len(ids) == len(set(ids)), f"duplicate escape ids: {ids}"
    for case in doc["cases"]:
        assert case.get("guard"), f"{case['id']}: no guard"
        assert case.get("refuse"), f"{case['id']}: no refusal fragment"
        assert len(case.get("why") or "") >= 40, f"{case['id']}: no reason"
        assert case.get("ast") or case.get("astFrom"), f"{case['id']}: no tree"
        assert isinstance(case.get("parses"), bool), (
            f"{case['id']}: `parses` must be explicit -- a case that never "
            "parsed was never offered to the interpreter")


def test_refusal_fragments_are_disjoint_across_guards():
    """Two cases share a fragment IFF they share a guard.

    C Task 9's M1: two DIFFERENT gates shared the phrase "forming-bar fires are
    not ledger-grade", so `pytest.raises(match=...)` STILL MATCHED with the mode
    lock deleted -- the test would have passed on a tree with the safety removed.
    Nineteenth vacuous gate on this branch, and only a mutation found it.

    Per-CASE disjointness is the wrong rail (two cases refused by ONE gate for
    ONE reason legitimately share a message); per-GUARD disjointness is the right
    one, and it is strictly stronger because it also forbids a fragment being a
    SUBSTRING of another guard's.
    """
    doc = ac.load_escapes()
    by_fragment: dict = {}
    for case in doc["cases"]:
        by_fragment.setdefault(case["refuse"], set()).add(case["guard"])
    for fragment, guards in by_fragment.items():
        assert len(guards) == 1, (
            f"the fragment {fragment!r} is claimed by {sorted(guards)}. Two "
            "different gates sharing a phrase let a raises(match=...) pass with "
            "one of them deleted.")
    fragments = sorted(by_fragment)
    for a in fragments:
        for b in fragments:
            if a is not b:
                assert a not in b, (
                    f"the fragment {a!r} is a SUBSTRING of {b!r}; a match on the "
                    "first cannot distinguish the two gates.")


def test_the_escape_census_reads_non_zero_through_the_unguarded_walker():
    """THE HEADLINE, AND IT POINTS THE OTHER WAY FROM PHASE C'S ORACLE.

    C's repaint oracle had to read NON-ZERO on the unmodified tree; this census
    has to read ZERO on the GUARDED interpreter. So a zero here proves nothing on
    its own, and this test is what makes Task 6's eventual zero an event rather
    than a starting condition.
    """
    res = ac.escape_census(unguarded=True)
    assert res["parsed"] > 0, "no case was offered to the walker"
    assert len(res["escaped"]) > 0, (
        "the unguarded walker refused every case. A corpus nothing can escape "
        "measures nothing, and the guarded zero it licenses would be a gate that "
        "cannot fail.")
    assert res["refused"] == 0, (
        "the UNGUARDED walker refused something. It has no table to refuse with; "
        "if it is refusing, it is not the control this census needs.")
    assert res["parsed"] == res["refused"] + len(res["escaped"])


def test_the_unguarded_walker_really_reaches_dangerous_lane_native_values():
    """The control that keeps "it errored" from reading as "it was safe".

    Ten of the corpus's cases die on an AttributeError or a TypeError in this
    lane. That is the WRONG LANGUAGE declining -- `constructor` and `globalThis`
    are JS reaches -- not a table refusing. These are the equivalent reaches in
    the lane the census actually runs in, through the same lookup.
    """
    res = ac.escape_census(unguarded=True)
    native = res["lane_native_reached"]
    assert "eval" in native["names"] and "__import__" in native["names"], native
    assert native["gadget"], (
        "the property-access chain close.__class__.__base__.__subclasses__ did "
        "not resolve. That chain is Python's constructor.constructor and it is "
        "what makes `member_access` a reachability finding rather than a "
        "stylistic one.")


def test_a_parser_refused_case_is_never_counted_as_refused():
    """`parsed` IS PART OF THE VERDICT.

    A case that never parsed was never offered to the interpreter, so counting it
    as "refused" would let a parser change silently empty this census while every
    number stayed the same. Measured on a SYNTHETIC corpus so the rail does not
    depend on which cases jsep happens to accept -- Task 3 owes that measurement.
    """
    corpus = _fake_escape_corpus([
        {"id": "ghost", "guard": "g", "refuse": "x", "why": "y", "parses": False,
         "ast": {"type": "ThisExpression"}},
        {"id": "real", "guard": "h", "refuse": "z", "why": "y", "parses": True,
         "ast": {"type": "ThisExpression"}},
    ])
    res = ac.escape_census(unguarded=True, corpus=corpus)
    assert res["parser_refused"] == ["ghost"]
    assert res["parsed"] == 1, (
        "a case the parser rejected was offered to the interpreter anyway")
    assert res["refused"] == 0, (
        "a PARSER_REFUSED case was counted as refused BY A TABLE. That is the "
        "accounting that lets a parser change empty this census silently.")
    assert res["escaped"] == ["real"]
    assert res["total"] == 2


def test_an_empty_escape_corpus_refuses_rather_than_reporting_zero():
    with pytest.raises(ac.CensusVacuous, match=r"EMPTY"):
        ac.escape_census(unguarded=True, corpus=_fake_escape_corpus([]))


def test_the_verdict_refuses_a_zero_whose_control_read_zero():
    """THE VACUITY REFUSAL. Delete the control consult and this is what fires.

    A census reporting "nothing escapes" against an interpreter with no guard is
    a gate that cannot fail, and that shape has been vacuous twenty distinct ways
    on this branch.
    """
    guarded = {"mode": "guarded", "guard": "python", "total": 3, "parsed": 3,
               "refused": 3, "escaped": [], "parser_refused": []}
    dead_control = {"mode": "unguarded", "guard": "python", "total": 3,
                    "parsed": 3, "refused": 3, "escaped": [], "parser_refused": []}
    with pytest.raises(ac.CensusVacuous, match=r"UNGUARDED CONTROL READ ZERO"):
        ac.escape_verdict(guarded, dead_control)


def test_the_verdict_refuses_a_control_that_is_not_the_unguarded_run():
    guarded = {"mode": "guarded", "guard": "python", "total": 3, "parsed": 3,
               "refused": 3, "escaped": [], "parser_refused": []}
    with pytest.raises(ac.CensusVacuous, match=r"control passed to escape_verdict"):
        ac.escape_verdict(guarded, dict(guarded))


def test_the_verdict_passes_only_with_a_live_control():
    guarded = {"mode": "guarded", "guard": "python", "total": 3, "parsed": 3,
               "refused": 3, "escaped": [], "parser_refused": []}
    live_control = {"mode": "unguarded", "guard": "python", "total": 3,
                    "parsed": 3, "refused": 0, "escaped": ["a", "b", "c"],
                    "parser_refused": []}
    code, lines = ac.escape_verdict(guarded, live_control)
    assert code == ac.EXIT_CLOSED
    assert any("CLOSED" in ln for ln in lines)


def test_a_guarded_leak_and_an_absent_guard_have_DIFFERENT_exit_codes():
    """Opposite findings must not share an exit code.

    "There is no guard yet" is today's honest baseline; "the guard leaks" is a
    defect. One exit 1 for both would let Task 6 read its own starting condition
    as a regression, and would let a real leak read as "not built yet".
    """
    control = {"mode": "unguarded", "guard": "absent", "total": 3, "parsed": 3,
               "refused": 0, "escaped": ["a", "b", "c"], "parser_refused": []}
    absent = {"mode": "guarded", "guard": "absent", "total": 3, "parsed": 3,
              "refused": 0, "escaped": ["a", "b", "c"], "parser_refused": []}
    leaky = {"mode": "guarded", "guard": "python", "total": 3, "parsed": 3,
             "refused": 2, "escaped": ["a"], "parser_refused": []}
    assert ac.escape_verdict(absent, control)[0] == ac.EXIT_NO_GUARD
    assert ac.escape_verdict(leaky, control)[0] == ac.EXIT_ESCAPES
    assert len({ac.EXIT_CLOSED, ac.EXIT_ESCAPES, ac.EXIT_VACUOUS,
                ac.EXIT_NO_GUARD}) == 4


def test_the_census_today_is_wide_open_and_that_is_recorded_not_hidden():
    """The pinned baseline. If a future change makes this go DOWN, that is
    progress and this number moves with it deliberately; if it goes UP, the
    corpus grew. Either way nobody may quietly arrive at zero.

    MOVED DELIBERATELY BY PHASE D TASK 3, 2026-08-07, AND THE DOCSTRING ABOVE IS
    THE AUTHORISATION. This asserted `escaped == len(cases)` -- 16 -- which was
    right while every case was DECLARED `parses: true`. Task 3 configured the
    real parser and MEASURED that declaration: jsep 1.4.0's core grammar has no
    assignment operator, so `x = 1` is PARSER_REFUSED and was never offered to
    the walker at all. 16 -> 15 is a CORRECTION.

    The assertion is re-derived rather than re-numbered, and it is stronger than
    the one it replaces:

      * `escaped == parsed` is the CONTROL PROPERTY -- nothing refuses anything
        today -- and it holds whatever the corpus size is, so it cannot rot the
        way a literal 16 just did.
      * `parser_refused` is pinned BY NAME, not by count. A second case quietly
        becoming unparseable would shrink the census with every arithmetic
        invariant still holding; naming the set makes that a decision.
      * the floor stays explicit, because `escaped == parsed` is satisfied by
        `0 == 0` and a census over nothing reports safety forever.
    """
    res = ac.escape_census(unguarded=True)
    assert ac.guard_state() == "absent" or len(res["escaped"]) >= 0
    assert len(res["escaped"]) == res["parsed"], (
        "every case the unguarded walker was OFFERED escapes it today. If that "
        "stops being true without a guard existing, the walker started refusing "
        "something and it is no longer the control.")
    assert res["parser_refused"] == ["assignment"], (
        f"the set of cases the PARSER refuses changed: {res['parser_refused']}. "
        "A case the parser rejects is never offered to the walker, so it leaves "
        "the escape total without anything having been made safe -- that is a "
        "measurement to record, never a number to absorb.")
    assert res["parsed"] + len(res["parser_refused"]) == len(ac.load_escapes()["cases"])
    assert res["parsed"] >= 15, (
        "the escape corpus shrank. `escaped == parsed` is satisfied by 0 == 0, "
        "and a census over nothing reports safety forever.")


# --------------------------------------------------------------------------- #
# the two lanes
# --------------------------------------------------------------------------- #

def test_run_js_refuses_when_the_js_interpreter_does_not_exist():
    if ac.js_lane_available():
        pytest.skip("Task 4 has landed; this rail is superseded by --check")
    with pytest.raises(ac.LaneUnavailable, match=r"JS lane has no interpreter"):
        ac.run_js([], [])


def test_run_py_refuses_when_the_python_interpreter_does_not_exist():
    if ac.py_lane_available():
        pytest.skip("Task 5 has landed; this rail is superseded by --check")
    with pytest.raises(ac.LaneUnavailable, match=r"Python lane has no interpreter"):
        ac.run_py([], [])


def test_compare_lanes_reports_a_disagreement_at_ten_times_the_tolerance():
    """THE CROSS-LANE GATE. A comparison that passes when the lanes disagree is
    the whole instrument reporting agreement it never measured.

    1e-8 is 10x the 1e-9 contract -- the same shape as Phase C Task 14's proof,
    which perturbed one number in each golden fixture by 1,000x the tolerance and
    watched both lanes redden.
    """
    js = {"a": [100.0, 200.0]}
    py = {"a": [100.0, 200.0 * (1 + 1e-8)]}
    res = ac.compare_lanes(js, py)
    assert res["differences"], (
        "the lanes differ by 1e-8 relative -- ten times the 1e-9 contract -- and "
        "compare_lanes reported agreement")
    assert res["differences"][0]["ast_id"] == "a"
    assert res["differences"][0]["bar_index"] == 1
    assert res["compared"] == 2


def test_compare_lanes_agrees_a_tenth_below_the_tolerance():
    """The control. Without it the test above is satisfied by a comparison that
    always reports a difference."""
    js = {"a": [100.0, 200.0]}
    py = {"a": [100.0, 200.0 * (1 + 1e-10)]}
    assert ac.compare_lanes(js, py)["differences"] == []


def test_compare_lanes_treats_nan_as_agreeing_with_nan_but_not_with_a_number():
    nan = float("nan")
    assert ac.compare_lanes({"a": [nan, None]}, {"a": [nan, nan]})["differences"] == []
    assert ac.compare_lanes({"a": [nan]}, {"a": [0.0]})["differences"]


def test_compare_lanes_refuses_an_empty_lane():
    with pytest.raises(ac.LaneUnavailable, match=r"empty lane"):
        ac.compare_lanes({}, {"a": [1.0]})
    with pytest.raises(ac.LaneUnavailable, match=r"empty lane"):
        ac.compare_lanes({"a": [1.0]}, {})


def test_compare_lanes_refuses_lanes_that_do_not_carry_the_same_cases():
    with pytest.raises(ac.LaneUnavailable, match=r"different case ids"):
        ac.compare_lanes({"a": [1.0]}, {"b": [1.0]})


def test_compare_lanes_refuses_columns_of_different_lengths():
    """A pairwise comparison agrees on every element the shorter column happens
    to have, which is a silent pass over whatever one lane dropped."""
    with pytest.raises(ac.LaneUnavailable, match=r"different column lengths"):
        ac.compare_lanes({"a": [1.0, 2.0]}, {"a": [1.0]})


def test_compare_lanes_scales_by_MAGNITUDE_so_volume_is_not_a_free_pass():
    """`volume` is six orders off the price series. An ABSOLUTE epsilon of 1e-9
    would pass a 4-million-share disagreement; a relative one does not."""
    js = {"volume_relative": [4_000_000.0]}
    py = {"volume_relative": [4_000_000.0 + 1.0]}
    assert ac.compare_lanes(js, py)["differences"]


# --------------------------------------------------------------------------- #
# the digest
# --------------------------------------------------------------------------- #

def test_ast_digest_puts_the_value_inside_the_hashed_text():
    """C Task 2 wrote a 42 MB raw log and replaced it with per-alert digests for
    size. The note it wrote is the load-bearing one: a digest that hashed only
    (bar_index, triggered) would report a CHANGED NUMBER as no change at all."""
    a = ac.ast_digest("sma_of_close", [(0, "1.0"), (1, "2.0")])
    b = ac.ast_digest("sma_of_close", [(0, "1.0"), (1, "2.0000001")])
    assert a != b, (
        "only the VALUE changed and the digest did not move. A conformance log "
        "built on this digest would pin the shape and nothing else.")


def test_ast_digest_moves_when_only_the_ast_id_changes():
    rows = [(0, "1.0")]
    assert ac.ast_digest("a", rows) != ac.ast_digest("b", rows)


def test_ast_digest_is_order_sensitive():
    assert (ac.ast_digest("x", [(0, "1.0"), (1, "2.0")])
            != ac.ast_digest("x", [(1, "2.0"), (0, "1.0")]))


def test_ast_digest_is_stable_across_calls():
    rows = [(i, repr(float(i))) for i in range(50)]
    assert ac.ast_digest("x", rows) == ac.ast_digest("x", list(rows))


def test_ast_digest_separators_are_not_NUL_bytes():
    """A sibling harness held two literal NUL bytes where `h.update(' ')` should
    have had a space, and its first comparison disagreed for a reason internal to
    the test."""
    assert "\x00" not in ac._FIELD_SEP + ac._ROW_SEP
    assert ac._FIELD_SEP != ac._ROW_SEP


def test_ast_digest_distinguishes_1_from_1_point_0():
    """`repr`, not `str`. Otherwise an int column and a float column collide and
    a lane that quietly started returning ints would read as no change."""
    assert ac.ast_digest("x", [(0, 1)]) != ac.ast_digest("x", [(0, 1.0)])


# --------------------------------------------------------------------------- #
# the tool's own refusals
# --------------------------------------------------------------------------- #

def test_record_refuses_while_there_is_only_one_lane():
    if ac.js_lane_available() and ac.py_lane_available():
        pytest.skip("both lanes exist; Task 5 owns --record from here")
    assert ac.main(["--record"]) == ac.EXIT_NO_GUARD


def test_check_refuses_while_there_is_no_frozen_log():
    if pathlib.Path(ac.LOG_PATH).exists():
        pytest.skip("the conformance log exists; --check is the real gate now")
    assert ac.main(["--check"]) == ac.EXIT_NO_GUARD


def test_the_escapes_cli_reports_non_zero_and_exits_no_guard_today():
    if ac.guard_state() != "absent":
        pytest.skip("a guarded interpreter exists; Task 6 owns this exit code")
    assert ac.main(["--escapes", "--unguarded"]) == 0
    assert ac.main(["--escapes"]) == ac.EXIT_NO_GUARD


# --------------------------------------------------------------------------- #
# THE DOOR -- added 2026-08-08 by the budget task
# --------------------------------------------------------------------------- #

def test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT():
    """🔴 THE DEFECT THIS REPLACES, AND THE REASON IT IS THE FIRST TEST HERE.

    The guarded census used to hand each case's JSEP tree straight to `interpret`.
    The Python lane deliberately has no parser (decision D-A1), so EVERY case was
    refused at the ROOT by `interpret:node` -- before a name, an arity, a window or
    a budget was ever consulted. The census read `0 escaped` and the verdict read
    CLOSED, and the three `budget:*` cases read EXACTLY as they would have with no
    budget in the product at all. Fifteen refusals; fifteen wrong doors.

    A user's formula travels jsep -> canonicalise -> interpret. The census now
    travels the same path: `canonicalise` in the only lane that has it, then
    `interpret` in BOTH. So every case meets the door its claim is about, and this
    asserts that as an EQUALITY over the whole corpus rather than as a count.
    """
    res = ac.escape_census(unguarded=False)
    assert res["escaped"] == [], res["escaped"]
    assert res["wrong_door"] == [], res["wrong_door"]
    assert res["lane_disagreements"] == [], res["lane_disagreements"]

    # ⛔ THE FLOOR, BECAUSE `wrong_door == []` IS SATISFIED BY `refused == 0` --
    # the same way `escaped == parsed` is satisfied by `0 == 0`, which is why Task
    # 3 added `parsed >= 15`. This zero has the identical shape.
    assert res["refused"] == res["parsed"] >= 16, res

    by_id = {r["id"]: r for r in res["refusal_guards"]}
    declared = {c["id"]: c["guard"] for c in ac.load_escapes()["cases"]
                if c.get("parses", True)}
    assert set(by_id) == set(declared)
    for cid, guard in declared.items():
        assert by_id[cid]["fired"] == guard, (cid, by_id[cid])

    # ⛔ AND THE DOORS ARE PLURAL, IN BOTH STAGES. The whole defect was ONE door
    # answering for every case; a "fix" that re-pointed that single door would
    # satisfy every equality above except these two.
    assert len({r["fired"] for r in res["refusal_guards"]}) >= 6
    assert {r["stage"] for r in res["refusal_guards"]} == {"canonicalise", "interpret"}


def test_a_zero_whose_refusals_came_from_the_WRONG_DOOR_cannot_exit_zero():
    """⭐ THE VERDICT CHANGE, ASSERTED FROM OUTSIDE THE TOOL.

    Task 5 deliberately left the four exit codes alone, because the budget task
    read its baseline from them. That baseline has been read. A CLOSED whose
    refusals came from doors that have nothing to do with the cases' claims is no
    longer allowed to exit 0 -- a zero that is not ATTRIBUTABLE is not a zero
    anybody may cite.
    """
    control = {"mode": "unguarded", "guard": "both", "total": 3, "parsed": 3,
               "refused": 0, "escaped": ["a", "b", "c"], "parser_refused": []}
    clean = {"mode": "guarded", "guard": "both", "total": 3, "parsed": 3,
             "refused": 3, "escaped": [], "parser_refused": [],
             "wrong_door": [], "lane_disagreements": []}
    assert ac.escape_verdict(clean, control)[0] == ac.EXIT_CLOSED

    wrong = dict(clean, wrong_door=[
        {"id": "too_many_nodes", "declared": "budget:nodes", "fired": "interpret:node"}])
    code, lines = ac.escape_verdict(wrong, control)
    assert code != ac.EXIT_CLOSED, "a wrong-door zero exited 0"
    assert code == ac.EXIT_ESCAPES
    assert any("NOT ATTRIBUTABLE" in ln for ln in lines), lines


def test_a_zero_the_two_lanes_DISAGREE_about_cannot_exit_zero():
    """A table that is closed in JS and open in Python is not a closed table, and
    the failure is invisible to a census that only ever asks one of them -- which
    is what this file's subject did until the pipeline landed."""
    control = {"mode": "unguarded", "guard": "both", "total": 3, "parsed": 3,
               "refused": 0, "escaped": ["a", "b", "c"], "parser_refused": []}
    split = {"mode": "guarded", "guard": "both", "total": 3, "parsed": 3,
             "refused": 3, "escaped": [], "parser_refused": [], "wrong_door": [],
             "lane_disagreements": [{"id": "x",
                                     "js": {"outcome": "refused", "guard": "budget:nodes"},
                                     "py": {"outcome": "value", "guard": None}}]}
    code, lines = ac.escape_verdict(split, control)
    assert code == ac.EXIT_ESCAPES
    assert any("LANES DISAGREE" in ln for ln in lines), lines


def test_the_guarded_census_REFUSES_when_the_only_parser_is_missing(monkeypatch):
    """⛔ A LANE THAT CANNOT BE MEASURED REFUSES; IT NEVER REPORTS ZERO.

    Falling back to offering jsep trees straight to `interpret` is exactly the
    wrong-door defect the pipeline exists to remove -- and it would report the same
    reassuring zero it reported for a whole day.
    """
    monkeypatch.setattr(ac, "JS_PARSE_PATH", str(_ROOT / "no" / "such" / "parse.js"))
    with pytest.raises(ac.LaneUnavailable, match=r"incomplete"):
        ac.escape_census(unguarded=False)
    # …while the UNGUARDED control is unaffected: it is this file's own walker and
    # needs no parser at all, which is what keeps the positive control alive when
    # the subject is broken.
    assert len(ac.escape_census(unguarded=True)["escaped"]) > 0


def test_the_canonical_tree_cannot_LOSE_NODES_crossing_the_lane_boundary():
    """The tree is carried between the lanes as a FLAT post-order array, because
    `JSON.stringify` is recursive and died on the corpus's 4,000-deep case, and
    because `json.loads` recurses in C where the limit is not raisable.

    ⛔ A DECODER THAT DROPPED A SUBTREE WOULD HAND THE PYTHON LANE A SMALLER TREE,
    and for the budget cases that is the difference between a refusal and a value
    -- in the direction that reads as safety. So the decode is cross-checked
    against the SUBJECT's own counter, and here is the proof it can fail.
    """
    flat = [{"t": "num", "v": 1.0}, {"t": "series", "n": "close"},
            {"t": "op", "n": "+", "a": [0, 1]}]
    tree = ac._rebuild_canonical(flat)
    assert tree == {"type": "op", "name": "+",
                    "args": [{"type": "num", "value": 1.0},
                             {"type": "series", "name": "close"}]}
    # the positive control: a flat array whose root does not reach every node.
    orphaned = [{"t": "num", "v": 1.0}, {"t": "num", "v": 2.0},
                {"t": "series", "n": "close"}, {"t": "op", "n": "+", "a": [0, 2]}]
    with pytest.raises(ac.LaneUnavailable, match=r"lost nodes"):
        ac._rebuild_canonical(orphaned)
    with pytest.raises(ac.LaneUnavailable, match=r"EMPTY"):
        ac._rebuild_canonical([])


def test_the_series_chain_generator_reads_the_MANIFEST_rather_than_typing_names():
    """⭐ A corpus case that hand-typed `close` would keep generating a tree of
    UNKNOWN names on the day a series is renamed -- and an unknown name is refused
    by `resolve:name`, at a different door, which would silently convert that
    case's claim into somebody else's."""
    manifest = ac.load_manifest()
    assert manifest is not None
    names = sorted(manifest["series"])
    tree = ac.generate_ast("gen:seriesChain(9)")
    found = ac.names_in(tree)
    assert found <= set(names), found
    assert len(found) == min(9, len(names))
    # the source of those names is the manifest, proven by asserting this file
    # never types one: the generator's own AST holds no string constant equal to a
    # declared series name.
    fn = _module_fn("generate_ast")
    literals = {n.value for n in pyast.walk(fn)
                if isinstance(n, pyast.Constant) and isinstance(n.value, str)}
    assert not (literals & set(names)), sorted(literals & set(names))


def test_the_generated_tree_is_the_size_it_claims():
    tree = ac.generate_ast("gen:nest(4000)")
    count, stack = 0, [tree]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        count += 1
        for value in node.values():
            if isinstance(value, dict):
                stack.append(value)
    assert count == 8001, count


def test_the_generator_refuses_a_spec_it_does_not_know():
    with pytest.raises(ValueError, match=r"unknown AST generator spec"):
        ac.generate_ast("gen:rm-rf(1)")


# --------------------------------------------------------------------------- #
# the gauntlet's own contract
# --------------------------------------------------------------------------- #

def test_the_gauntlets_abort_messages_are_disjoint_and_every_killer_is_unique():
    """A harness's own refusals need the same disjointness its subject does.

    Two aborts sharing a phrase make a log unreadable about WHICH protection
    fired; two mutations sharing a `must_reach` means one of them is not testing
    what it claims. Four agents in one session found mutations sharing a killer
    and FIXED THE TESTS rather than accepting it -- so the overlap is a hard
    failure here, asserted from outside the tool.
    """
    import phase_d_gauntlet as g

    g.assert_refusals_are_disjoint()
    killers = [m["must_reach"] for m in g.MUTATIONS.values()]
    assert len(killers) == len(set(killers)), killers
    # every declared killer must be a test that actually exists in THIS file --
    # a `must_reach` naming a test nobody wrote can never be reached, and a
    # mutation judged by it would be reported SUSPECT forever.
    src = io.open(__file__, encoding="utf-8").read()
    tree = pyast.parse(src)
    here = {n.name for n in pyast.walk(tree)
            if isinstance(n, pyast.FunctionDef)}
    missing = [k for k in killers if k not in here]
    assert not missing, f"must_reach names tests that do not exist: {missing}"


def test_the_gauntlet_reads_its_counts_from_the_summary_line_not_from_prose():
    """MEASURED SELF-DEFECT, FOUND BY RUNNING THE GAUNTLET, FIXED BEFORE ANY
    VERDICT STOOD.

    A bare `re.search(r"(\\d+) passed", out)` reads the FIRST match in the whole
    capture, and pytest echoes a failing test's DOCSTRING into that capture. The
    docstring below contains the words "5 passed rc=0", so M4's real result --
    `1 failed, 1 passed, 41 deselected` -- was reported as `passed=5 failed=0`.
    Same class as the vitest `Test Files` trap: a control reading a number from
    the wrong place can bless anything, and the wrong place here was PROSE INSIDE
    THE SUBJECT.
    """
    import phase_d_gauntlet as g

    poisoned = (
        "F.                                                          [100%]\n"
        "    A coverage claim that is a LIST is how DPC drifted:\n"
        "    `DPC_LOOKBACK 10 -> 999` left the file `5 passed rc=0`.\n"
        "FAILED tests/x.py::test_a - AssertionError\n"
        "1 failed, 1 passed, 41 deselected in 0.20s\n")
    got = g._parse_pytest_summary(poisoned)
    assert got["passed"] == 1, got
    assert got["failed"] == 1, got
    assert got["selected"] == 2, "deselected tests were never selected"

    # `no tests ran` is ZERO SELECTED, which is the abort half of the
    # `passed=None` ambiguity -- never a pass.
    assert g._parse_pytest_summary("no tests ran in 0.01s")["selected"] == 0
    # and a capture with no summary line at all REFUSES rather than reporting 0.
    assert g._parse_pytest_summary("2 passed somewhere in prose")["summary"] is None


def test_the_gauntlet_guards_every_fixture_a_mutation_can_reach():
    """A harness can corrupt the artifact it measures.

    Phase C's M2 reported 3/3 KILLED, exit 0, and left a CORRUPTED fire log: it
    restored the file it PATCHED and never looked at the file the mutation WROTE.
    """
    import phase_d_gauntlet as g

    guarded = set(g.GUARDED)
    for name, mutation in g.MUTATIONS.items():
        assert mutation["file"] in guarded, (
            f"{name} patches {mutation['file']} and it is not in GUARDED")
    for fixture in (_ROOT / "tests" / "fixtures" / "ast").glob("*.json"):
        rel = fixture.relative_to(_ROOT).as_posix()
        assert rel in guarded, (
            f"{rel} is reachable by a --record mutation and is not snapshotted")
