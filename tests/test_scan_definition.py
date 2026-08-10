"""E-2 — the scan object: one hash, and a 0/1 test DERIVED from the manifest.

⭐ EVERY TREE IN THIS FILE WAS PRODUCED BY THE SHIPPED PARSER, and that is a
deliberate response to the design's CORRECTION 5: *"an example formula is a CLAIM
about the table and must be PARSED, not read."* Three separate corrections were
needed for one headline example — a function the table does not declare, then an
operator it does not declare — all written by the party with the most context. So
this file hand-writes no tree at all except the two SYNTHETIC probes, which are
about a planted manifest rather than about a formula.

⚠️ THE JS LANE IS NOT OPTIONAL HERE. If node cannot run, the fixture RAISES
rather than skips: a lane that never ran has not agreed with anything, and the
whole point of parsing the corpus is that nobody in this file gets to assert what
a formula means.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

import pytest

from api.services import ast_freshness
from api.services import ast_interpret
from api.services import ast_table
from api.services import scan_definition
from api.services import user_definitions

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARSE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "parse.js"

# ─── the corpus, spelled as SOURCE and parsed by the shipped parser ──────────
#
# Each entry is `(id, source, expected_is_boolean_tree)`. The expectation is the
# claim; the parser decides what the source MEANS.
CORPUS = (
    ("boolean_comparison", "close > sma(close, 20)", True),
    ("boolean_scalar_and", "rsi14 < 30 && volume > 0", True),
    ("scalar_threshold", "market_cap > 1e9", True),
    ("bool_scalar_leaf", "above_50sma", True),
    ("crossing", "crossOver(close, sma(close, 20))", True),
    ("negation", "!(close > open)", True),
    # ⭐ THE PHASE'S OWN ACCEPTANCE FORMULA, third spelling, PARSED.
    ("acceptance", "rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)", True),
    # the ternary, all four ways
    ("ternary_both_bool", "(close > open) ? (high > low) : (low > high)", True),
    ("ternary_zero_one", "(close > open) ? 1 : 0", True),
    ("ternary_mixed", "(close > open) ? 1 : close", False),
    ("ternary_both_num", "(close > open) ? close : open", False),
    # and the numbers, which are the direction that must fail closed
    ("numeric_call", "sma(close, 20)", False),
    ("numeric_scalar", "market_cap", False),
    ("numeric_add", "close + 1", False),
    ("bare_series", "close", False),
)

_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try {
        const r = await nextResolve(specifier + ext, context)
        if (r) return r
      } catch { /* fall through to the next candidate */ }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const parse = await import(pathToFileURL(payload.parse).href)

const rows = {}
for (const c of payload.cases) {
  const parsed = parse.parseFormula(c.source)
  rows[c.id] = parsed.ok
    ? { ok: true, ast: parsed.ast, hash: parse.astHash(parsed.ast) }
    : { ok: false, error: parsed.error }
}
process.stdout.write(JSON.stringify({ ok: true, rows }))
"""


class LaneUnavailable(RuntimeError):
    """The node lane could not run. ⛔ NOT A SKIP — every tree in this file comes
    from the shipped parser, so a lane that cannot run means nothing was tested."""


