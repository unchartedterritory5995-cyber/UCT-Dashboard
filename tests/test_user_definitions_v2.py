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


# ─── W1b.8 fix 1: A FALSY **MAP** IS THE CASE THE FALSY **TREE** LEFT OPEN ───
#
# 🔴 THE DEFECT, MEASURED. The test above proves `.get(key, default)` beats `or`
# for a falsy TREE. The lookup itself was
# `(compute.get("trees") or {}).get(plot_key, compute.get("ast"))` — and that outer
# `or {}` is the same papering-over one level up, on the MAP. Measured on the
# shared MACD fixture over 260 bars, before the fix:
#
#   trees == {}, plot `macd`            -> 0.0   (the SCAN tree's own last value)
#   `macd` absent from trees            -> 0.0   (the SCAN tree's own last value)
#   the honest answer for plot `macd`   -> 5.342245409428131
#
# i.e. `hist > 0`, a 0/1 flag, delivered to a member as a price distance — which is
# verbatim the failure the comment above that line already named.
#
# ⛔ AND THE SCOPE IS THE WHOLE RULING. The fallback is CORRECT for a genuine v1
# document: it carries no `trees` at all and every plot legitimately resolves to
# `compute.ast`. What is wrong is falling back on a document that CLAIMS to be
# multi-tree, and that claim is `user_definitions.declares_v2` — read off
# `_V2_COMPUTE_KEYS`, the roster `validate_v2` refuses from, so the write door and
# the read door cannot come to disagree about what a v2 document is.
#
# ⚠️ REACHABLE ONLY ON A ROW THAT IS ALREADY STORED. `save()` refuses every shape
# below by name — and the read path NEVER RE-VALIDATES (W1b.8 report §9.6), so any
# row written before that door existed walks straight in. The last test in this
# block drives exactly that, through the product read path.


def test_W1b8_an_EMPTY_trees_map_refuses_BY_NAME_rather_than_answering_with_the_scan_tree(store):
    """🔴 THE CASE THE FALSY-TREE TEST LEFT OPEN, and its control.

    `trees == {}` is present, falsy, and is the very shape `validate_v2` refuses
    as adversarial (*an empty trees map names no plot*). The `or {}` spelling read
    it as absent and answered plot `macd` with the SCAN tree's column.

    ⛔ THE SECOND ASSERTION IS THE CONTROL AND IT IS NOT DECORATION. A test that
    only checked *a refusal happened* would pass on a refusal from any other door —
    the attribution defect `AdmissionRefused.gate` exists for, five times on this
    branch. The third asserts the sentence NAMES the plot and the definition, so a
    refusal that told a member nothing actionable is a red test.
    """
    d = _v2()
    d["compute"]["trees"] = {}
    with pytest.raises(aus.AdmissionRefused) as caught:
        aus._make_value_fn(DEF_ID, "macd", d)
    assert caught.value.gate == "plot"
    assert "u_0123456789ab" in str(caught.value)
    assert "macd" in str(caught.value)
    assert "EMPTY" in str(caught.value), (
        "an empty map and a map short one key are different repairs and the "
        "refusal has to say which one this is")


def test_W1b8_a_MISSING_plot_key_refuses_BY_NAME_and_says_which_plots_the_map_DOES_name(store):
    """The second half of the same door: the map is legal, this plot is not in it.

    ⛔ SEPARATE FROM THE EMPTY-MAP TEST DELIBERATELY. Merged, *the guard stopped
    refusing* and *the guard stopped distinguishing the two documents* would be one
    failure; split, they are two mutations with two different killers
    (`lesson_mutations_can_cancel_each_other`).

    The listed keys are what makes the refusal actionable: a member reading *names
    ['hist', 'hist_up', 'signal']* can see that `macd` is the one that went missing.
    """
    d = _v2()
    del d["compute"]["trees"]["macd"]
    with pytest.raises(aus.AdmissionRefused) as caught:
        aus._make_value_fn(DEF_ID, "macd", d)
    assert caught.value.gate == "plot"
    message = str(caught.value)
    for still_there in ("hist", "hist_up", "signal"):
        assert still_there in message
    assert "EMPTY" not in message


