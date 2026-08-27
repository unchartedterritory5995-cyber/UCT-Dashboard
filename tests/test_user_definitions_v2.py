"""Definition v2 on the Python lane: the store validates what `defSchema` validates,
`def_hash` does not move, every plot has its own tree, and the alert seam reads it.

⭐ THE ONE SENTENCE. A multi-plot definition ADDS `compute.trees` / `treesHash` /
`scanPlot` / `sources`; `compute.ast` stays the SCAN tree, so `compute.fn`,
`scan_definition.def_hash` and every `scan_hits` key are byte-identical to what they
were before this file existed. The additive half is `treesHash`, and the browser
already pinned one string for it — this lane must reproduce that string, never
choose its own.

⛔ THE CORPUS CANNOT SEE MOST OF WHAT IS BELOW. `tools/ast_conformance.py --check`
answers *"does this real input still behave the same"* over 103 real trees; it never
answers *"is this layer correct"*. Every rule `validate_v2` holds is reachable only
by an input NOBODY WOULD WRITE — an empty tree map, one tree, two plots with one
key, a source that names no tree, a scan tree that yields a number. Those are
constructed here on purpose, one per rule, because a fixture drawn from real usage
contains none of them (`lesson_a_corpus_is_blind_beside_what_it_measures`).
"""
from __future__ import annotations

import copy
import io
import json
import math
from pathlib import Path

import pytest

from api.services import alert_rev_migration as rev
from api.services import alert_user_series as aus
from api.services import ast_interpret, ast_lint, scan_definition
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "ast" / "multi_tree_parity.json"
USER = "u1"
DEF_ID = "u_0123456789ab"

# ⭐ MEASURED BEFORE `validate_v2` EXISTED, AND IT IS THE "NO HASH MOVED" PIN.
# `sma(close, 20)` is the plainest v1 tree in this repo and its `ast_hash` is the
# handle every pre-W1b definition, alert binding and `scan_hits` row is filed
# under. If the v2 work had touched `stable_stringify`, `assert_canonical` or
# `ast_hash` — the three things `def_hash` is made of — this line moves and says
# so by name. A census over all 103 corpus trees plus the 3 shipped indicator
# fixtures was taken either side of the change; this is the one row worth keeping
# in the suite forever.
V1_SMA20_HASH = "sha256:5e7eee0a190279bde33add36b4c61957919bd1f61b53de855f6bb9ba5c749186"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """The definition store — AND the alert DB the rev-migration reads.

    Verbatim `tests/test_user_definitions.py::store`, and the second half is
    load-bearing: a rev-bumping `save()` calls the force-migration, which reads
    `indicator_alerts` out of `ias._DB_PATH`. Left at its default that is the
    shared `C:\\data\\auth.db`, and six tests once passed on another suite's
    residue.
    """
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _fixture() -> dict:
    """The SHARED fixture, never a Python-authored tree.

    ⭐ THIS IS WHY PYTHON NEVER PARSES. There is exactly one parser and it is in
    JS (`engine/ast/parse.js`). `tests/fixtures/ast/multi_tree_parity.json` holds
    the four MACD trees the JS rail asserts are `parseFormula(source).ast`, so a
    tree read from here is the browser's tree by construction. Hand-writing the
    same nodes in this file would make the two lanes agree about a shape neither
    parser produced.
    """
    return json.loads(io.open(FIXTURE, encoding="utf-8").read())


def _chrome(key: str, label: str, color: str) -> list:
    return [{"key": f"{key}Color", "type": "color", "label": f"{label} colour", "default": color},
            {"key": f"{key}Width", "type": "int", "label": f"{label} width",
             "default": 1, "min": 1, "max": 4, "step": 1}]


