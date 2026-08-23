"""SCALARS IN THE CLOSED TABLE — the vocabulary, the partition, and the second
verdict the first one cannot give.

⭐⭐ THE HEADLINE, AND IT IS THE REASON THIS FILE EXISTS RATHER THAN A FEW EXTRA
CASES IN ``test_ast_interpret.py``. ``ast_lint.ast_reach`` answers ``(0, 0)`` for
a scalar leaf, so the repaint gate brands ``market_cap > 1e9``
``non-repainting`` — and that answer is CORRECT. A per-symbol value depends on no
later bar. Which means the repaint gate PASSES a formula whose value is up to a
day old and **nothing fires**. The zero is a true answer to a question nobody
asked, and that is exactly why ``meta.freshness`` is a GATE and not a label.

Every rail here is DERIVED — from ``closedTable.json``, from
``screener/snapshot_db.COLUMNS`` read by AST, and from
``screener/snapshot_builder`` for the two as-of families. Nothing below is a list
of what somebody remembered, because the whole point of the partition identity is
that the day a sixty-sixth screener column lands, this file goes red.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac                                       # noqa: E402
from api.services import ast_freshness, ast_interpret, ast_lint, ast_table  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "ast" / "scalars.json"
DOC = json.loads(FIXTURE.read_text(encoding="utf-8"))

SNAPSHOT_DB = ROOT / "api" / "services" / "screener" / "snapshot_db.py"
SNAPSHOT_BUILDER = ROOT / "api" / "services" / "screener" / "snapshot_builder.py"
JS_FRESHNESS_TEST = (ROOT / "app" / "src" / "components" / "chart" / "engine"
                     / "ast" / "freshness.test.js")

BARS = [{"t": 1780000000 + i * 300, "o": 10.0, "h": 11.0, "l": 9.0,
         "c": 10.0 + i, "v": 100 * (i + 1)} for i in range(6)]

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731

TABLE = ast_table.TABLE
SCALARS = ast_table.scalar_names()


def _assign_literal(path: pathlib.Path, name: str):
    """A module-level literal assignment, read by AST.

    ⛔ AST, NEVER GREP, AND NEVER AN IMPORT EITHER. Importing
    ``screener.snapshot_db`` to read ``COLUMNS`` would pull in a module that
    resolves a database path from the environment; parsing its source reads the
    DECLARATION, which is the thing the partition is a claim about.
    """
    tree = pyast.parse(io.open(path, encoding="utf-8").read())
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Assign) and getattr(node.targets[0], "id", None) == name:
            return pyast.literal_eval(node.value)
    raise AssertionError(f"{path.name} declares no module-level {name}")


COLUMNS = _assign_literal(SNAPSHOT_DB, "COLUMNS")


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE THREE THAT DECIDE THE TASK — safety first
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_declared_but_MISSING_scalar_is_a_HOLE_not_a_REFUSAL():
    """⛔ THE DISTINCTION THE WHOLE COVERAGE CONTRACT RESTS ON, ONE LEVEL DOWN.

    ``market_cap`` is DECLARED for every symbol and PRESENT for only some. A
    symbol whose row has NULL there must evaluate to a hole — the formula RAN and
    the answer is "not computable" — and must NOT refuse at ``resolve:name``,
    which is the answer for a name the table never declared. Those are different
    facts and a sweep reports them in different buckets.

    ⛔ AND NOT 0 AT THE LEAF. ``scan_volume._job`` sets ``m = {}`` on a failed
    reference, which is why "a failed reference is indistinguishable from an
    empty market" — a NULL market cap read as 0 makes ``market_cap > 1e9`` a
    confident False, and a screen that answers is worse than one that drops.
    """
    leaf = SER("market_cap")
    present = ast_interpret.interpret(leaf, BARS, scalars={"market_cap": 2e9})
    missing = ast_interpret.interpret(leaf, BARS, scalars={"market_cap": None})
    absent = ast_interpret.interpret(leaf, BARS, scalars={})
    unseeded = ast_interpret.interpret(leaf, BARS)

    assert present == [2e9] * len(BARS), "a present scalar broadcasts to every bar"
    assert missing == [None] * len(BARS), "a NULL scalar is a HOLE on the wire"
    assert absent == [None] * len(BARS), "an absent key is the same hole"
    assert unseeded == [None] * len(BARS), (
        "a declared name must RESOLVE even when the caller passes no scalars at "
        "all — otherwise every chart-lane call turns a declared name into a "
        "formula defect")
    # …and the hole survives arithmetic, which is where a wrong number would hide.
    assert ast_interpret.interpret(
        OP("*", leaf, NUM(2.0)), BARS, scalars={}) == [None] * len(BARS)

    with pytest.raises(ast_interpret.TableRefusal, match="unknown name") as exc:
        ast_interpret.interpret(SER("rugpull_score"), BARS, scalars={})
    assert exc.value.guard == "resolve:name"


def test_a_COMPARISON_EATS_THE_HOLE_and_that_is_why_unresolved_scalars_EXISTS():
    """🔴 THE FINDING E1 DID NOT EXPECT, MEASURED AND PINNED.

    The draft's own version of the test above asserted that
    ``market_cap > 1e9`` returns ``None`` for a symbol with no market cap. It
    does not, and it must not: ``interpret``'s ``_cmp`` answers **0** when either
    side is NaN — *"A COMPARISON AGAINST NaN IS 0, NOT NaN ... the one place JS
    and Python agree by luck"* — and that rule is correct for a bar warmup and is
    PINNED by 17 frozen cross-lane digests. Changing it would move every one of
    them and change what a warmup means on every chart.

    ⛔ SO THE HOLE IS VISIBLE AT THE LEAF AND INVISIBLE ONE NODE UP, and a sweep
    that read the COLUMN would count a symbol it knows nothing about as a symbol
    that did not match — ``scan_volume``'s bug, arrived at from the other side.
    ``unresolved_scalars`` is the question that has to be asked BEFORE
    evaluating, and this test is the reason it is a function rather than a
    paragraph somebody has to remember.
    """
    tree = OP(">", SER("market_cap"), NUM(1e9))
    assert ast_interpret.interpret(tree, BARS, scalars={"market_cap": 2e9}) == [1.0] * len(BARS)
    # ⛔ THE MEASUREMENT, STATED RATHER THAN WISHED AWAY.
    assert ast_interpret.interpret(tree, BARS, scalars={}) == [0.0] * len(BARS)
    # …and `&&` does not rescue it either: 0 is a value, so it propagates as one.
    both = OP("&&", tree, OP(">", SER("close"), NUM(0.0)))
    assert ast_interpret.interpret(both, BARS, scalars={}) == [0.0] * len(BARS)

    # THE ANSWER: ask the tree, before evaluating it.
    assert ast_interpret.unresolved_scalars(tree, {}) == ["market_cap"]
    assert ast_interpret.unresolved_scalars(tree, {"market_cap": None}) == ["market_cap"]
    assert ast_interpret.unresolved_scalars(tree, {"market_cap": float("nan")}) == ["market_cap"]
    assert ast_interpret.unresolved_scalars(tree, {"market_cap": 2e9}) == []
    # …it names only the scalars the TREE reads, not every declared one…
    assert ast_interpret.unresolved_scalars(OP(">", SER("close"), NUM(1.0)), {}) == []
    # …and it finds them at any depth, in manifest order.
    deep = OP("&&", OP(">", SER("rs_rank"), NUM(80)),
              OP(">", OP("*", SER("market_cap"), NUM(2.0)), NUM(1e9)))
    assert ast_interpret.unresolved_scalars(deep, {"rs_rank": 90}) == ["market_cap"]
    assert ast_interpret.unresolved_scalars(deep, {}) == ["market_cap", "rs_rank"]


def test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly():
    """⛔ THE FLOOR IS DERIVED FROM THE SUBJECT, AND BOTH HALVES ARE REQUIRED.

    A declared list and an excluded list that together do not equal ``COLUMNS``
    is a list of what somebody remembered — the DPC shape, where four constants
    rode outside their own rail for the rule's entire life. With this identity a
    sixty-sixth screener column lands RED here until somebody DECIDES about it,
    which is the only thing that keeps the vocabulary honest as the screener
    grows.
    """
    columns = set(COLUMNS)
    assert len(columns) == len(COLUMNS) == 158, (
        f"snapshot_db declares {len(COLUMNS)} columns ({len(columns)} distinct); "
        "the partition below is a claim about that exact list")
    declared = {ast_table.scalar_source(n)["column"] for n in SCALARS}
    excluded = ast_table.excluded_columns()

    assert declared | excluded == columns, (
        f"unpartitioned: {sorted(columns - declared - excluded)} is a screener "
        f"column that is neither granted nor refused, and "
        f"{sorted(declared | excluded - columns)} is named here and not a column")
    assert not (declared & excluded), sorted(declared & excluded)
    assert (len(declared), len(excluded)) == (106, 52)


def test_a_scalar_tree_is_non_repainting_AND_as_of_snapshot__both_verdicts_or_neither():
    """⭐⭐ THE HEADLINE OF THIS TASK, AND THE ZERO IS THE POINT.

    ``ast_reach`` returns ``(back 0, forward 0)`` for a scalar leaf, so
    ``mode_from_reach`` answers ``non-repainting`` — and that answer is CORRECT
    and E1 does not change it. A scalar's value at bar ``i`` does not depend on
    any bar ``j > i``; it is the same number at every bar of the column.

    ⛔ WHICH MEANS THE REPAINT GATE CANNOT FAIL ON A SCALAR. It passes
    ``market_cap > 1e9`` as non-repainting and nothing else fires at all. The
    zero is a true answer to a question nobody asked, and without a second
    verdict there is NO gate on the honesty of a scalar.
    """
    scalar_tree = OP(">", SER("market_cap"), NUM(1e9))
    price_tree = OP(">", SER("close"), NUM(10.0))

    repaint = ast_lint.lint_repaint(scalar_tree)
    assert (repaint["mode"], repaint["forward"], repaint["back"]) == ("non-repainting", 0, 0)
    assert ast_lint.lint_repaint(price_tree)["mode"] == "non-repainting"

    assert ast_freshness.freshness_for(scalar_tree)["mode"] == "as-of-snapshot"
    assert ast_freshness.freshness_for(price_tree)["mode"] == "live"
    # ⭐ The two verdicts are DIFFERENT on the pair, which is what proves the
    # second one is carrying information the first cannot.
    assert (ast_lint.lint_repaint(scalar_tree)["mode"]
            == ast_lint.lint_repaint(price_tree)["mode"])
    assert (ast_freshness.freshness_for(scalar_tree)["mode"]
            != ast_freshness.freshness_for(price_tree)["mode"])


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. RESOLUTION — the scope, the order, and the shadow
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_declared_scalar_RESOLVES_and_the_set_is_DERIVED():
    """The totality rail for the fourth section, both directions.

    A declared-but-unseeded scalar is a name the builder offers and this lane
    refuses — the shape of the bug where an alert naming a JS-only indicator
    could be STORED and could never FIRE. A seeded-but-undeclared one is a name
    outside the closed table.
    """
    for name in SCALARS:
        col = ast_interpret.interpret(SER(name), BARS, scalars={name: 7.25})
        assert col == [7.25] * len(BARS), f"the scalar {name!r} does not resolve"
    # …and the scope holds nothing beyond the table.
    for outsider in ("rugpull_score", "sector", "snapshot_date", "built_at"):
        with pytest.raises(ast_interpret.TableRefusal, match="unknown name"):
            ast_interpret.interpret(SER(outsider), BARS, scalars={outsider: 1.0})


def test_a_planted_scalar_lands_RED_in_BOTH_the_partition_and_the_floor():
    """⭐ THE RAIL IS DERIVED, AND HERE IS THE PROOF.

    A hand-listed rail would be UNMOVED by a manifest entry nobody decided about.
    Planting one into a copy of the real manifest must make the partition report
    it BY NAME and the scalar floor report it BY NAME, without a single edit to
    either rail.
    """
    fake = {k: (dict(v) if isinstance(v, dict) else v) for k, v in TABLE.items()}
    fake["scalars"] = dict(fake["scalars"])
    fake["scalars"]["rugpull_score"] = {
        "source": {"store": "screener_rows", "column": "rugpull_score"},
        "as_of": {"column": "snapshot_date", "grain": "date"},
        "cadence": "nightly", "yields": "num", "sentence": "the rugpull score"}

    declared = {v["source"]["column"] for v in fake["scalars"].values()}
    excluded = set(fake["_scalars_excluded"])
    assert (declared | excluded) - set(COLUMNS) == {"rugpull_score"}, (
        "a planted scalar did NOT break the partition — the identity is a "
        "hand-list, not a derivation")

    with pytest.raises(AssertionError, match=r"rugpull_score"):
        ac.assert_scalar_corpus_covers_the_table(fake, DOC)


def test_an_input_that_shadows_a_declared_SCALAR_raises_and_is_NOT_a_refusal():
    """⛔ A KNOB MAY NOT SILENTLY OUTRANK THE TABLE.

    A definition whose input is called ``market_cap`` would change what every
    formula on it means. That is a WIRING defect, not a rejected formula, so it
    raises a plain ``ValueError`` — the same door a ``close``-shadowing input
    already goes through, which is why the scalars are seeded BEFORE the inputs
    rather than after.
    """
    with pytest.raises(ValueError, match="shadows a table name"):
        ast_interpret.interpret(SER("market_cap"), BARS, inputs={"market_cap": 5})
    with pytest.raises(ValueError, match="shadows a table name"):
        ast_interpret.interpret(SER("close"), BARS, inputs={"rs_rank": 5},
                                scalars={"rs_rank": 1.0})
    assert not isinstance(ValueError(), ast_interpret.TableRefusal)
    # …the control: a knob that shadows NOTHING is seeded and readable.
    assert ast_interpret.interpret(SER("mult"), BARS, inputs={"mult": 3})[0] == 3.0


def test_a_scalar_composes_with_a_bar_series_and_stays_len_bars():
    """⚠️ A SCALAR IS SEEDED AS A BARE NUMBER, NOT A COLUMN — which is exactly
    what makes it composable. ``_lift2`` broadcasts it against a real column, so
    a mixed formula is one aligned column of ``len(bars)`` and never a shorter
    one that silently shifts every index."""
    tree = OP("&&", OP(">", SER("close"), NUM(11.5)), OP(">", SER("rs_rank"), NUM(80)))
    hit = ast_interpret.interpret(tree, BARS, scalars={"rs_rank": 90})
    miss = ast_interpret.interpret(tree, BARS, scalars={"rs_rank": 10})
    assert len(hit) == len(miss) == len(BARS)
    assert hit == [0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
    assert miss == [0.0] * len(BARS)
    # ⛔ AND WITH NO RANK AT ALL THE COLUMN READS 0 — see
    # `test_a_COMPARISON_EATS_THE_HOLE`. The honest answer is not in the column;
    # it is in the question a caller must ask first.
    assert ast_interpret.interpret(tree, BARS) == [0.0] * len(BARS)
    assert ast_interpret.unresolved_scalars(tree, {}) == ["rs_rank"]


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. THE TWO AS-OF FAMILIES — factual, derived from the builder
# ═══════════════════════════════════════════════════════════════════════════ #

def _builder_bar_dated_columns() -> set:
    """The columns ``snapshot_builder`` fills from BARS, read by AST.

    ⭐ DERIVED FROM THE PRODUCER, NEVER TYPED. ``build_row`` sets
    ``bars_asof`` inside the ``if bars:`` block and nowhere else, and that block
    is what merges the technical, candle and pattern groups. So "which family
    does this column belong to" is a fact about the builder's own dictionaries,
    and this reads them out of the three modules that emit them.
    """
    names: set = set()
    for module in ("technicals", "candles", "setup_score"):
        path = ROOT / "api" / "services" / "screener" / f"{module}.py"
        tree = pyast.parse(io.open(path, encoding="utf-8").read())
        for node in pyast.walk(tree):
            if isinstance(node, pyast.Dict):
                for key in node.keys:
                    if isinstance(key, pyast.Constant) and isinstance(key.value, str):
                        names.add(key.value)
            if (isinstance(node, pyast.Subscript)
                    and isinstance(node.slice, pyast.Constant)
                    and isinstance(node.slice.value, str)):
                names.add(node.slice.value)
    return names & set(COLUMNS)


def test_the_two_as_of_families_are_the_BUILDERS_families_and_not_a_taste():
    """⛔ ONE `as_of` WOULD DATE A TECHNICAL BY A FUNDAMENTALS SWEEP.

    ``snapshot_date`` is when the build RAN; ``bars_asof`` is the newest bar the
    maths saw. They are different dates on the same row, and which one dates a
    column is decided by which producer filled it. This reads the bar-fed
    producers' own emitted keys and asserts every one of them is declared
    ``bars_asof`` — so a column that moved producers goes red rather than
    silently wearing the wrong date.
    """
    bar_dated = _builder_bar_dated_columns()
    assert len(bar_dated) >= 25, (
        f"the producer census found only {len(bar_dated)} bar-fed columns; a "
        "census that found almost nothing would pass this vacuously")
    for column in sorted(bar_dated):
        if column not in SCALARS:
            continue          # an excluded column has no `as_of` to be wrong about
        assert ast_table.scalar_as_of(column)["column"] == "bars_asof", (
            f"{column!r} is filled from BARS by the builder but is declared as "
            "dated by the fundamentals sweep")

    families = {ast_table.scalar_as_of(n)["column"] for n in SCALARS}
    assert families == {"snapshot_date", "bars_asof"}, families
    # ⛔ BOTH FAMILIES ARE NON-EMPTY. A single-family table would make the whole
    # two-date argument decorative.
    counts = {f: sum(1 for n in SCALARS if ast_table.scalar_as_of(n)["column"] == f)
              for f in families}
    assert min(counts.values()) >= 10, counts
    # …and every as-of column names a real screener column that is EXCLUDED from
    # the vocabulary, so a formula can never compute on its own freshness stamp.
    for family in families:
        assert family in COLUMNS
        assert family in ast_table.excluded_columns()
        assert family not in SCALARS


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. `yields` — CORRECTION 2, one declaration, every consumer derives
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_operator_function_and_scalar_DECLARES_what_it_yields():
    """⛔ WITHOUT IT, TWO LATER TASKS HAND-LIST THE SAME NINE OPERATORS IN TWO
    LANGUAGES — the two-vocabularies defect this repo has already paid for
    (``williams_r`` here is ``williamsR`` in the chart registry).
    """
    for section in ("operators", "functions", "scalars"):
        for name, spec in TABLE[section].items():
            assert spec.get("yields") in ast_table.YIELDS, (
                f"{section}.{name} declares yields={spec.get('yields')!r}, which is "
                f"not one of {ast_table.YIELDS}")
            assert ast_table.yields_of(name) == spec["yields"]

    # The nine a hand-list would have held, derived rather than typed.
    boolean_ops = {n for n in TABLE["operators"]
                   if ast_table.yields_of(n) == "bool"}
    assert boolean_ops == {">", "<", ">=", "<=", "==", "!=", "&&", "||", "!"}
    assert ast_table.yields_of("?:") == "passthrough", (
        "the ternary is the ONE entry whose result kind is the join of its "
        "branches; forcing it into either two-valued answer is wrong in a "
        "different direction each way")
    assert ast_table.domain_of is ast_table.yields_of, (
        "two names for one reader is fine; two READERS for one fact is the "
        "defect — they must be the same function object")
    with pytest.raises(KeyError):
        ast_table.yields_of("rugpull_score")


def test_an_UNDECLARED_yields_fails_closed_to_the_numeric_answer():
    """⛔ FAIL-CLOSED IS THE NUMERIC DIRECTION. Refusing to call a tree a
    condition costs a user an error message; admitting a real-valued tree as one
    makes ``<tree> != 0`` true for every non-zero price on the board."""
    fake = {"operators": {"@@": {"arity": 2}}, "functions": {}, "scalars": {}}
    assert ast_table.yields_of("@@", fake) == "num"
    assert ast_table.YIELDS_DEFAULT == "num"


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. FRESHNESS — the second verdict, and it must be able to say all three
# ═══════════════════════════════════════════════════════════════════════════ #

@pytest.mark.parametrize("case", DOC["trees"], ids=[c["id"] for c in DOC["trees"]])
def test_every_freshness_tree_gets_the_TWO_verdicts_it_declares(case):
    """Each tree is HAND-DERIVED and carries its own reason in the fixture.

    ⛔ ``freshness`` and ``repaint`` are the SAME fields ``freshness.test.js``
    asserts against, so this is the cross-lane binding. Two independent
    implementations agreeing on seven hand-derived trees is a stronger claim than
    either agreeing with itself.
    """
    got = ast_freshness.freshness_for(case["ast"])
    assert got["mode"] == case["freshness"], (
        f"{case['id']}: expected {case['freshness']}, measured {got['mode']} "
        f"({'; '.join(got['reasons'])}). Read the case's own `why` before "
        "changing either side.")
    assert got["scalars"] == case["scalars"]
    assert ast_lint.lint_repaint(case["ast"])["mode"] == case["repaint"]
    assert got["reasons"], f"{case['id']} produced a verdict with no reason"
    assert case.get("why", "").strip(), f"{case['id']} states no reason"


def test_the_freshness_corpus_is_not_degenerate_in_ANY_direction():
    """⭐ EVERY VALUE IN THE VOCABULARY IS REACHED BY A HAND-DERIVED CASE.

    A corpus in which every tree is ``as-of-snapshot`` measures nothing: a reader
    returning that unconditionally passes all of them. The same is true of a
    reader that returns ``unknown`` unconditionally, which is the fail-closed
    direction and therefore the easy mistake.
    """
    expected = [c["freshness"] for c in DOC["trees"]]
    counts = {m: expected.count(m) for m in ast_freshness.FRESHNESS_MODES}
    assert min(counts.values()) >= 1, counts
    assert set(expected) == set(ast_freshness.FRESHNESS_MODES), counts
    assert ast_freshness.FRESHNESS_MODES == ("live", "as-of-snapshot", "unknown")


def test_freshness_FAILS_CLOSED_when_a_scalars_own_declaration_is_unreadable():
    """⛔ A FALSE `live` IS THE BRAND CLAIM DYING QUIETLY.

    ``lint_repaint`` answers ``repaints`` for a shape it cannot read; this
    answers ``unknown``, which is the same asymmetry one field over. A reader
    that fell back to ``live`` would say "this is as fresh as the tape" about a
    value it could not date at all.
    """
    tree = OP(">", SER("market_cap"), NUM(1.0))
    for broken in ({"cadence": "nightly"},                              # no as_of
                   {"as_of": {"column": "snapshot_date"}},              # no cadence
                   {"as_of": {"column": ""}, "cadence": "nightly"},     # blank column
                   {"as_of": {"column": "snapshot_date"}, "cadence": ""}):
        fake = dict(TABLE)
        fake["scalars"] = dict(TABLE["scalars"], market_cap=broken)
        got = ast_freshness.freshness_for(tree, {"table": fake})
        assert got["mode"] == "unknown", (broken, got)
        assert any("cannot resolve" in r for r in got["reasons"]), got["reasons"]
    # …the control: the SAME tree against the real table is decided.
    assert ast_freshness.freshness_for(tree)["mode"] == "as-of-snapshot"


def test_a_definitions_own_INPUT_is_dated_by_nothing_and_never_makes_a_formula_stale():
    """A per-instance knob is not a snapshot value. ``close * lineWidth`` is as
    live as ``close``; a reader that could not tell them apart would brand every
    builder definition ``unknown``, because every one of them declares
    ``lineWidth``."""
    tree = OP("*", SER("close"), SER("lineWidth"))
    assert ast_freshness.freshness_for(tree, {"inputs": {"lineWidth": True}})["mode"] == "live"
    # …and with the input NOT declared it is unknown, not live.
    assert ast_freshness.freshness_for(tree)["mode"] == "unknown"


def test_the_freshness_reader_reaches_no_evaluator_either():
    """⛔ THE LINTER'S OWN IMPORT RAIL, MIRRORED.

    ``ast_lint`` imports the standard library and nothing else, so a badge cannot
    be reached by RUNNING a formula. This module may import the LINTER — a
    stdlib-only module — and nothing more, so it inherits the property rather
    than re-promising it.
    """
    tree = pyast.parse(pathlib.Path(ast_freshness.__file__).read_text(encoding="utf-8"))
    modules = set()
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Import):
            modules.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, pyast.ImportFrom):
            modules.add(node.module or "")
    assert modules == {"__future__", "typing", "api.services.ast_lint"}, (
        "the freshness reader reaches a module outside the standard library and "
        f"the linter. modules={sorted(modules)}")


def test_freshness_definition_gives_the_SAME_PER_PLOT_SHAPE_as_the_repaint_rows():
    """The two verdicts are reported at the same granularity — the owner's ruling
    is per PLOT, and a freshness row a caller had to assemble itself would drift
    from the repaint row it sits beside."""
    defn = {"id": "u_probe", "compute": {"kind": "ast", "ast": OP(">", SER("market_cap"), NUM(1.0))},
            "inputs": [{"key": "lineWidth"}],
            "plots": [{"key": "value"}]}
    fresh = ast_freshness.freshness_definition(defn)["plots"][0]
    repaint = ast_lint.lint_definition(defn)["plots"][0]
    assert fresh["address"] == repaint["address"] == "u_probe.value"
    assert (fresh["defId"], fresh["plotKey"], fresh["lane"]) == ("u_probe", "value", "ast")
    assert fresh["mode"] == "as-of-snapshot" and repaint["mode"] == "non-repainting"
    # ⛔ A CALLER CANNOT WIDEN THE SCALAR SET BY HANDING ONE IN — the same rail
    # `lint_definition` carries, because an input map that reached this reader
    # would turn every unresolvable name into a `live`.
    smuggled = ast_freshness.freshness_definition(
        {**defn, "inputs": []}, {"inputs": {"rugpull_score": True}})
    assert smuggled["plots"][0]["mode"] == "as-of-snapshot"
    bare = dict(defn, compute={"kind": "ast", "ast": SER("rugpull_score")}, inputs=[])
    assert ast_freshness.freshness_definition(
        bare, {"inputs": {"rugpull_score": True}})["plots"][0]["mode"] == "unknown"
    # A hand-written lane has no tree to read and says so.
    server = dict(defn, compute={"kind": "server", "fn": "rsLine"})
    assert ast_freshness.freshness_definition(server)["plots"][0]["mode"] is None


# ═══════════════════════════════════════════════════════════════════════════ #
# 6. THE TWO FLOORS, AND BOTH LANES OR NEITHER
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_scalar_floor_is_ITS_OWN_and_folding_it_in_ABORTS_the_recorder():
    """⛔ M9's SHAPE, MADE A TEST. ``assert_corpus_covers_the_table`` demands a
    corpus case per BAR name and aborts otherwise. A ``bar_names`` that widened
    to include scalars would demand one new bar-corpus case per scalar, move
    every frozen per-ast digest, and re-freeze a cross-lane oracle for a reason
    that has nothing to do with bars. The equality inside the tool is what makes
    that abort loud instead of a silently regrown obligation.

    ⭐ THE BAR FLOOR MOVED 31 -> 48 AT PHASE F and 48 -> 69 with the pure-math
    block (twelve pointwise functions: sqrt ln log10 exp pow mod idiv sin cos tan
    atan sinh). The scalar floor did not move
    at all, which is the whole reason these are two numbers. Seventeen indicators
    became callable and each one owed a bar-corpus case; not one scalar did.

    ⭐ AND THE SCALAR FLOOR MOVED 54 -> 94 ON THE WAVE-5 STAGE-B BUMP
    (2026-08-22: 28 Wave-2 promotions + 12 Wave-5 declarations) while the BAR
    floor did not move at all — the same partition carrying its weight in the
    other direction: forty per-symbol names became sayable and not one frozen
    per-ast bar digest moved (ruling D15).

    ⭐ THEN 94 -> 98 ON WAVE-6 T1 (2026-08-23): the five Wave-1 preset columns
    promoted (dollar_vol_30d, close_cv_pct, vol_updown_ratio, vol_nweek_low,
    ema_stack_intact) and `accdis` EXCLUDED — it holds letter grades, and
    declaring it `num` was the live two-lane defect. The bar floor, again,
    did not move.

    ⭐ 98 -> 99 (2026-08-23): `hvc_52w` promoted — the owner-confirmed unlock
    for the HVC formula-library starter. A BOOL joined from the breadth
    universe (`context_joins.read_breadth_flags`), so it rides the
    context leg's `snapshot_date` stamp, never `bars_asof`. The bar floor,
    once more, did not move.

    ⭐ 99 -> 106 (2026-08-23): the SEVEN Wave-6 finviz-parity columns, promoted
    in ONE governed bump — `insider_trans_pct`/`inst_trans_pct` (the signed
    ownership CHANGE, which is NOT the `insider_own_pct`/`inst_pct` LEVELS
    already declared beside them), the two `bool` instrument flags
    `optionable`/`shortable`, and the growth trio `eps_past_5y_growth` /
    `eps_next_5y_growth` / `sales_past_5y_growth`. All seven ride the builder's
    FINVIZ leg — `finviz_universe` merges into `market_row`, which `build_row`
    folds in OUTSIDE the `if bars:` block — so every one is stamped
    `snapshot_date`, never `bars_asof`; the as-of rail above judged that rather
    than a guess. ⚠️ THE GROWTH TRIO IS STILL EMPTY AND DECLARING IT ANYWAY IS
    THE DECISION: its header spellings were corrected in `f8374d725` and it
    fills on the next nightly pull, and a formula naming one meanwhile answers
    `not_computable`, which is TRUE. One bump, one provenance decision. The bar
    floor, again, did not move.

    ⭐ 69 -> 70 ON 2026-08-11 WITH ``adx``, AND THIS PAIR OF NUMBERS IS EXACTLY
    WHAT CAUGHT IT. ADX was declared, implemented in both lanes and shipped
    earlier the same day; what it never got was a bar-corpus case, so its
    JS<->Python agreement was asserted by nobody. This assertion went red beside
    ``assert_corpus_covers_the_table`` naming ``adx`` -- two independent rails
    reporting one omission -- and the corpus case ``adx_trend_strength`` was
    written in response. ⛔ THE FIX IS THE CORPUS CASE; MOVING THIS NUMBER IS
    ONLY THE ACKNOWLEDGEMENT. Bumping the literal alone would have left the
    indicator unproven across the lanes and both rails quiet about it."""
    manifest = ac.load_manifest()
    corpus = ac.load_corpus()
    parts = ac.assert_the_two_floors_partition_the_table(manifest)
    assert len(parts["bar"]) == 70 and len(parts["scalar"]) == 106
    assert not (parts["bar"] & parts["scalar"])

    # the control: the unmutated tool accepts the real corpus…
    assert ac.assert_corpus_covers_the_table(manifest, corpus) == parts["bar"]

    # …and a `bar_names` that folded the scalars in aborts it BY NAME.
    real = ast_table.bar_names
    try:
        ast_table.bar_names = lambda m=None: real(m) | ast_table.scalar_names(m)
        with pytest.raises(AssertionError, match="BAR floor is no longer"):
            ac.assert_corpus_covers_the_table(manifest, corpus)
    finally:
        ast_table.bar_names = real
    assert ast_table.bar_names is real
    assert ac.assert_corpus_covers_the_table(manifest, corpus) == parts["bar"]


def test_BOTH_LANES_READ_THE_SAME_TABLE__proved_with_a_planted_synthetic():
    """⛔ NOT "they agree today" — "neither owns a copy".

    An equality against the shipped manifest is satisfied by a hand-copy that was
    correct on the day it was typed. So a SYNTHETIC manifest, whose scalar exists
    nowhere in this repo, is handed to both readers: a reader that consulted its
    own list would ignore it, and a reader that reads the table cannot.
    """
    js_table = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
                / "closedTable.json")
    assert ast_table.MANIFEST_PATH == js_table == ast_lint.TABLE_PATH, (
        "the lanes resolve `closedTable.json` in different places, which is two "
        "files with one name")

    planted = {k: (dict(v) if isinstance(v, dict) else v) for k, v in ast_lint.TABLE.items()}
    planted["scalars"] = {"zzz_planted_scalar": {
        "source": {"store": "zzz", "column": "zzz_planted_scalar"},
        "as_of": {"column": "zzz_dated_by", "grain": "date"},
        "cadence": "hourly", "yields": "bool", "sentence": "the planted probe"}}
    tree = OP(">", SER("zzz_planted_scalar"), NUM(0.0))

    # the LINTER resolves it to (0, 0) — off the planted table, with no edit…
    assert ast_lint.lint_repaint(tree, {"table": planted})["mode"] == "non-repainting"
    # …the FRESHNESS reader dates it off the planted declaration…
    got = ast_freshness.freshness_for(tree, {"table": planted})
    assert got["mode"] == "as-of-snapshot" and got["cadences"] == ["hourly"]
    # …and `yields` comes off the planted entry too.
    assert ast_table.yields_of("zzz_planted_scalar", planted) == "bool"
    # the control: against the REAL table the same name is unresolvable.
    assert ast_lint.lint_repaint(tree)["mode"] == "repaints"
    assert ast_freshness.freshness_for(tree)["mode"] == "unknown"
    assert "zzz_planted_scalar" not in ast_table.declared_names()


@pytest.mark.parametrize("case", DOC["cases"], ids=[c["id"] for c in DOC["cases"]])
def test_every_scalar_in_the_floor_resolves_dates_and_yields_what_it_declares(case):
    """The per-scalar floor. One case per declared name, and the fixture's own
    fields are re-derived from the manifest so a case cannot drift from it."""
    name = case["scalar"]
    assert case["ast"] == SER(name)
    col = ast_interpret.interpret(case["ast"], BARS, scalars={name: case["value"]})
    assert col == [case["value"]] * len(BARS)
    assert ast_table.scalar_as_of(name)["column"] == case["asOf"]
    assert ast_table.scalar_cadence(name) == case["cadence"]
    assert ast_table.yields_of(name) == case["yields"]
    assert ast_table.scalar_source(name)["store"] == "screener_rows"
    assert ast_freshness.freshness_for(case["ast"])["mode"] == "as-of-snapshot"


def test_the_JS_LANE_READS_THIS_SAME_FIXTURE():
    """⚠️ A GREP FOR THE PATH WOULD FIND THIS FILE'S OWN PROSE, so it is asserted
    the honest way `test_ast_lint.py` already uses: the vitest lane's source is
    read and the shared path is looked for in it. The binding between the lanes
    is the fixture's `freshness` / `repaint` fields, which both lanes assert."""
    assert FIXTURE.exists()
    js = JS_FRESHNESS_TEST.read_text(encoding="utf-8")
    assert "tests/fixtures/ast/scalars.json" in js, (
        "the vitest lane no longer reads this fixture, so `freshness` has stopped "
        "being a cross-lane agreement and each lane only agrees with itself")