@pytest.fixture(scope="module")
def parsed():
    """`{id: {"ast", "hash", "source"}}` for the whole corpus, ONE node boot.

    A source that REFUSES is a failure of this fixture, not of a case: the corpus
    is a claim that these formulas are legal against the closed table, and an
    illegal one has to be found here rather than quietly skipped.
    """
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    tmpdir = tempfile.mkdtemp(prefix="scan_def_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w",
                         encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        payload = {"parse": str(PARSE_JS),
                   "cases": [{"id": i, "source": s} for i, s, _ in CORPUS]}
        proc = subprocess.run(
            [exe, os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps(payload), capture_output=True, text=True,
            encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout)[-1500:]}")
    rows = json.loads(proc.stdout)["rows"]
    out = {}
    for case_id, source, _ in CORPUS:
        row = rows[case_id]
        assert row["ok"], (
            f"{case_id}: {source!r} does not parse against the closed table — "
            f"{row.get('error')!r}. An example formula is a CLAIM about the "
            "table (design CORRECTION 5); fix the corpus, not the assertion.")
        out[case_id] = {"ast": row["ast"], "hash": row["hash"], "source": source}
    return out


def _definition(tree: dict, *, fn=None, kind="ast", def_id="u_000000000001") -> dict:
    """A schema-v1 `ast` definition around a parsed tree."""
    compute = {"kind": kind, "ast": tree}
    compute["fn"] = user_definitions.ast_hash(tree) if fn is None else fn
    if fn is False:
        compute.pop("fn")
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": "A Screen", "shortName": "SCR",
                 "repaint": "non-repainting"},
        "compute": compute,
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


# ═══ 1. identity ════════════════════════════════════════════════════════════

def test_the_scan_identity_IS_the_astHash_and_compute_fn_IS_that_hash(parsed):
    """⭐ ONE HASH, ONE HANDLE, ONE EVENT.

    `defSchema.validateAstCompute` requires an `ast` definition's `compute.fn` to
    equal its own `astHash` — "the tree is the implementation, so there is no
    third thing for the handle to name; naming it by its own hash makes 'the
    handle changed' and 'the maths changed' one event rather than two that can
    disagree." A results table keyed on it cannot serve one formula's answers
    under another's name.

    ⛔ AND THE KEY IS NOT (user_id, def_id, version). Two members who type the
    same formula have the same maths and share one result set — which is also
    what makes the store member-INDEPENDENT, the property E-6 exists to obtain.
    Asserted here by hashing the SAME tree under two different definition ids.
    """
    case = parsed["acceptance"]
    mine = _definition(case["ast"], def_id="u_000000000001")
    theirs = _definition(case["ast"], def_id="u_ffffffffffff")

    handle = scan_definition.def_hash(mine)
    assert handle == mine["compute"]["fn"]
    assert handle == scan_definition.def_hash(theirs), (
        "two members' identical formula produced two handles — the store would "
        "sweep the same maths twice and stop being member-independent")
    assert handle.startswith("sha256:") and len(handle) == 71


def test_the_python_handle_IS_the_one_the_BROWSER_computed(parsed):
    """⛔ ONE NUMBER, TWO LANES. The browser hashes the tree at save time and this
    lane hashes it at sweep time; if they ever disagreed, a member would arm a
    scan whose results are filed under a name nothing reads."""
    for case_id, row in parsed.items():
        assert user_definitions.ast_hash(row["ast"]) == row["hash"], case_id


def test_a_stored_compute_fn_that_DISAGREES_with_its_tree_is_refused(parsed):
    """A blob that arrived over a wire carrying a stale handle would file this
    formula's answers under the PREVIOUS formula's name — silently, because both
    values are well-formed sha256 strings."""
    stale = scan_definition.def_hash(_definition(parsed["numeric_call"]["ast"]))
    d = _definition(parsed["acceptance"]["ast"], fn=stale)
    with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:hash\]") as exc:
        scan_definition.def_hash(d)
    assert exc.value.gate == "hash"


# ═══ 2. the 0/1 test, and that it is DERIVED ════════════════════════════════