def _v2(scan: str = "hist_up") -> dict:
    """A legal multi-tree document — the MACD the shared fixture describes."""
    fx = _fixture()
    trees = fx["trees"]
    return {
        "schemaVersion": 1, "id": DEF_ID, "version": 1,
        "compute": {"kind": "ast", "fn": svc.ast_hash(trees[scan]), "rev": 1, "ast": trees[scan],
                    "source": fx["sources"][scan], "trees": trees, "treesHash": fx["treesHash"],
                    "scanPlot": scan, "sources": dict(fx["sources"])},
        "meta": {"name": "MACD v2", "tier": "premium", "repaint": "non-repainting",
                 "freshness": "live"},
        "placement": {"target": "pane", "pane": {"height": 0.17}},
        "inputs": [{"key": "color", "type": "color", "label": "Color", "default": "#c9a84c"},
                   {"key": "lineWidth", "type": "int", "label": "Line width",
                    "default": 1, "min": 1, "max": 4, "step": 1},
                   *_chrome("signal", "Signal", "#FF9800"), *_chrome("hist", "Histogram", "#4CAF50"),
                   *_chrome("hist_up", "Signal up", "#c9a84c")],
        "plots": [{"key": "macd", "style": "line", "color": "$color", "width": "$lineWidth"},
                  {"key": "signal", "style": "line", "color": "$signalColor", "width": "$signalWidth"},
                  {"key": "hist", "style": "histogram", "color": "$histColor"},
                  {"key": "hist_up", "style": "line", "color": "$hist_upColor", "hidden": True},
                  {"key": "zero", "style": "hlines", "levels": [0]}],
    }


def _v2_scanning_a_number() -> dict:
    """A document whose scan plot is `macd` — LEGAL as a document, ILLEGAL as a scan.

    Every v2 rule holds: the alias, both hashes, the key sets, the sources. What
    fails is a different door, and that separation is the point (see the test).
    """
    fx = _fixture()
    d = _v2()
    d["compute"]["scanPlot"] = "macd"
    d["compute"]["ast"] = fx["trees"]["macd"]
    d["compute"]["fn"] = svc.ast_hash(fx["trees"]["macd"])
    d["compute"]["source"] = fx["sources"]["macd"]
    return d


def _v1() -> dict:
    """The pre-W1b document: one tree in `compute.ast`, one data plot, no v2 key."""
    d = _v2()
    for k in ("trees", "treesHash", "sources", "scanPlot"):
        d["compute"].pop(k)
    d["plots"] = [{"key": "value", "style": "line", "color": "$color"}]
    return d


def _bars(n: int = 300) -> list:
    out = []
    for i in range(n):
        c = 100 + math.sin(i / 9) * 8 + i * 0.06
        out.append({"t": 1_700_000_000 + i * 86400, "o": c - 0.3, "h": c + 0.8,
                    "l": c - 0.8, "c": c, "v": 100000})
    return out


# ── a tree the corpus does not contain: every bar is a division by zero ───────
_ZERO = {"type": "op", "name": "-", "args": [{"type": "series", "name": "close"},
                                             {"type": "series", "name": "close"}]}
NON_FINITE_TREE = {"type": "op", "name": "/", "args": [{"type": "series", "name": "close"}, _ZERO]}


# ─── the hash ────────────────────────────────────────────────────────────────

def test_the_python_trees_hash_IS_the_browsers():
    fx = _fixture()
    assert fx["treesHash"].startswith("sha256:") and fx["treesHash"] != "UNMEASURED"
    assert svc.trees_hash(fx["trees"]) == fx["treesHash"]


def test_trees_hash_is_order_independent_and_moves_with_one_tree():
    """Both halves, because either alone is satisfied by a broken hasher.

    Order-independence alone is satisfied by `lambda trees: 'sha256:' + '0' * 64`;
    sensitivity alone is satisfied by hashing `repr(trees)`, which the JS lane
    cannot reproduce and whose answer changes when a dict is rebuilt.
    """
    fx = _fixture()
    shuffled = dict(reversed(list(fx["trees"].items())))
    assert list(shuffled) != list(fx["trees"])          # the reordering really happened
    assert svc.trees_hash(shuffled) == fx["treesHash"]
    moved = copy.deepcopy(fx["trees"])
    moved["hist"] = fx["trees"]["macd"]
    assert svc.trees_hash(moved) != fx["treesHash"]