def test_W1b8_a_v2_CLAIM_with_a_NON_OBJECT_trees_refuses_rather_than_reading_it_as_absent(store):
    """`{"trees": None, "treesHash": ..., "scanPlot": ...}` — a CLAIM plus a broken map.

    ⛔ THIS IS WHAT SEPARATES `declares_v2` FROM A NAIVE `isinstance(trees, dict)`
    CHECK. A guard that only asked *is `trees` a mapping holding this key* would
    take the `compute.ast` fallback here — for the document MOST likely to be a
    partial write — and hand the scan tree's number back under the MACD's name.
    `_assert_trees` already says the same thing on the write side: Python collapses
    `undefined` and `null`, so a `trees` that IS `None` is a MULTI-TREE document
    with a broken map, never a single-tree one.
    """
    d = _v2()
    d["compute"]["trees"] = None
    with pytest.raises(aus.AdmissionRefused) as caught:
        aus._make_value_fn(DEF_ID, "macd", d)
    assert caught.value.gate == "plot"
    assert "null" in str(caught.value)


def test_W1b8_the_v2_question_is_asked_off_the_WHOLE_ROSTER_not_the_trees_key_alone(store):
    """🔴 THE RAIL THE FIRST ROUND OF MUTATIONS SURVIVED, AND IT IS THE ROSTER.

    Measured: replacing `any(k in compute for k in _V2_COMPUTE_KEYS)` with
    `"trees" in compute` moved **0 of 135** tests. Every case above happens to
    carry a `trees` key, so all of them are satisfied by the narrower question and
    none of them can tell the two apart — green, well-named, right function,
    proving nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

    ⛔ THE DISCRIMINATING INPUT IS A v2 CLAIM WITH **NO** `trees` KEY. That is a
    real shape: `validate_v2` refuses it by name (*only a multi-tree document may
    declare it*), which means it is exactly what a partial write or a truncated
    blob leaves behind — and on the read path the narrower question serves
    `compute.ast` for a document that declares `scanPlot`, i.e. the scan plot's
    number under every other plot's name.

    ⛔ AND IT IS A DECLARED ROSTER, NOT ONE CASE. The keys are READ off
    `svc._V2_COMPUTE_KEYS`, so a fifth v2 key added tomorrow is covered the day it
    lands rather than the day somebody remembers this file. The floor assertion is
    what stops the loop passing over an empty roster.
    """
    others = [k for k in svc._V2_COMPUTE_KEYS if k != "trees"]
    assert len(others) >= 2, (
        f"the roster is down to {others} — a loop over one key is a case, not a "
        "roster, and this rail would stop meaning what its name says")

    bars = _bars()
    for key in others:
        d = _v2()
        keep = d["compute"].pop(key)
        for gone in ("trees", "treesHash", "scanPlot", "sources"):
            d["compute"].pop(gone, None)
        d["compute"][key] = keep
        with pytest.raises(aus.AdmissionRefused) as caught:
            aus._make_value_fn(DEF_ID, "macd", d)
        assert caught.value.gate == "plot", (
            f"compute.{key} alone is a v2 claim and the read path took the "
            f"compute.ast fallback on it")

    # ⭐ THE CONTROL, ON THE SAME DOCUMENT MINUS THE CLAIM. Strip every v2 key and
    # the identical blob is an ordinary single-tree document that must answer.
    plain = _v2()
    for gone in ("trees", "treesHash", "scanPlot", "sources"):
        plain["compute"].pop(gone, None)
    want = [v for v in ast_interpret.interpret(plain["compute"]["ast"], bars)
            if v is not None][-1]
    assert aus._make_value_fn(DEF_ID, "macd", plain)(bars, {}) \
        == pytest.approx(want, rel=1e-9)