def test_a_scan_must_be_a_0_1_TREE_and_the_whole_parsed_corpus_agrees(parsed):
    """`closedTable._booleans` — "a condition is therefore a 0/1 column".

    ⛔ THE FAIL-CLOSED DIRECTION IS THE NUMERIC ONE and the corpus carries four
    cases in it. `sma(close, 20)` as a scan would be `<average> != 0`, true for
    every symbol trading above zero: the screen returns the universe and looks
    like a very good day.

    ⚠️ `rsi14` IS legal here and `rsi(close, 14)` is NOT (design CORRECTION 1):
    the first is a screener SCALAR read off a nightly snapshot and the second a
    per-bar FUNCTION with a user-chosen period. ⭐ BOTH ARE LEGAL AS OF PHASE F
    and they are still not the same thing: `rsi14` is one number for the whole
    column, dated by `bars_asof`, and `rsi(close, 14)` is recomputed at every
    bar off the bars in hand. This corpus stays on the scalar deliberately —
    what it measures is the boolean-tree verdict, and swapping in the function
    would change which SECTION the case exercises without changing the claim.
    """
    verdicts = {cid: scan_definition.is_boolean_tree(parsed[cid]["ast"])
                for cid, _, _ in CORPUS}
    expected = {cid: want for cid, _, want in CORPUS}
    assert verdicts == expected, {
        cid: (verdicts[cid], expected[cid])
        for cid in expected if verdicts[cid] != expected[cid]}

    with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:yields\]") as exc:
        scan_definition.assert_scannable(_definition(parsed["numeric_call"]["ast"]))
    assert exc.value.gate == "yields"


def _planted(name: str, declaration: dict) -> dict:
    """The shipped manifest with ONE extra operator, and nothing else changed."""
    return {
        ast_table.SERIES_SECTION: dict(ast_table.TABLE[ast_table.SERIES_SECTION]),
        ast_table.OPERATORS_SECTION: {
            **ast_table.TABLE[ast_table.OPERATORS_SECTION], name: declaration},
        ast_table.FUNCTIONS_SECTION: dict(ast_table.TABLE[ast_table.FUNCTIONS_SECTION]),
        ast_table.SCALARS_SECTION: dict(ast_table.TABLE[ast_table.SCALARS_SECTION]),
    }


def test_the_0_1_verdict_is_DERIVED__a_PLANTED_operator_reaches_it_with_no_edit_here():
    """⭐⭐ THE HEADLINE. A name that exists in NO hand-list is classified anyway.

    ⛔ THIS IS THE DEFECT THE PHASE-E PLAN REVIEW CAUGHT ON THE OTHER SIDE.
    `vocabulary()` — the function whose entire justification is "derived, never a
    hand-list" — hand-lists `'&&'` and `'||'`, so a RENAMED logical operator would
    silently drop out of the picker with every gate green. The same hand-list
    here would be worse: a renamed join operator would stop being recognised as a
    condition, and the scan that used it would be refused as "not a 0/1 tree" with
    no explanation a member could act on.

    Three planted probes, and the third is the sharp one:
      1. a NEW operator declared `bool` classifies as a condition;
      2. THE CONTROL — the same operator declared `num` does not, so the planted
         manifest is demonstrably being read rather than ignored;
      3. a REAL two-argument boolean operator, RE-REGISTERED UNDER A NEW NAME,
         still classifies — which is exactly what a hand-list cannot do.
    """
    args = [{"type": "num", "value": 5}, {"type": "num", "value": 7}]
    tree = {"type": "op", "name": "zzPlantedJoin", "args": args}

    assert scan_definition.is_boolean_tree(
        tree, _planted("zzPlantedJoin", {"arity": 2, "yields": "bool"})) is True
    # the control: the probe is not simply answering True for everything
    assert scan_definition.is_boolean_tree(
        tree, _planted("zzPlantedJoin", {"arity": 2, "yields": "num"})) is False

    # (3) a REAL declaration, renamed. Its name is derived, never typed.
    operators = ast_table.TABLE[ast_table.OPERATORS_SECTION]
    real = sorted(n for n, e in operators.items()
                  if e.get("yields") == "bool" and e.get("arity") == 2)
    assert real, "the manifest declares no two-argument boolean operator"
    renamed = "zzRenamedJoin"
    assert scan_definition.is_boolean_tree(
        {"type": "op", "name": renamed, "args": args},
        _planted(renamed, dict(operators[real[0]]))) is True