def test_trees_hash_refuses_the_shapes_assertTrees_refuses():
    """⛔ ADVERSARIAL, AND MIRRORED. `trees.js::assertTrees` refuses exactly these
    four shapes and labels every one `compute.trees`; so does this lane. The
    ONE-KEY map is deliberately NOT here: `assertTrees` allows it and
    `validateTrees` is what refuses it, so putting that rule in `_assert_trees`
    would make `trees_hash` refuse a map the browser happily hashes."""
    for bad in (None, {}, [], "trees", {"1bad": {"type": "num", "value": 1}}):
        with pytest.raises(ValueError, match="compute.trees"):
            svc.trees_hash(bad)
    one = {"only": {"type": "num", "value": 1}}
    assert svc.trees_hash(one).startswith("sha256:")     # legal HERE, refused at save


def test_a_v1_definitions_hash_did_not_move():
    """The additive claim, pinned. `compute.fn` is `ast_hash(compute.ast)` and
    `def_hash` is `compute.fn`; if v2 had touched any of the three, this moves."""
    sma20 = {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}
    assert svc.ast_hash(sma20) == V1_SMA20_HASH
    d = _v1()
    d["compute"]["ast"] = sma20
    d["compute"]["fn"] = V1_SMA20_HASH
    assert scan_definition.def_hash(d) == V1_SMA20_HASH


# ─── the store ───────────────────────────────────────────────────────────────

def test_a_v2_document_SAVES_and_the_row_carries_the_SCAN_trees_hash(store):
    d = _v2()
    row = svc.save(USER, DEF_ID, d)
    assert row["appended"] is True
    assert row["ast_hash"] == svc.ast_hash(d["compute"]["ast"]) == d["compute"]["fn"]
    assert set(row["repaint"]) == {"macd", "signal", "hist", "hist_up", "zero"}


def test_def_hash_of_a_v2_document_IS_ast_hash_of_the_scan_tree_and_it_is_scannable():
    d = _v2()
    assert scan_definition.def_hash(d) == svc.ast_hash(d["compute"]["trees"]["hist_up"]) \
        == d["compute"]["fn"]
    spec = scan_definition.assert_scannable(d)
    assert spec["yields"] == "bool"