def test_W1b8_a_v1_document_is_UNCHANGED_by_the_guard_and_still_reads_compute_ast(store):
    """⭐ THE OTHER DIRECTION, AND IT IS THE ONE THAT BOUNDS THE FIX.

    An over-refusal has no red test, no wrong output and no complaint
    (`lesson_an_over_refusal_is_invisible`), and the obvious over-fix here — refuse
    whenever `trees[plot_key]` misses — would break EVERY definition saved before
    multi-plot existed. A v1 document carries none of `_V2_COMPUTE_KEYS`, so it
    resolves through the fallback exactly as it did, and the number is asserted
    rather than merely the absence of a raise.

    ⚠️ AND IT IS ASKED FOR A PLOT KEY THE DOCUMENT NEVER MENTIONS. `mystery` is in
    no `trees`, no `plots` and no `sources`; on a v1 document that is not a defect,
    it is the ordinary case — there is one tree and every plot is it.

    ⛔ AND THE SECOND DOCUMENT IS THE CONTROL. `_v1()`'s tree is the SCAN tree
    `hist_up`, which answers 1.0 — indistinguishable from the 0/1 flag this whole
    guard exists to stop being reported as a price. So the same v1 shape is built
    again around the price-valued `macd` tree, and the assertion is that it reads
    THAT number and specifically NOT the boolean its v2 sibling would have
    substituted.
    """
    bars = _bars()
    boolean_answer = [v for v in ast_interpret.interpret(_fixture()["trees"]["hist_up"], bars)
                      if v is not None][-1]

    d = _v1()
    want = [v for v in ast_interpret.interpret(d["compute"]["ast"], bars)
            if v is not None][-1]
    for plot_key in ("value", "mystery"):
        assert aus._make_value_fn(DEF_ID, plot_key, d)(bars, {}) \
            == pytest.approx(want, rel=1e-9)

    priced = _v2("macd")
    for k in ("trees", "treesHash", "sources", "scanPlot"):
        priced["compute"].pop(k)
    priced["plots"] = [{"key": "value", "style": "line", "color": "$color"}]
    want_priced = [v for v in ast_interpret.interpret(priced["compute"]["ast"], bars)
                   if v is not None][-1]
    for plot_key in ("value", "mystery"):
        got = aus._make_value_fn(DEF_ID, plot_key, priced)(bars, {})
        assert got == pytest.approx(want_priced, rel=1e-9)
        assert got != pytest.approx(boolean_answer, rel=1e-9)


def test_W1b8_the_guard_fires_on_the_READ_path_for_a_row_that_was_ALREADY_STORED(store):
    """🔴 THE REACHABILITY, DRIVEN THROUGH THE PRODUCT PATH — not a hand-made dict.

    `save()` refuses `trees == {}` by name, so this document cannot be created
    today. It can already BE there: the read path never re-validates, and
    `user_value_function` is what `GET /api/indicator-alerts/current-value` calls to
    put a number in front of a member. So the row is saved LEGALLY and the stored
    blob is then edited in SQL — which is what a partial write, a truncated blob or
    a row from before the door leaves behind.

    ⛔ WITHOUT THIS TEST THE FIX WOULD BE PROVEN ONLY ON A DICT THIS FILE BUILT.
    `lesson_built_tested_green_and_unreachable` is the other half of the same
    mistake: a guard on a path nothing walks.
    """
    import sqlite3

    d = _v2()
    svc.save(USER, DEF_ID, d)

    broken = copy.deepcopy(d)
    broken["compute"]["trees"] = {}
    con = sqlite3.connect(str(svc._DB_PATH))
    try:
        con.execute("UPDATE user_definitions SET definition=? WHERE def_id=?",
                    (json.dumps(broken), DEF_ID))
        con.commit()
    finally:
        con.close()

    with pytest.raises(aus.AdmissionRefused) as caught:
        aus.user_value_function(USER, f"{DEF_ID}.macd")
    assert caught.value.gate == "plot"