def test_the_escape_corpus_REFUSES_the_two_kinds_of_excluded_column():
    """The partition says WHY a column is not a name; the escape corpus proves
    that naming one still refuses. Both are needed: the partition could be
    complete while the interpreter quietly resolved an excluded name anyway."""
    doc = ac.load_escapes()
    by_id = {c["id"]: c for c in doc["cases"]}
    for cid, column in (("excluded_column_as_of_source", "snapshot_date"),
                        ("excluded_column_text_typed", "sector")):
        case = by_id[cid]
        assert case["guard"] == "resolve:name"
        assert column in ast_table.excluded_columns()
        assert column in COLUMNS and column not in SCALARS
        with pytest.raises(ast_interpret.TableRefusal, match="unknown name"):
            ast_interpret.interpret(SER(column), BARS)


# ═══════════════════════════════════════════════════════════════════════════ #
# 7. THE CANONICAL VOCABULARY STAYS FOUR
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_scalar_RIDES_the_series_node_and_there_is_no_FIFTH_node_type():
    """⛔ A FIFTH TYPE WOULD REHASH EVERY PERSISTED DEFINITION.

    ``astHash`` is taken over ``{type, …}``, so a ``scalar`` node type is a
    decision that can never be undone without migrating every stored tree. The
    node vocabulary is DERIVED here from the committed corpora rather than read
    off one typed list, so a fifth type arriving anywhere lands red.
    """
    def types_in(node, out):
        stack = [node]
        while stack:
            n = stack.pop()
            if isinstance(n, dict):
                if isinstance(n.get("type"), str):
                    out.add(n["type"])
                for v in n.values():
                    if isinstance(v, (dict, list)):
                        stack.append(v)
            elif isinstance(n, list):
                stack.extend(n)
        return out

    found: set = set()
    for case in DOC["cases"] + DOC["trees"]:
        types_in(case["ast"], found)
    for case in ac.load_corpus()["cases"]:
        types_in(case["ast"], found)
    # ⭐ THE SET IS DERIVED FROM THE CORPORA AND PINNED TO THE ONE DECLARATION.
    # ⚠️ IT WAS ALSO RE-TYPED AS `{"num","series","op","call"}` HERE, which is the
    # restated-count defect wearing a set literal: the day the bounded backward
    # offset landed as a deliberate FIFTH type, this line went red for a change
    # that was correct, and the honest fix is to stop restating it. What this
    # rail is actually about is unchanged and is the line below: a SCALAR still
    # rides the `series` node and never became a node type of its own.
    assert found == set(ast_interpret.NODE_TYPES), found
    assert "scalar" not in found
    assert "offset" in found, (
        "the corpora no longer exercise the offset node, so this rail has stopped "
        "measuring the vocabulary it claims to")

    # …and the walker refuses one outright rather than absorbing it.
    with pytest.raises(ast_interpret.TableRefusal, match="not a canonical node"):
        ast_interpret.interpret({"type": "scalar", "name": "market_cap"}, BARS)
    assert ast_freshness.freshness_for(
        {"type": "scalar", "name": "market_cap"})["mode"] == "unknown"