@pytest.mark.parametrize("mutate, fragment", [
    # ⛔ THE ALIAS, PERTURBED ALONE. Swapping `compute.ast` to another tree also
    # breaks `compute.fn`, and this lane raises the FIRST sentence rather than
    # accumulating like `defSchema` does — so the naive one-line mutation is
    # green while proving nothing about the alias rule
    # (`lesson_mutations_can_cancel_each_other`: perturb ONE thing, and assert
    # the failure you meant). `fn` is repaired here so the ONLY broken rule is
    # `compute.ast == compute.trees[scanPlot]`.
    (lambda d: (d["compute"].__setitem__("ast", d["compute"]["trees"]["macd"]),
                d["compute"].__setitem__("fn", svc.ast_hash(d["compute"]["trees"]["macd"]))),
     "compute.ast: must BE compute.trees.hist_up"),
    (lambda d: d["compute"].__setitem__("scanPlot", "nope"), "compute.scanPlot"),
    (lambda d: d["compute"].__setitem__("scanPlot", None), "compute.scanPlot"),
    # the two identities
    (lambda d: d["compute"].__setitem__("treesHash", "sha256:" + "0" * 64), "compute.treesHash"),
    (lambda d: d["compute"].__setitem__("fn", "sha256:" + "f" * 64), "compute.fn"),
    # a tree
    (lambda d: d["compute"]["trees"].__setitem__("signal", {"type": "Literal", "value": 1}), "signal"),
    (lambda d: d["compute"]["trees"].__setitem__("signal", None), "signal"),
    # the key sets, in BOTH directions
    (lambda d: d["plots"].pop(1), "signal"),
    (lambda d: d["plots"].append({"key": "extra", "style": "line", "color": "$color"}), "extra"),
    # ⛔ ADVERSARIAL: two plots, ONE key. The set-vs-set comparison a reviewer
    # writes by reflex (`set(data) == set(keys)`) cannot see this at all, and the
    # two directional sentences would name the WRONG cause ("a plot with no
    # tree") for a document whose every plot has one. It gets its own sentence.
    (lambda d: d["plots"].append({"key": "macd", "style": "line", "color": "$color"}),
     "duplicate data-bearing plot key"),
    # ⛔ ADVERSARIAL: ONE tree. Legal to `assertTrees`/`trees_hash`, refused here
    # — one tree is `compute.ast`, and a one-key map is a second spelling of a
    # v1 document, which is exactly what "a v1 document is byte-identical" forbids.
    (lambda d: (d["compute"].__setitem__("trees", {"hist_up": d["compute"]["trees"]["hist_up"]}),
                d["compute"].__setitem__("treesHash", svc.trees_hash(
                    {"hist_up": d["compute"]["trees"]["hist_up"]})),
                d["compute"].__setitem__("sources", {"hist_up": d["compute"]["source"]}),
                d.__setitem__("plots", d["plots"][3:5])),
     "compute.trees: one tree is compute.ast"),
    # ⛔ ADVERSARIAL: an EMPTY tree map. `{}` is falsy, so a `compute.get("trees")`
    # branch written with `or` reads it as ABSENT and validates the document as
    # v1 — with `scanPlot`, `treesHash` and `sources` all unchecked.
    (lambda d: d["compute"].__setitem__("trees", {}), "an empty trees map names no plot"),
    # ⛔ ADVERSARIAL, AND IT IS A LANGUAGE DIFFERENCE. JS has `undefined` AND
    # `null`; Python has only `None`, so `compute.get("trees")` reads an explicit
    # null as ABSENT and would validate this as a single-tree document — then
    # refuse it at `compute.scanPlot: only a multi-tree…`, a sentence that names
    # the wrong field about a document that IS multi-tree. Presence is asked with
    # `in`, and the fragment here is deliberately the one that discriminates:
    # "compute.trees" alone is a substring of the WRONG sentence too.
    (lambda d: d["compute"].__setitem__("trees", None), "compute.trees: expected an object"),
    # sources
    (lambda d: d["compute"]["sources"].__setitem__("hist_up", "close"), "compute.sources.hist_up"),
    (lambda d: d["compute"]["sources"].__setitem__("nope", "close"), "compute.sources.nope"),
    (lambda d: d["compute"]["sources"].__setitem__("hist", ""), "compute.sources.hist"),
    (lambda d: d["compute"]["sources"].pop("hist"), "compute.sources.hist"),
    # ⛔ THESE TWO FRAGMENTS ARE DELIBERATELY THE LONG ONES. "compute.sources"
    # alone is a SUBSTRING of every sentence this block can produce, so the
    # mutation "stop requiring sources at all" SURVIVED the short fragment: the
    # document still refused, one rule further down, with a sentence naming a
    # different cause. Measured — the guard was deleted and the test stayed green.
    (lambda d: d["compute"].pop("sources"), "must carry the source text of EVERY tree"),
    (lambda d: d["compute"].__setitem__("sources", ["close"]),
     "compute.sources: expected an object of plotKey"),
])
def test_every_v2_rule_refuses_BY_NAME_at_save(store, mutate, fragment):
    """⭐ THE SUBJECT IS THE SENTENCE, NOT THE RAISE. `pytest.raises(ValueError)`
    alone is satisfied by any refusal from any door — `lesson_rail_the_sentence_
    not_just_the_guard`: three refusals in one file said something flatly false
    with green suites, because every test asserted the guard and nothing held the
    sentence. Each row names the FIELD PATH a member would read."""
    d = _v2()
    mutate(d)
    with pytest.raises(ValueError, match=fragment):
        svc.save(USER, DEF_ID, d)