# ─── W9i: `rev` moves when the SCAN tree moves **OR** when `treesHash` moves ──
#
# 🔴 THE DEFECT, MEASURED. `save()` computed `rev_bumped` from
# `ast_hash(compute.ast)` — the SCAN tree — alone, while an alert binds to ONE
# PLOT (`u_<12 hex>.<plotKey>`) and `_make_value_fn` evaluates
# `compute.trees[plotKey]`. So a member could change what plot 2 computes and the
# alert on plot 2 went on evaluating the tree they had just replaced: no
# migration, no `last_value` reset, no notice. `treesHash` was declared in
# `user_definitions.py` to exist "for change detection and the `compute.rev`
# migration" and appeared nowhere near the rev decision — a comment stating an
# intent as though it were implemented.
#
# ⛔ THE RULING IS A WIDENED QUESTION, NOT A NEW IDENTITY. `compute.fn`,
# `scan_definition.def_hash`, the stored `ast_hash` column and the `def_hash`
# handed to the migration all stay `ast_hash(compute.ast)`, byte for byte —
# `test_W9i_the_bump_does_NOT_move_a_single_STORED_hash` is that claim's rail.
#
# ⛔ AND OVER-MIGRATING IS THE DELIBERATE DIRECTION. `rev` is one number per
# definition and `migrate_bindings_to_rev` scopes by `plot_base`, so editing plot
# 2 re-arms plot 1's bindings too. That costs one idempotent re-arm; the other
# direction fires a member's alert on maths they replaced.


def _bind(plot_key: str, *, last_value: float, def_id: str = DEF_ID) -> int:
    """One armed alert on ONE plot of the definition, inserted DIRECTLY.

    ⛔ NOT `ias.create`, AND NOT A FAKE EITHER. `create` runs `arm_for_alert` for
    a user address, which spawns a node process for the 1e-9 cross-lane equality —
    that is Phase D's gate and it has its own suite. What is under test here is
    what the MIGRATION does to a row that already exists, so the row is written in
    the exact shape `create` writes and nothing is stubbed.
    """
    import sqlite3
    con = sqlite3.connect(str(ias._DB_PATH))
    try:
        cur = con.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, params_json, "
            " active, trigger_count, created_at, state, state_at, arm_epoch, "
            " instance_id, scope, def_source, last_value, last_evaluated_at) "
            "VALUES (?,?,?,?,?,?,NULL,1,0,?,?,?,0,NULL,NULL,?,?,?)",
            (USER, "PARITY", f"{def_id}.{plot_key}", "below", 0.0, "5",
             1_700_000_000, ias.STATE_ARMED, 1_700_000_000,
             ias.DEF_SOURCE_USER, float(last_value), 1_700_000_000),
        )
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def _first_num(node):
    """The first `num` node in a canonical tree, in document order."""
    if isinstance(node, dict):
        if node.get("type") == "num":
            return node
        for child in node.get("args") or []:
            found = _first_num(child)
            if found is not None:
                return found
    elif isinstance(node, list):
        for child in node:
            found = _first_num(child)
            if found is not None:
                return found
    return None


def _retune(d: dict, plot_key: str, new_value: float) -> dict:
    """Edit ONE plot's tree the way a member does, and RESTAMP the document.

    The first `num` node in `trees[plot_key]` takes `new_value` — a real maths
    change to exactly one plot — and then every derived field the store validates
    is recomputed: `treesHash` always, plus `ast`/`fn`/`source` when the edited
    plot IS the scan plot (`compute.ast` is an alias of `trees[scanPlot]`).

    ⛔ IT RESTAMPS RATHER THAN HAND-WRITING, so the mutation cannot accidentally
    be testing `validate_v2`'s refusal instead of the rev decision.
    """
    compute = d["compute"]
    _first_num(compute["trees"][plot_key])["value"] = new_value
    compute["sources"][plot_key] = compute["sources"][plot_key] + f"  # {new_value}"
    compute["treesHash"] = svc.trees_hash(compute["trees"])
    if plot_key == compute["scanPlot"]:
        compute["ast"] = compute["trees"][plot_key]
        compute["fn"] = svc.ast_hash(compute["ast"])
        compute["source"] = compute["sources"][plot_key]
    return d


