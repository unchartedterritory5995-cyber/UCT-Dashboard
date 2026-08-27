"""Both lanes evaluate the 4-tree MACD fixture identically at 1e-9, and both lanes
compute ONE `treesHash` — through the SAME conformance functions the corpus uses
(`tools/ast_conformance.py`, unedited).

⭐⭐ THE SUBJECT OF EVERY ASSERTION BELOW IS THE SHARED ARTEFACT, NOT THIS LANE.
`tests/fixtures/ast/multi_tree_parity.json` is one file both lanes read, and the
`treesHash` in it is one string both lanes must produce. That is deliberate:
`lesson_rail_the_mirror_not_just_the_lane` — a fix railed only on the side you are
thinking about leaves the twin green and unguarded, and a Python-only assertion
that `trees_hash(trees) == trees_hash(trees)` would be exactly that. So the hash
rail here runs the SHIPPED `engine/ast/trees.js` under node and compares three
values: what JS computes, what Python computes, and what the fixture pins. Any one
of the three drifting turns this file red, from either side.

⛔ AND THE CORPUS IS NOT THE PROOF. `--check` runs 103 real trees over 579 real
bars and answers *"does this real input still behave the same"*. It has never
answered *"is this layer correct"*: zero drift across 24 fixtures once coexisted
with two live mistranslations in this very lane, because no fixture happened to
contain the collision. The four trees here are real MACD; the refusal cases below
are constructed, one per rule, precisely because nobody writes them by accident.
"""
from __future__ import annotations

import io
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import ast_conformance as ac                                            # noqa: E402
from api.services import ast_interpret                                  # noqa: E402
from api.services import user_definitions as svc                        # noqa: E402
from tests.test_user_definitions import _JS_HOOK, LaneUnavailable, _node_exe  # noqa: E402

FIXTURE = _ROOT / "tests" / "fixtures" / "ast" / "multi_tree_parity.json"
TREES_JS = _ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "trees.js"


def _fixture() -> dict:
    return json.loads(io.open(FIXTURE, encoding="utf-8").read())


def _nullish(v):
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else v


# ─── the JS half of the hash rail ────────────────────────────────────────────
#
# ⛔ THE HOOK IS IMPORTED, NEVER RETYPED. `tests/test_user_definitions.py` owns the
# two customisations a bare node needs to load this repo's modules (extensionless
# specifiers, and `.json` as a module — `parse.js` imports `closedTable.json`).
# A second copy here would be a second authority over how the JS lane is loaded,
# and the day one grew a third customisation the other would quietly stop running
# the shipped file.

_TREES_HASH_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const trees = await import(pathToFileURL(payload.trees).href)