def test_v2_keys_beside_NO_trees_are_refused(store):
    d = _v2()
    for k in ("trees", "treesHash", "sources"):
        d["compute"].pop(k)
    d["plots"] = d["plots"][3:4]
    with pytest.raises(ValueError, match="compute.scanPlot: only a multi-tree"):
        svc.save(USER, DEF_ID, d)


@pytest.mark.parametrize("key", ["scanPlot", "treesHash", "sources"])
def test_each_v2_key_alone_is_refused_by_its_own_name(store, key):
    """One at a time — `lesson_mutations_can_cancel_each_other`. Dropping all
    three at once and re-adding one is a different document each time; asserting
    only the three-at-once case would let two of the three rules be absent."""
    d = _v1()
    d["compute"][key] = {"a": "b"} if key == "sources" else "hist_up"
    with pytest.raises(ValueError, match=f"compute.{key}: only a multi-tree"):
        svc.save(USER, DEF_ID, d)


def test_a_single_tree_document_saves_exactly_as_before(store):
    assert svc.save(USER, DEF_ID, _v1())["appended"] is True


def test_a_tree_legal_alone_is_illegal_as_the_scan_plot(store):
    """⛔ ADVERSARIAL, AND IT SEPARATES TWO DOORS ON PURPOSE. `macd` is a perfectly
    legal tree and a perfectly legal PLOT; as a `scanPlot` it returns a NUMBER, and
    `<number> != 0` is true for every symbol trading above zero — the gate that
    stops a screen returning the universe. `validate_v2` must NOT refuse it (it is
    a valid document and a valid chart), and `assert_scannable` must."""
    d = _v2_scanning_a_number()
    svc.validate_v2(d)                                   # the document door: fine
    assert svc.save(USER, DEF_ID, d)["appended"] is True  # the store door: fine
    assert scan_definition.def_hash(d) == svc.ast_hash(_fixture()["trees"]["macd"])
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(d)              # the scan door: refused
    assert exc.value.gate == "yields"


# ─── the interpreter ─────────────────────────────────────────────────────────

def test_interpret_trees_maps_interpret_key_by_key():
    fx = _fixture()
    bars = _bars()
    cols = ast_interpret.interpret_trees(fx["trees"], bars)
    assert sorted(cols) == ["hist", "hist_up", "macd", "signal"]
    assert cols["signal"] == ast_interpret.interpret(fx["trees"]["signal"], bars)
    assert cols["signal"] != ast_interpret.interpret(fx["trees"]["macd"], bars)
    finite = 0
    for m, s, h, u in zip(cols["macd"], cols["signal"], cols["hist"], cols["hist_up"]):
        if h is None or (isinstance(h, float) and math.isnan(h)):
            continue
        finite += 1
        assert abs(h - (m - s)) < 1e-9
        assert u == (1.0 if h > 0 else 0.0)
    assert finite > 200


@pytest.mark.parametrize("bad", [{}, None, [], "trees", 3, [("a", {"type": "num", "value": 1})]])
def test_interpret_trees_refuses_a_caller_error_as_a_TypeError(bad):
    """⛔ NOT A `TableRefusal`. A refusal is a statement about the FORMULA a member
    wrote; "you handed me no trees" is a statement about the CALLER, and labelling
    it a table refusal is the wrong-door defect this phase has now found four
    times — a member would be shown their formula was rejected."""
    with pytest.raises(TypeError, match="interpret_trees") as exc:
        ast_interpret.interpret_trees(bad, _bars(8))
    assert not isinstance(exc.value, ast_interpret.TableRefusal), (
        "a caller error wearing a TableRefusal reaches the member as 'your formula "
        "was rejected', which is a sentence about a formula nobody wrote")