# ─── the helper, alone ───────────────────────────────────────────────────────

def test_W9i_trees_identity_is_None_for_v1_and_the_trees_hash_for_v2():
    """The three answers the rev decision is built on, asserted separately.

    ⛔ `None` FOR A SINGLE-TREE DOCUMENT IS THE WHOLE v1-INVARIANCE ARGUMENT: two
    v1 documents both answer `None`, `None != None` is False, and no v1 save can
    gain a bump it did not have before.
    """
    assert svc.trees_identity(_v1()) is None
    assert svc.trees_identity({}) is None
    assert svc.trees_identity({"compute": {"kind": "ast"}}) is None

    d = _v2()
    assert svc.trees_identity(d) == d["compute"]["treesHash"] == _fixture()["treesHash"]

    # ⛔ DERIVED, NEVER READ OFF THE STAMP. A document that LIES about its own
    # `treesHash` still answers with the truth of its trees — which is what keeps
    # a partial write from deciding its own migration.
    liar = _v2()
    liar["compute"]["treesHash"] = "sha256:" + "0" * 64
    assert svc.trees_identity(liar) == _fixture()["treesHash"]

    # A ONE-KEY map is legal at the hash layer (refused at save, by name), so the
    # identity answers rather than raising — mirroring `trees_hash` itself.
    one = _v2()
    one["compute"]["trees"] = {"only": {"type": "num", "value": 1}}
    assert svc.trees_identity(one).startswith("sha256:")


def test_W9i_an_UNHASHABLE_trees_map_is_neither_None_nor_a_hash():
    """⛔ THE THIRD ANSWER, AND IT EXISTS TO PICK THE SAFE DIRECTION.

    `None` would read as "single-tree" and retire the bump; a raise would mean a
    member whose stored row is malformed can never save again. `UNHASHABLE_TREES`
    compares unequal to `None` AND to every real hash, so the edit MIGRATES.
    """
    broken = _v2()
    broken["compute"]["trees"]["macd"] = {"type": "num"}      # no `value`
    answer = svc.trees_identity(broken)
    assert answer == svc.UNHASHABLE_TREES
    assert answer is not None and not answer.startswith("sha256:")
    assert answer != svc.trees_identity(_v2()) and answer != svc.trees_identity(_v1())


# ─── both directions, on the real save path ──────────────────────────────────

def test_W9i_editing_a_NON_SCAN_tree_BUMPS_and_MIGRATES_the_bound_alert(store):
    """🔴 THE DEFECT, END TO END — and the assertions are on the CONSUMER.

    A rev that bumps while nothing migrates is the "computed but never applied"
    failure this repo keeps rediscovering, so `migrated` / `notified` /
    `bindings_on_this_tree` are asserted beside the integer, and the alert row is
    read back for the `last_value` reset that is the point of the whole exercise.
    """
    created = svc.save(USER, DEF_ID, _v2())
    assert created["rev"] == svc.FIRST_REV and created["rev_bumped"] is False

    bound = _bind("macd", last_value=1.25)          # an alert on a NON-scan plot
    other = _bind("hist_up", last_value=1.0)        # and one on the scan plot

    edited = svc.save(USER, DEF_ID, _retune(_v2(), "macd", 11))

    assert edited["rev_bumped"] is True, (
        "editing what plot 2 computes did not bump `rev` — the alert bound to "
        "plot 2 keeps evaluating the tree the member just replaced, and nothing "
        "tells them")
    assert edited["rev"] == created["rev"] + 1
    assert edited["version"] == 2

    # ⭐ THE MIGRATION'S OWN NUMBERS, not the rev integer.
    assert edited["migrated"] == 2 and edited["notified"] == 2, (
        f"the bump reported migrated={edited['migrated']} — a rev that moves "
        "while nothing migrates leaves every binding on the old maths")
    assert edited["bindings_on_this_tree"] == 2

    # ⭐ AND THE THREE EFFECTS ON THE ROW ITSELF.
    for aid, from_plot in ((bound, "macd"), (other, "hist_up")):
        row = rev.rev_row(aid)
        assert row is not None, f"{from_plot} binding was never recorded"
        assert row["def_rev"] == edited["rev"] and row["from_rev"] == created["rev"]
        assert row["def_hash"] == edited["ast_hash"]
        assert ias.get(aid)["last_value"] is None, (
            f"alert on {from_plot} still holds an old-formula number after the edit")