def test_an_operator_with_NO_yields_declaration_reads_as_num_NOT_bool():
    """⛔ FAIL CLOSED, AND THE ASYMMETRY IS THE ARGUMENT (mutation M6).

    Refusing to call a tree a scan costs a user one error message. Admitting a
    real-valued tree makes `<tree> != 0` true for every non-zero price on the
    board. So a manifest entry nobody has classified yet is a NUMBER until
    somebody says otherwise.
    """
    tree = {"type": "op", "name": "zzUndeclared",
            "args": [{"type": "num", "value": 5}, {"type": "num", "value": 7}]}
    assert scan_definition.is_boolean_tree(
        tree, _planted("zzUndeclared", {"arity": 2})) is False
    # the control: with a declaration, the very same probe answers True
    assert scan_definition.is_boolean_tree(
        tree, _planted("zzUndeclared", {"arity": 2, "yields": "bool"})) is True


def test_a_passthrough_needs_EVERY_arm_to_be_bool_not_merely_one(parsed):
    """⛔ MUTATION M11, STATED POSITIVELY.

    `?:` is the one entry with no static answer — `closedTable._yields` says
    forcing it to `num` would refuse `(a > b) ? 1 : 0` as a scan while forcing it
    to `bool` would admit `x ? price : volume` as one. So its kind is the JOIN of
    its arms, and "either arm" is not a join: `(close > open) ? 1 : close` hands
    back a price on one branch and would screen every symbol above zero.
    """
    assert scan_definition.is_boolean_tree(parsed["ternary_both_bool"]["ast"])
    assert scan_definition.is_boolean_tree(parsed["ternary_zero_one"]["ast"])
    assert not scan_definition.is_boolean_tree(parsed["ternary_mixed"]["ast"])
    assert not scan_definition.is_boolean_tree(parsed["ternary_both_num"]["ast"])


def test_a_bool_TYPED_literal_is_not_mistaken_for_a_0_1_literal():
    """⚠️ `True == 1`, `isinstance(True, int)` is True, and `True in (0, 1)` is
    True — a bool sails through every obvious numeric guard, which Phase D Task 5
    measured. A canonical tree cannot carry one (`stable_stringify` refuses it),
    so meeting one means the tree is not the persisted artifact and fail-closed
    is right."""
    assert scan_definition.is_boolean_tree({"type": "num", "value": 1}) is True
    assert scan_definition.is_boolean_tree({"type": "num", "value": True}) is False
    assert scan_definition.is_boolean_tree({"type": "num", "value": 2}) is False


# ═══ 3. no hand-list anywhere in the module ═════════════════════════════════

def _string_constants(path: pathlib.Path) -> set:
    """Every string literal in a module's source. ⛔ AN AST WALK, NEVER A GREP.

    Only a `Constant` node is a literal and only FULL EQUALITY counts, so the
    module's own docstrings — which deliberately quote formulas and operator
    names as prose — can neither satisfy nor defeat this. The plan review's
    finding 14 is the failure mode being avoided: a check that reds on a
    docstring is a check nobody can keep green.
    """
    with io.open(path, encoding="utf-8") as fh:
        tree = pyast.parse(fh.read())
    return {n.value for n in pyast.walk(tree)
            if isinstance(n, pyast.Constant) and isinstance(n.value, str)}


def test_scan_definition_SPELLS_NO_NAME_THE_TABLE_DECLARES():
    """⛔ THE STRUCTURAL HALF OF "DERIVED, NEVER HAND-LISTED".

    A hand-list necessarily spells the names; a derivation necessarily does not.
    Every declared name is in scope — the bar series, the operators, the
    functions and the scalars — and the set is read off the table rather than
    restated. ⛔ NO COUNT IN THIS DOCSTRING. It said "All 85 … eleven
    functions" and Phase F moved both halves of that sentence while the
    assertion below, which reads `declared_names()`, could not have noticed.
    """
    declared = ast_table.declared_names()
    assert declared, "the manifest declared nothing — the probe would be vacuous"
    leaked = sorted(_string_constants(
        pathlib.Path(scan_definition.__file__)) & declared)
    assert not leaked, (
        f"api/services/scan_definition.py spells {leaked} as string literals. "
        "The 0/1 verdict is derived from the manifest's `yields` declaration; a "
        "spelled operator name is a second vocabulary that rots the day one is "
        "renamed.")