def test_a_NON_FINITE_column_is_the_SAME_through_both_doors():
    """⚠️ ASSERT ON THE COMPARISON, NOT THE COLUMN. A non-finite collapses to
    `None` at `interpret`'s boundary, so a guard deleted anywhere upstream can
    leave the printed column byte-identical while changing what a comparison
    against it answers (this lane measured exactly that on `bop` yesterday). So
    the subject here is `interpret_trees(t) == interpret(t)` ELEMENT BY ELEMENT
    including where the Nones fall — plus a downstream `> 0` over the same tree,
    which is the reading that would move first."""
    bars = _bars(40)
    trees = {"nan": NON_FINITE_TREE, "ok": {"type": "series", "name": "close"}}
    cols = ast_interpret.interpret_trees(trees, bars)
    direct = ast_interpret.interpret(NON_FINITE_TREE, bars)
    assert cols["nan"] == direct
    assert len(cols["nan"]) == len(bars)
    assert all(v is None for v in cols["nan"]), "close/0 is not computable on any bar"
    gt = ast_interpret.interpret(
        {"type": "op", "name": ">", "args": [NON_FINITE_TREE, {"type": "num", "value": 0}]}, bars)
    # ⭐⭐ MEASURED, NOT ASSUMED, AND IT IS THE WHOLE POINT OF THIS TEST. The
    # column above is BLANK on every bar — `_to_column` collapses ±Infinity to
    # the pad and `interpret` prints the pad as `None`. The COMPARISON is taken
    # BEFORE that boundary, on the raw IEEE `+Infinity`, so `close/0 > 0` reads
    # 1.0 on every bar: a formula that draws nothing and screens EVERYTHING.
    # Anyone reading only the artifact would report this tree as inert. This is
    # the `bop` finding in a fixture — the guard is invisible in the column and
    # decisive in the comparison — and `test_the_lanes_agree_on_a_tree_that_is_
    # NOT_COMPUTABLE_on_every_bar` holds BOTH lanes to it, because JS's
    # `Infinity > 0` is true for exactly the same reason.
    assert gt == [1.0] * len(bars)
    assert cols["ok"] == [b["c"] for b in bars]


def test_interpret_trees_threads_the_arguments_astColumnsFor_threads():
    """⭐ THE MIRROR'S ARGUMENT LIST. `nativeRegistry.astColumnsFor` calls
    `interpret(trees[key], bars, inputs, def.compute.budget, undefined, {tf})` —
    the SAME inputs, the SAME budget and the SAME `opts` for every tree. A map
    that dropped `budget` would run every plot uncapped; one that dropped `opts`
    would make `isintraday` not-computable on a chart that knows its timeframe."""
    import inspect
    sig = inspect.signature(ast_interpret.interpret_trees)
    assert list(sig.parameters) == ["trees", "bars", "inputs", "scalars", "budget", "opts"]
    assert [p.kind is inspect.Parameter.KEYWORD_ONLY
            for p in sig.parameters.values()] == [False, False, True, True, True, True], (
        "`interpret` orders its optionals inputs/budget/scalars/opts and this one orders them "
        "inputs/scalars/budget/opts; a positional call would swap a budget for a scalar map, "
        "and both are plain mappings, so nothing downstream would raise")
    tf = {"type": "series", "name": "isintraday"}      # a clock leaf, not a call
    bars = _bars(6)
    blind = ast_interpret.interpret_trees({"tf": tf}, bars)["tf"]
    told = ast_interpret.interpret_trees({"tf": tf}, bars, opts={"tf": "5"})["tf"]
    assert blind == [None] * len(bars), "with no opts the clock FAILS CLOSED, never 0"
    assert told == [1.0] * len(bars)
    # the budget really reaches every tree, not just the first
    with pytest.raises(ast_interpret.TableRefusal):
        ast_interpret.interpret_trees(
            {"a": {"type": "series", "name": "close"},
             "b": {"type": "call", "name": "sma", "args": [
                 {"type": "series", "name": "close"}, {"type": "num", "value": 50}]}},
            bars, budget={"maxLookback": 3})