def test_W9i_a_save_that_moves_NO_tree_does_NOT_bump(store):
    """⛔ THE CONTROL. An over-eager rev that bumps on every save is a DIFFERENT
    bug wearing the same fix — it eats a cycle and delivers a "your maths changed"
    notice on every colour change.

    Two shapes of "nothing moved", because they leave `save()` by different doors:
    a PRESENTATIONAL edit reaches the rev decision with a different blob, and a
    byte-identical re-save short-circuits before it.
    """
    created = svc.save(USER, DEF_ID, _v2())
    bound = _bind("macd", last_value=1.25)

    renamed = _v2()
    renamed["meta"]["name"] = "MACD v2 (renamed)"
    renamed["plots"][0]["color"] = "#123456"
    out = svc.save(USER, DEF_ID, renamed)
    assert out["version"] == 2 and out["appended"] is True   # it really was a save
    assert out["rev_bumped"] is False and out["rev"] == created["rev"]
    assert out["migrated"] == 0 and out["notified"] == 0
    assert rev.rev_row(bound) is None, (
        "a RENAME migrated the bindings — every label change would eat a cycle "
        "and tell the member their maths moved")
    assert ias.get(bound)["last_value"] == 1.25

    again = svc.save(USER, DEF_ID, renamed)                  # byte-identical
    assert again["appended"] is False and again["rev_bumped"] is False
    assert again["version"] == 2 and again["migrated"] == 0


def test_W9i_key_ORDER_alone_is_not_an_edit(store):
    """⛔ ADVERSARIAL: the same trees, a different insertion order.

    `trees_hash` sorts its keys and `save()`'s blob is `sort_keys=True`, so both
    lanes already agree that order is not identity — but they agree for two
    DIFFERENT reasons, and a hasher that read insertion order would bump here
    while the blob stayed identical. Paired with a rename so the save cannot exit
    through the byte-identical short-circuit and skip the rev decision entirely.
    """
    created = svc.save(USER, DEF_ID, _v2())
    bound = _bind("macd", last_value=1.25)

    shuffled = _v2()
    shuffled["compute"]["trees"] = dict(reversed(list(shuffled["compute"]["trees"].items())))
    shuffled["compute"]["sources"] = dict(reversed(list(shuffled["compute"]["sources"].items())))
    shuffled["meta"]["name"] = "MACD v2 (reordered)"
    assert list(shuffled["compute"]["trees"]) != list(_v2()["compute"]["trees"])

    out = svc.save(USER, DEF_ID, shuffled)
    assert out["appended"] is True and out["version"] == 2
    assert out["rev_bumped"] is False and out["rev"] == created["rev"]
    assert out["migrated"] == 0
    assert rev.rev_row(bound) is None
    assert ias.get(bound)["last_value"] == 1.25


def test_W9i_the_SCAN_tree_moving_still_bumps_exactly_as_it_always_did(store):
    """The other arm of the OR, unchanged. Editing the scan plot moves BOTH
    identities (`compute.ast` IS `trees[scanPlot]`), so this case was already
    correct — it is here so the widening cannot be "fixed" by replacing the first
    identity with the second."""
    created = svc.save(USER, DEF_ID, _v2())
    bound = _bind("hist_up", last_value=1.0)

    edited = svc.save(USER, DEF_ID, _retune(_v2(), "hist_up", 1))
    assert edited["rev_bumped"] is True and edited["rev"] == created["rev"] + 1
    assert edited["ast_hash"] != created["ast_hash"], (
        "the SCAN tree moved and the stored hash did not — `compute.ast` is no "
        "longer an alias of `trees[scanPlot]`")
    assert edited["migrated"] == 1 and edited["bindings_on_this_tree"] == 1
    assert ias.get(bound)["last_value"] is None