def test_the_hand_list_probe_can_actually_FIND_a_hand_list():
    """The positive control. Without it the assertion above is satisfied by a
    detector that returns the empty set for everything — the `lesson_gate_that
    _cannot_fail` shape, and it reports the offender BY NAME."""
    operators = sorted(ast_table.TABLE[ast_table.OPERATORS_SECTION])
    functions = sorted(ast_table.TABLE[ast_table.FUNCTIONS_SECTION])
    src = (
        "def is_boolean_tree(tree):\n"
        f"    return tree.get('name') in ({operators[0]!r}, {functions[0]!r})\n")
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="scan_def_probe_")) / "handlist.py"
    try:
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(src)
        found = _string_constants(tmp) & ast_table.declared_names()
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    assert found == {operators[0], functions[0]}, found


# ═══ 4. the structure this module DOES spell is pinned to its declaration ═══

def test_the_node_types_this_module_branches_on_ARE_the_declared_ones():
    """The module has one case per canonical shape. Spelled here as STRUCTURE,
    pinned there as vocabulary — and a new node type lands RED right here.

    ⭐ IT DID, AND THAT IS THE RECORD OF IT WORKING. Phase F6 added the bounded
    backward offset as a fifth type and this case went red BY NAME, with the two
    sets in hand, before anything shipped. Without it `_yields_bool` would have
    asked the table for a declaration of the name `None`, settled to `num`, and
    quietly refused every offset condition at the `yields` gate — a screen told
    *"this formula is not a filter"* about a formula that plainly is.

    ⚠️ THE TITLE NO LONGER SAYS "FOUR". A count restated beside the list it
    describes is this repo's most-repeated defect, and a test name is what an
    engineer reads in a failure report."""
    branched = (scan_definition._NUM, scan_definition._SERIES,
                scan_definition._OP, scan_definition._CALL,
                scan_definition._OFFSET)
    assert set(branched) == set(ast_interpret.NODE_TYPES)
    assert len(set(branched)) == len(ast_interpret.NODE_TYPES)
    assert set(branched) == set(user_definitions.NODE_TYPES)


def test_the_result_kinds_this_module_branches_on_ARE_the_declared_three():
    """`ast_table.YIELDS` is the one declaration of what `yields` can say, and
    `YIELDS_DEFAULT` is the fail-closed answer. A fourth kind lands RED here
    rather than falling silently into this module's `else`."""
    branched = (scan_definition._KIND_NUM, scan_definition._KIND_BOOL,
                scan_definition._KIND_PASSTHROUGH)
    assert set(branched) == set(ast_table.YIELDS)
    assert ast_table.YIELDS_DEFAULT == scan_definition._KIND_NUM


# ═══ 5. the gates ═══════════════════════════════════════════════════════════

def test_the_gates_are_a_CLOSED_set_and_an_unknown_one_cannot_be_raised():
    """A caller catching `ScanRefused` branches on `.gate`; an open-ended reason
    string would be prose a surface has to pattern-match, which is how a refusal
    becomes a 500."""
    assert scan_definition.GATES == ("kind", "tree", "hash", "yields")
    for gate in scan_definition.GATES:
        assert scan_definition.ScanRefused(gate, "x").gate == gate
    with pytest.raises(ValueError, match="not one of this module's gates"):
        scan_definition.ScanRefused("vibes", "x")


def test_a_definition_that_is_not_on_the_ast_lane_is_refused_at_gate_kind(parsed):
    d = _definition(parsed["acceptance"]["ast"])
    d["compute"] = {"kind": "native", "fn": "rsi"}
    with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:kind\]") as exc:
        scan_definition.assert_scannable(d)
    assert exc.value.gate == "kind"
    for junk in (None, [], "a definition"):
        with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:kind\]"):
            scan_definition.assert_scannable(junk)