# ─── the readers ─────────────────────────────────────────────────────────────

def test_lint_verdict_is_PER_TREE():
    rows = ast_lint.lint_definition(_v2())["plots"]
    back = {r["plotKey"]: r["back"] for r in rows}
    assert back["signal"] > back["macd"]
    assert back["hist_up"] == back["hist"]


def test_HB5_an_alert_on_a_NON_scan_plot_evaluates_ITS_tree(store):
    """⭐ THE HAND-BACK, AND ITS CONTROL. `_make_value_fn` captured
    `compute.ast` — the SCAN tree — for every plot, so an alert on the MACD line
    would have been answered by `hist > 0`: a 0/1 flag reported as a price
    distance. The second assertion is the control: a wrong door returns exactly
    0.0 or 1.0, so a test that only checked "a number came back" would pass on
    the defect."""
    d = _v2()
    bars = _bars()
    fn = aus._make_value_fn(DEF_ID, "macd", d)
    expected = [v for v in ast_interpret.interpret(d["compute"]["trees"]["macd"], bars)
                if v is not None][-1]
    assert fn(bars, {}) == pytest.approx(expected, rel=1e-9)
    assert fn(bars, {}) not in (0.0, 1.0)

    # …and every OTHER plot answers its own tree too — one plot proving it is a
    # population of one (`lesson_a_rail_can_pin_the_scarcity_that_creates_false_claims`).
    for key in ("signal", "hist", "hist_up"):
        want = [v for v in ast_interpret.interpret(d["compute"]["trees"][key], bars)
                if v is not None][-1]
        assert aus._make_value_fn(DEF_ID, key, d)(bars, {}) == pytest.approx(want, rel=1e-9)


def test_HB5_a_TREE_LESS_document_still_reads_compute_ast(store):
    """The other arm. `.get(key, compute.ast)` must fall back for every plot of a
    v1 document — an `or`-shaped fix would too, and so would a fix that read
    `trees` only when `scanPlot` was set; this is what keeps the fallback honest."""
    d = _v1()
    bars = _bars()
    want = [v for v in ast_interpret.interpret(d["compute"]["ast"], bars) if v is not None][-1]
    assert aus._make_value_fn(DEF_ID, "value", d)(bars, {}) == pytest.approx(want, rel=1e-9)


def test_HB5_a_PRESENT_but_FALSY_tree_is_NOT_papered_over_with_the_scan_tree(store):
    """⛔ `.get(key, default)`, NEVER `or` — AND THIS IS THE ONLY TEST THAT CAN
    TELL THEM APART.

    The two spellings are identical on every legal document, so the two arms above
    are both green with `or` in place (measured: that mutation SURVIVED them). They
    diverge on exactly one input — a key that is PRESENT and falsy — and that input
    is what an editor mid-save, a truncated blob or a partial migration produces.
    `or` answers it with the SCAN tree's number: the MACD line would report `hist >
    0`, a 0/1 flag delivered to a member as a price. `.get` hands the falsy value to
    `interpret`, which refuses it by name.

    ⛔ AND IT MIRRORS: `ast_lint.lint_definition` says the same thing in the same
    words, and the JS lane's `astColumnsFor` uses `hasOwnProperty` for it. Three
    lanes, one rule — this is the Python one's rail.
    """
    d = _v2()
    d["compute"]["trees"]["macd"] = None
    fn = aus._make_value_fn(DEF_ID, "macd", d)
    with pytest.raises(ast_interpret.TableRefusal):
        fn(_bars(), {})