# ─── ⛔ the claim that must NOT move: no existing hash did ────────────────────

def test_W9i_the_bump_does_NOT_move_a_single_STORED_hash(store):
    """⛔ THE RULING'S HARD HALF, ON THE REAL PATH.

    A non-scan edit bumps `rev` — and every byte an existing binding or a
    `scan_hits` row is filed under must be IDENTICAL either side of it. The stored
    `ast_hash` column, `compute.fn`, `scan_definition.def_hash` and the `def_hash`
    the migration stamps are all one number, and this asserts they are the SAME
    STRING across the bump rather than merely well-formed.
    """
    before = svc.save(USER, DEF_ID, _v2())
    _bind("macd", last_value=1.25)
    edited_doc = _retune(_v2(), "macd", 11)
    after = svc.save(USER, DEF_ID, edited_doc)

    assert after["rev_bumped"] is True and after["rev"] == before["rev"] + 1
    assert after["ast_hash"] == before["ast_hash"], (
        "a NON-SCAN edit moved the stored scan hash — every `scan_hits` key and "
        "every alert binding filed under it would be orphaned")
    assert edited_doc["compute"]["fn"] == before["ast_hash"]
    assert scan_definition.def_hash(edited_doc) == before["ast_hash"]
    assert svc.trees_identity(edited_doc) != svc.trees_identity(_v2())   # the SECOND one moved

    # …and the migration filed the bindings under that same unmoved hash.
    for b in rev.bindings_on(DEF_ID):
        assert b["def_hash"] == before["ast_hash"]

    # The census row this file has kept since v2 shipped: the plainest v1 hash.
    sma20 = {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}
    assert svc.ast_hash(sma20) == V1_SMA20_HASH


# ─── adversarial documents the corpus does not contain ───────────────────────

def test_W9i_a_v1_documents_behaviour_is_COMPLETELY_unchanged(store):
    """⛔ THE INVARIANCE CLAIM, DRIVEN IN BOTH DIRECTIONS.

    Every stored definition that predates multi-plot is single-tree, so the OR's
    second term must be inert for all of them: `None != None` is False on a
    presentational save, and the scan hash still decides a maths save. One
    direction alone is satisfied by a term that never fires at all.
    """
    v1_id = "u_ffffffffffff"
    base = _v1()
    base["id"] = v1_id
    created = svc.save(USER, v1_id, copy.deepcopy(base))
    assert created["rev"] == svc.FIRST_REV

    renamed = copy.deepcopy(base)
    renamed["meta"]["name"] = "v1 renamed"
    out = svc.save(USER, v1_id, renamed)
    assert out["appended"] is True and out["rev_bumped"] is False
    assert out["rev"] == created["rev"] and out["ast_hash"] == created["ast_hash"]

    edited = copy.deepcopy(base)
    _first_num(edited["compute"]["ast"])["value"] = 11
    edited["compute"]["fn"] = svc.ast_hash(edited["compute"]["ast"])
    out2 = svc.save(USER, v1_id, edited)
    assert out2["rev_bumped"] is True and out2["rev"] == created["rev"] + 1
    assert out2["ast_hash"] != created["ast_hash"]