const results = []
for (const c of payload.cases) {
  try {
    // `raw` is the TEXT of a tree map, parsed HERE, so a case can carry a
    // duplicate key: JSON.parse and json.loads must resolve it the same way or
    // the two lanes hash two different maps out of one document.
    const map = c.raw !== undefined ? JSON.parse(c.raw) : c.trees
    results.push({ id: c.id, ok: true, hash: trees.treesHash(map),
                   keys: trees.assertTrees(map) })
  } catch (err) {
    results.push({ id: c.id, ok: false, error: String((err && err.message) || err) })
  }
}
process.stdout.write(JSON.stringify({ results }))
"""


def _js_trees_hash(cases: list[dict]) -> dict:
    """`{id: {"ok", "hash"|"error", "keys"?}}` from the SHIPPED `trees.js`.

    ONE node process, payload on STDIN — never a `-e` string (a formula carrying a
    double quote SPLIT under cmd.exe on this branch), and the reader is pinned
    utf-8 (a box-drawing character in a JS refusal decodes as cp1252 otherwise and
    the verdict comes back a TypeError instead of a result).
    """
    tmpdir = tempfile.mkdtemp(prefix="multi_tree_parity_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _TREES_HASH_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [_node_exe(), os.path.join(tmpdir, "driver.mjs")], cwd=str(_ROOT),
            input=json.dumps({"trees": str(TREES_JS), "cases": cases}),
            capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        for name in ("hook.mjs", "driver.mjs"):
            try:
                os.remove(os.path.join(tmpdir, name))
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
    try:
        return {r["id"]: r for r in json.loads(proc.stdout)["results"]}
    except (json.JSONDecodeError, KeyError) as exc:
        raise LaneUnavailable(
            f"the JS lane printed something that is not a result: {exc}; "
            f"stdout was {proc.stdout[:400]!r}") from exc


# ─── the columns ─────────────────────────────────────────────────────────────

def test_scanPlot_NAMES_ONE_OF_THE_TREES_and_the_tree_it_names_is_a_CONDITION():
    """⛔ THE POINTER NEITHER LANE WAS READING, RAILED IN BOTH.

    `scanPlot` is part of this fixture's PUBLISHED surface -- it names which of
    the four columns a scan screens on -- and nothing read it: not this file, not
    `trees.parity.test.js`, and not `tests/test_user_definitions_v2.py`, which
    parametrizes its own `scan` instead. So a typo, a renamed tree or a deleted
    one would leave the pointer naming nothing while every assertion in BOTH
    lanes stayed green. That is exactly the failure mode a published interface
    has: its consumer is somewhere else.

    ⭐ AND THE GUARD IS ON BOTH SIDES. `trees.parity.test.js` makes the same
    three claims against the same file. A rail added to one lane of a mirrored
    fixture leaves the twin unguarded (`lesson_rail_the_mirror_not_just_the_lane`),
    and whichever lane a future engineer consults, they believe it.
    """
    fx = _fixture()
    assert isinstance(fx["scanPlot"], str) and fx["scanPlot"], (
        "the fixture declares no `scanPlot`")
    assert fx["scanPlot"] in fx["trees"], (
        f"`scanPlot` names {fx['scanPlot']!r}, which is not one of "
        f"{sorted(fx['trees'])} — the published pointer names nothing")

    # …and the tree it names is a CONDITION, MEASURED off the column rather than
    # assumed from the name: a `scanPlot` pointed at `macd` would be a legal key
    # and still the wrong KIND of answer, because a scan screens on a yes-or-no
    # column. `== {0.0, 1.0}` carries its own non-vacuity too -- an all-null or
    # an all-0 column cannot satisfy it.
    name = fx["scanPlot"]
    bars = ac.corpus_bars({"bars": fx["bars"]})
    col = ast_interpret.interpret_trees({name: fx["trees"][name]}, bars)[name]
    assert len(col) == len(bars)
    assert set(col) == {0.0, 1.0}, (
        f"`{name}` is this fixture's scan column and it is not 0/1 over the "
        f"corpus: {sorted({repr(v) for v in col})}")


def test_the_two_lanes_agree_on_every_tree_at_1e_9():
    fx = _fixture()
    bars = ac.corpus_bars({"bars": fx["bars"]})
    cases = [{"id": k, "ast": t, "inputs": {}} for k, t in fx["trees"].items()]
    js = ac.run_js(cases, bars)
    py = {k: [_nullish(v) for v in col]
          for k, col in ast_interpret.interpret_trees(fx["trees"], bars).items()}
    res = ac.compare_lanes(js, py)
    assert res["cases"] == 4
    assert res["compared"] == 4 * len(bars)
    assert res["differences"] == [], res["differences"][:5]


def test_the_lanes_agree_on_a_tree_that_is_NOT_COMPUTABLE_on_every_bar():
    """⚠️ THE ADVERSARIAL COLUMN, AND WHY IT IS NOT REDUNDANT WITH THE CORPUS.

    `close / (close - close)` is not computable on ANY bar, so both lanes print an
    all-null column — and two lanes agreeing on all-null is the cheapest false
    positive there is. The discriminator is the SECOND tree, and what it MEASURES
    is not what a reviewer would guess: the comparison is taken on the raw IEEE
    `+Infinity`, BEFORE the boundary that collapses it to the pad, so `that > 0`
    reads 1.0 on every bar in BOTH lanes — a formula that draws nothing and
    screens everything. The guard is invisible in the column and decisive in the
    comparison (this lane measured the same shape on `bop`'s finite guard, whose
    deletion left the column byte-identical and flipped `bop(3) > 0` on 4 of 8
    bars). A lane that answered `NaN` or `0` for the division instead of
    `Infinity` would leave the FIRST column byte-identical and move this one.
    """
    fx = _fixture()
    bars = ac.corpus_bars({"bars": fx["bars"]})
    zero = {"type": "op", "name": "-", "args": [{"type": "series", "name": "close"},
                                                {"type": "series", "name": "close"}]}
    div = {"type": "op", "name": "/", "args": [{"type": "series", "name": "close"}, zero]}
    trees = {"nan": div,
             "cmp": {"type": "op", "name": ">", "args": [div, {"type": "num", "value": 0}]}}
    cases = [{"id": k, "ast": t, "inputs": {}} for k, t in trees.items()]
    js = ac.run_js(cases, bars)
    py = {k: [_nullish(v) for v in col]
          for k, col in ast_interpret.interpret_trees(trees, bars).items()}
    res = ac.compare_lanes(js, py)
    assert res["compared"] == 2 * len(bars)
    assert res["differences"] == [], res["differences"][:5]
    assert py["nan"] == [None] * len(bars)         # the artifact: inert
    assert py["cmp"] == [1.0] * len(bars)          # the comparison: universal
    assert js["cmp"] == py["cmp"]                  # …and the browser reads it the same way


# ─── the hash ────────────────────────────────────────────────────────────────

def test_the_fixture_hash_is_the_one_BOTH_LANES_produce():
    """Three values, one string: the browser's, this lane's, and the pinned one."""
    fx = _fixture()
    py = svc.trees_hash(fx["trees"])
    js = _js_trees_hash([{"id": "macd4", "trees": fx["trees"]}])["macd4"]
    assert js["ok"] is True, js.get("error")
    assert js["hash"] == py == fx["treesHash"]
    assert js["keys"] == sorted(fx["trees"]) == ["hist", "hist_up", "macd", "signal"]


def test_both_lanes_hash_the_SAME_MAP_out_of_a_document_with_a_DUPLICATE_KEY():
    """⛔ ADVERSARIAL, AND UNREACHABLE FROM ANY FIXTURE. JSON permits a repeated
    key and no schema can see it after parsing: `JSON.parse` and `json.loads` both
    keep the LAST occurrence, so both lanes must hash the *last* tree under that
    key. If one lane ever kept the first, two stores would file one document under
    two identities and nothing else in this repo would notice."""
    fx = _fixture()
    dup_text = json.dumps({"macd": fx["trees"]["signal"], "signal": fx["trees"]["signal"]})
    # the same text, but with `macd` written twice — first the signal tree, then
    # the real one. Last-wins makes this the canonical 2-tree map.
    raw = ('{"macd": ' + json.dumps(fx["trees"]["signal"])
           + ', "macd": ' + json.dumps(fx["trees"]["macd"])
           + ', "signal": ' + json.dumps(fx["trees"]["signal"]) + '}')
    py_dup = svc.trees_hash(json.loads(raw))
    py_last = svc.trees_hash({"macd": fx["trees"]["macd"], "signal": fx["trees"]["signal"]})
    py_first = svc.trees_hash(json.loads(dup_text))
    assert py_dup == py_last, "json.loads must keep the LAST occurrence"
    assert py_dup != py_first, "…and the two readings really are different hashes"
    js = _js_trees_hash([{"id": "dup", "raw": raw}])["dup"]
    assert js["ok"] is True, js.get("error")
    assert js["hash"] == py_dup


@pytest.mark.parametrize("case_id, payload, fragment", [
    ("empty", {}, "compute.trees"),
    ("array", [], "compute.trees"),
    ("null", None, "compute.trees"),
    ("badkey", {"1bad": {"type": "num", "value": 1}}, "compute.trees"),
    ("noncanonical", {"a": {"type": "num", "value": 1}, "b": {"type": "num", "value": 1, "x": 2}},
     "compute.trees.b"),
])
def test_both_lanes_refuse_the_SAME_tree_maps_by_the_SAME_field_path(case_id, payload, fragment):
    """⭐ THE MIRROR, NOT THE LANE. Each row is a map the browser refuses; this
    asserts the browser still refuses it AND that Python refuses it AND that both
    sentences lead with the same field path a member would read. A Python-only
    version of this test is green on a Python-only fix."""
    js = _js_trees_hash([{"id": case_id, "trees": payload}])[case_id]
    assert js["ok"] is False, f"the JS lane accepted {payload!r}"
    assert fragment in js["error"], js["error"]
    with pytest.raises(ValueError) as exc:
        svc.trees_hash(payload)
    assert fragment in str(exc.value), str(exc.value)


def test_a_ONE_KEY_map_is_hashable_in_BOTH_lanes_and_refused_by_NEITHER_hasher():
    """The rule that is NOT the hasher's, held in both lanes so it cannot migrate
    into one by accident. `assertTrees`/`_assert_trees` accept a one-key map;
    `defSchema.validateTrees` and `user_definitions.validate_v2` are what refuse
    it, because a one-key map is a second spelling of a v1 document. Moving the
    rule down into the hasher would make `trees_hash` refuse a map the browser
    hashes, and the two identities would disagree about a legal input."""
    fx = _fixture()
    one = {"macd": fx["trees"]["macd"]}
    js = _js_trees_hash([{"id": "one", "trees": one}])["one"]
    assert js["ok"] is True, js.get("error")
    assert js["hash"] == svc.trees_hash(one)