def test_a_NON_CANONICAL_tree_is_refused_at_gate_tree_and_not_silently_classified(parsed):
    """The persisted shape is the contract between the two lanes and is
    deliberately smaller than jsep's. A fifth node type reaching this far would
    be a tree the Python interpreter cannot walk."""
    d = _definition(parsed["acceptance"]["ast"])
    d["compute"]["ast"] = {"type": "member", "object": "a", "property": "b"}
    d["compute"].pop("fn")
    with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:tree\]") as exc:
        scan_definition.assert_scannable(d)
    assert exc.value.gate == "tree"


def test_assert_scannable_hands_back_the_handle_and_the_SCALARS_the_tree_reads(parsed):
    """The sweep needs to know which snapshot columns to carry, and deriving that
    a second way is how two answers to one question start."""
    out = scan_definition.assert_scannable(_definition(parsed["acceptance"]["ast"]))
    assert out["def_hash"] == parsed["acceptance"]["hash"]
    assert out["yields"] == scan_definition._KIND_BOOL
    assert out["scalars"] == sorted(
        ast_freshness.scalars_in(parsed["acceptance"]["ast"]))
    assert out["scalars"], (
        "the acceptance formula reads two screener scalars; an empty list means "
        "`scalars_in` stopped seeing them")
    # a tree of pure bar series reads no scalar at all
    assert scan_definition.assert_scannable(
        _definition(parsed["boolean_comparison"]["ast"]))["scalars"] == []


# ═══ 6. the contract symbols this task consumes ═════════════════════════════

def test_the_symbols_E2_CONSUMES_exist_and_fail_BY_NAME_if_they_moved():
    """⛔ THE PLAN'S OWN RULE, WHICH ITS REVIEW FOUND IMPLEMENTED IN ONE TASK OF
    SIX: "each consuming task carries a step that asserts the symbol exists and
    fails BY NAME if it moved". E-2 consumes five symbols written by E-1 and by
    the shipped definition store; a rename would otherwise surface as an
    AttributeError inside a sweep at 03:00.
    """
    missing = [name for name, obj in (
        ("ast_table.yields_of", getattr(ast_table, "yields_of", None)),
        ("ast_table.YIELDS", getattr(ast_table, "YIELDS", None)),
        ("ast_table.YIELDS_DEFAULT", getattr(ast_table, "YIELDS_DEFAULT", None)),
        ("ast_table.SCALARS_SECTION", getattr(ast_table, "SCALARS_SECTION", None)),
        ("ast_freshness.scalars_in", getattr(ast_freshness, "scalars_in", None)),
        ("ast_interpret.NODE_TYPES", getattr(ast_interpret, "NODE_TYPES", None)),
        ("ast_interpret._flatten", getattr(ast_interpret, "_flatten", None)),
        ("ast_interpret.TableRefusal", getattr(ast_interpret, "TableRefusal", None)),
        ("user_definitions.ast_hash", getattr(user_definitions, "ast_hash", None)),
        ("user_definitions.assert_canonical",
         getattr(user_definitions, "assert_canonical", None)),
    ) if obj is None]
    assert not missing, (
        f"E-2 consumes {missing}, which no longer exist. These are E-1's and the "
        "definition store's contract symbols; E-2 refuses rather than adapting "
        "silently.")
    # `yields` really is declared on every entry E-2 derives from — the
    # declaration, not this module, is what makes the derivation possible.
    for section in (ast_table.OPERATORS_SECTION, ast_table.FUNCTIONS_SECTION,
                    ast_table.SCALARS_SECTION):
        undeclared = sorted(n for n, e in ast_table.TABLE[section].items()
                            if e.get("yields") not in ast_table.YIELDS)
        assert not undeclared, (
            f"{section} entries {undeclared} carry no `yields`; E-1 owns that "
            "declaration and E-2 derives from it — it does not hand-list.")