def test_W9i_COLLAPSING_a_v2_document_back_to_ONE_tree_bumps(store):
    """⛔ THE CASE THAT LOOKS COSMETIC AND IS THE MOST DANGEROUS ONE.

    A member deletes plot 2. `compute.ast` can be byte-identical, so the scan
    hash does not move — but `_make_value_fn` resolves a plot with no tree as
    `.get(key, compute.ast)`, so the alert that was on plot 2 now evaluates the
    SCAN tree. Its maths did not merely change, it became a different formula
    entirely. `None != <hash>` is what makes that migrate.
    """
    created = svc.save(USER, DEF_ID, _v2())
    bound = _bind("macd", last_value=1.25)

    collapsed = _v2()
    scan_tree = collapsed["compute"]["trees"][collapsed["compute"]["scanPlot"]]
    for k in ("trees", "treesHash", "sources", "scanPlot"):
        collapsed["compute"].pop(k)
    collapsed["compute"]["ast"] = scan_tree
    collapsed["compute"]["fn"] = svc.ast_hash(scan_tree)
    collapsed["plots"] = [{"key": "hist_up", "style": "line", "color": "$color"}]

    out = svc.save(USER, DEF_ID, collapsed)
    assert out["ast_hash"] == created["ast_hash"], "the scan tree did NOT move here"
    assert out["rev_bumped"] is True, (
        "collapsing to one tree left `rev` still — the alert on the deleted plot "
        "silently switched to the scan tree's formula")
    assert out["migrated"] == 1 and ias.get(bound)["last_value"] is None


def test_W9i_an_UNHASHABLE_STORED_predecessor_MIGRATES_rather_than_going_quiet(store):
    """⛔ CONSTRUCTED, BECAUSE NO CORPUS CONTAINS IT.

    A stored row whose `trees` map this lane cannot hash cannot be produced by
    `save()` — `validate_v2` refuses it by name — so it is written straight into
    the table, which is what a partial write or a hand-repair leaves behind. The
    safe answer is a BUMP: the member's next save re-arms their alerts instead of
    inheriting a comparison nobody can make.
    """
    import sqlite3
    svc.save(USER, DEF_ID, _v2())
    corrupt = _v2()
    corrupt["compute"]["trees"]["macd"] = {"type": "num"}       # no `value`
    blob = json.dumps(corrupt, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    con = sqlite3.connect(str(svc._DB_PATH))
    try:
        con.execute(
            "INSERT INTO user_definitions (user_id, def_id, version, rev, ast_hash, "
            "definition, repaint, deleted_at, created_at) VALUES (?,?,?,?,?,?,?,NULL,?)",
            (USER, DEF_ID, 2, 1, svc.ast_hash(corrupt["compute"]["ast"]), blob,
             "{}", 1_700_000_000))
        con.commit()
    finally:
        con.close()
    assert svc.trees_identity(json.loads(blob)) == svc.UNHASHABLE_TREES

    bound = _bind("macd", last_value=1.25)
    out = svc.save(USER, DEF_ID, _v2())          # a perfectly legal document
    assert out["rev_bumped"] is True, (
        "a predecessor this lane cannot hash was read as 'nothing moved' — the "
        "unsafe direction, and the one a partial write actually produces")
    assert out["migrated"] == 1 and ias.get(bound)["last_value"] is None


def test_W9i_the_rev_decision_reads_BOTH_hashes_from_saves_own_body():
    """⛔ A RULE WITH NO CALL SITE IS NOT A RULE, and every behavioural test above
    would still pass if the OR lived in a helper only they reached.

    ⚠️ RE-PARSED FROM THE FILE BY NAME, never `inspect.getsource` — that helper
    slices at import-time line numbers and a co-worker's edit above `save` hands
    it the wrong lines (measured for real on this branch).
    """
    import ast as _ast
    module = _ast.parse(Path(svc.__file__).read_text(encoding="utf-8"))
    saves = [n for n in module.body
             if isinstance(n, _ast.FunctionDef) and n.name == "save"]
    assert len(saves) == 1, f"expected one save(), found {len(saves)}"
    src = _ast.unparse(saves[0])
    assert "trees_identity" in src, (
        "save() no longer consults the SECOND identity — an edit to a non-scan "
        "plot would bump nothing and migrate nothing")
    assert "ast_hash" in src, "save() no longer consults the scan hash"

    # The control: the same parse of a DIFFERENT function does not contain it, so
    # the assertion above read `save`'s own body and not the whole module.
    others = [n for n in module.body
              if isinstance(n, _ast.FunctionDef) and n.name == "soft_delete"]
    assert len(others) == 1
    assert "trees_identity" not in _ast.unparse(others[0])
