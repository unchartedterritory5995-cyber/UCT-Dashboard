"""W9a.1 / X23 — a screen that silently returns NOTHING, or THE ENTIRE UNIVERSE.

🔴 WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE. `_cmp` answers **0** when either
side is NaN. That is deliberate, it is correct for a bar warm-up (*the crossing
did not happen*), it is *"the one place JS and Python agree by luck"*, and it is
pinned by the frozen cross-lane conformance digests. Its cost is that the hole is
visible at the LEAF and invisible one node up — so the design does not change the
comparison, it asks a question BEFORE evaluating. `unresolved_scalars` is that
question on the SCALAR axis and it has been asked since E-1.

⛔ IT WAS THE ONLY AXIS ASKED ABOUT, AND THERE ARE THREE. Measured on this branch,
on bars built exactly as `scan_evaluator._read_bars` builds them:

    close > vwap()              -> [0.0 x N]   a confident NO  for every symbol
    !(close > vwap())           -> [1.0 x N]   a confident YES for every symbol
    close > sma(close, 300)     -> [0.0 x N]   on a symbol with 100 bars

…each with `answered == evaluated` and `not_computable == 0`. A member is told the
market is quiet, or is handed the whole board, and the receipt agrees with both.

⭐ BOTH POLARITIES ARE RAILED, and that is not thoroughness for its own sake: the
defect has two faces and a rail on one is half a rail. `>` returns nothing; `!`
and `||` return everything, which is the face that puts 3,700 rows in front of a
trader.

⭐ THE SUBJECT OF THE DERIVED RAIL IS `closedTable.json`, NEVER A LIST TYPED HERE.
The NaN-capable set this file sweeps is *"every entry declaring `reads: 'bars'`"*
— read through `ast_table.bar_readers`, the same declaration the walker's own
dispatch reads — so a third such entry is covered the day it lands with no edit
to this file. `_functions_bar_readers` says the same thing in the manifest's own
words: *"THE SET IS DERIVED, NEVER LISTED."*
"""
from __future__ import annotations

import ast as pyast
import datetime
import inspect
import json
import math
import pathlib

import pytest

from api.services import ast_interpret
from api.services import ast_table
from api.services import indicator_compute
from api.services import scan_definition
from api.services import user_definitions
from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_db

SESSION = 20260807
SESSION_DATE = datetime.date(2026, 8, 7)
TF = scan_evaluator.DEFAULT_TF

#: ⛔ THE MANIFEST ON DISK, not a copy of it. `ast_table` already reads these
#: bytes; the rail asserts the two agree, so a rail deriving its subject from a
#: stale fixture cannot exist.
MANIFEST_PATH = (pathlib.Path(__file__).resolve().parents[1]
                 / "app" / "src" / "components" / "chart" / "engine" / "ast"
                 / "closedTable.json")


# ─── trees ───────────────────────────────────────────────────────────────────

def _series(name):
    return {"type": "series", "name": name}


def _num(value):
    return {"type": "num", "value": value}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _definition(tree, *, def_id="u_000000000001"):
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": "A Screen", "shortName": "SCR",
                 "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree,
                    "fn": user_definitions.ast_hash(tree), "rev": 1},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


# ─── bars ────────────────────────────────────────────────────────────────────

def _daily_rows(n=60, end=SESSION_DATE):
    """The STORE'S OWN shape for `tf="D"` — `ts` is a `YYYYMMDD` int.

    ⭐ THAT INT IS THE WHOLE PREMISE OF THIS FILE and it is asserted, not assumed
    (`test_the_PREMISE_this_file_rests_on_is_ASSERTED_not_assumed`).
    """
    out = []
    for i in range(n):
        d = end - datetime.timedelta(days=n - 1 - i)
        key = d.year * 10_000 + d.month * 100 + d.day
        close = 10.0 + i
        out.append((key, close, close + 1, close - 1, close, 1_000_000))
    return out


def _bars_from_rows(rows):
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            for r in rows]


def _instant_bars(n=120):
    """Bars whose `t` is a REAL unix instant, crossing an ET session boundary.

    ⚠️ TWO ET DAYS, DELIBERATELY. A session accumulator does not answer for bars
    whose session boundary is not visible in the series, so a single-day fixture
    here would be a control that agrees with the subject for the wrong reason.
    """
    out = []
    t0 = 1781046000                      # 2026-06-09 19:00 ET
    for i in range(n):
        c = 10.0 + i * 0.25
        out.append({"t": t0 + i * 300, "o": c, "h": c + 1, "l": c - 1,
                    "c": c, "v": 1_000})
    return out


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — this file is writing "
        "somewhere else")
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    from api.services import bars_sqlite

    table: dict = {}

    def _get(ticker, tf, max_bars):
        return list(table.get(str(ticker).upper()) or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    return table


def _run(tree, universe):
    return scan_evaluator.evaluate_one(_definition(tree), TF,
                                       universe=list(universe), as_of=SESSION)


# ═══ 1. the member-facing defect, BOTH POLARITIES ═══════════════════════════

VWAP = _call("vwap")
GT_VWAP = _op(">", _series("close"), VWAP)

#: ⭐ THE THREE SPELLINGS A MEMBER ACTUALLY TYPES, and they are not variations on
#: one case — they are the two OPPOSITE observable outcomes of one defect.
POLARITIES = {
    "close > vwap()        (returns NOTHING)": GT_VWAP,
    "!(close > vwap())     (returns EVERYTHING)": _op("!", GT_VWAP),
    "(close>vwap())||(v>1) (returns EVERYTHING)": _op(
        "||", GT_VWAP, _op(">", _series("volume"), _num(1))),
}


@pytest.mark.parametrize("label", sorted(POLARITIES))
def test_a_screen_over_a_BAR_READER_is_NOT_COMPUTABLE_and_NAMES_IT(label, store, bars):
    """🔴 THE DEFECT, IN A MEMBER'S OWN SPELLING, IN BOTH DIRECTIONS.

    ⛔ THE ASSERTION IS NOT "the hits are empty". An empty hit list is exactly
    what the `>` face already produced while lying, and the `!`/`||` face is the
    opposite — every symbol a hit. What has to be true is that NEITHER symbol is
    counted as ANSWERED, and that the receipt NAMES what it could not resolve.

    ⚠️ 1,000 BARS, WHICH IS MORE THAN `sessionMaxBars`, SO THIS TEST IS ABOUT ONE
    THING. `vwap()` declares `lookback: "session"` = 960, so a short fixture would
    fail the HISTORY question too and this rail would pass on the wrong axis — a
    control agreeing with its subject for the wrong reason. A real daily store
    holds thousands of bars, so this is also the production shape.
    """
    universe = ["AAA", "BBB"]
    for sym in universe:
        bars[sym] = _daily_rows(n=1000)
    assert ast_interpret.unresolved_lookback(
        VWAP, _bars_from_rows(bars["AAA"])) == 0, (
        "the fixture is short enough for the history question to fire, which "
        "would make the assertions below pass on the wrong axis")

    r = _run(POLARITIES[label], universe)

    assert r["answered"] == 0, (
        f"{label}: the sweep counted a laundered comparison as an answer — "
        "`_cmp` collapsed the hole to a finite 0.0/1.0 and the "
        "`math.isfinite` test downstream cannot see it")
    assert r["not_computable"] == 2, r
    assert r["dropped"] == 0, r
    assert r["hits"] == [], (
        f"{label}: a symbol nothing is known about was returned as a HIT")
    assert r["evaluated"] == r["answered"] + r["dropped"] + r["not_computable"]

    listed = {d["ticker"]: d for d in r["dropped_symbols"]}
    assert set(listed) == set(universe)
    for sym in universe:
        assert listed[sym]["reason"] == scan_evaluator.NOT_COMPUTABLE_REASON
        assert "vwap" in listed[sym]["detail"], (
            "the receipt did not NAME the input it could not resolve — a member "
            f"cannot tell which datum their screen is waiting on "
            f"({listed[sym]['detail']!r})")


def test_the_CONTROL_a_tree_with_no_bar_reader_still_ANSWERS(store, bars):
    """⛔ THE POSITIVE CONTROL. Without it every assertion above is satisfied by
    a sweep that reports `not_computable` for everything — which would read as
    coverage it does not have, in the other direction."""
    universe = ["AAA", "BBB"]
    for sym in universe:
        bars[sym] = _daily_rows()

    r = _run(_op(">", _series("close"), _num(0)), universe)
    assert r["answered"] == 2 and r["not_computable"] == 0, r
    assert sorted(r["hits"]) == universe


def test_the_COVERAGE_IDENTITY_closes_with_not_computable_NON_ZERO(store, bars):
    """⛔ `evaluated == answered + dropped + not_computable`, WITH EVERY TERM
    ALIVE ON ONE FIXTURE.

    ⭐ THE NON-ZERO IS THE LOAD-BEARING HALF. An identity satisfied by a term
    that is always 0 is arithmetic about nothing, and `not_computable` was
    exactly that for a tree naming `vwap()` until this lane: it closed perfectly,
    every night, while the screen it described was wrong for every symbol.

    ⚠️ THE TREE IS THE HISTORY CASE ON PURPOSE. A `vwap()` tree makes EVERY
    symbol on this sweep's daily bars not-computable, so `answered` would be the
    dead term instead — the same vacuity wearing the other polarity.
    """
    tree = _op(">", _series("close"), _call("sma", _series("close"), _num(300)))
    bars["OLD"] = _daily_rows(n=400)         # ANSWERED (and a hit)
    bars["YOUNG"] = _daily_rows(n=100)       # NOT COMPUTABLE
    bars["GONE"] = []                        # a genuine DROP

    r = _run(tree, ["OLD", "YOUNG", "GONE"])

    assert r["evaluated"] == r["answered"] + r["dropped"] + r["not_computable"]
    assert r["evaluated"] == 3, r
    assert r["answered"] >= 1, "no symbol answered — the identity has a dead term"
    assert r["not_computable"] >= 1, "the identity closed on an always-zero term"
    assert r["dropped"] >= 1, "no drop occurred — the identity has a dead term"


# ═══ 2. the DERIVED sweep — subject is closedTable.json ═════════════════════

def _manifest():
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _args_for(name, spec, anchor_instant):
    """A legal call's arguments, DERIVED from the entry's own declaration.

    ⛔ NO HAND LIST. `args`/`argRoles` are read off the manifest, so a third bar
    reader is exercised the day it lands. A future entry whose `int` role is
    neither an anchor nor a window fails HERE, by name, rather than being
    silently skipped — which is the direction this file wants to fail in.
    """
    out = []
    for i, kind in enumerate(spec["args"]):
        role = str(spec["argRoles"][i]).lower()
        if kind == "series":
            out.append(_series("close"))
        elif kind == "int" and "anchor" in role:
            out.append(_num(anchor_instant))
        elif kind == "int":
            out.append(_num(5))
        else:                                             # pragma: no cover
            pytest.fail(
                f"{name} declares argument {i} as {kind!r} (role {role!r}), a "
                "shape this rail has no recipe for. Add one — a bar reader with "
                "no case here is an entry whose hole nothing measures.")
    return out


def _hole_fixtures(met):
    """The bar sets that can put a `reads: "bars"` entry into a hole.

    ⛔ NOT ONE FIXTURE, AND NOT A PER-NAME MAP. The two kinds of hole a bar
    reader has are both declared in the manifest and neither is a property of a
    NAME: an entry anchored to an instant (`lookback: "session"`) holes when the
    bars carry no real instant — which is exactly the sweep's own daily storage —
    and a windowed entry holes on a series shorter than its window. The sweep
    below tries both and requires that at least one holes each declared entry, so
    a third entry of EITHER kind is covered the day it lands, and a fourth kind
    fails BY NAME rather than being skipped.
    """
    return {
        "the sweep's own daily bars — `t` is a YYYYMMDD int, not an instant":
            _bars_from_rows(_daily_rows(n=len(met))),
        "a series shorter than the entry's own declared window":
            met[:2],
    }


def test_EVERY_declared_BAR_READER_is_swept__DERIVED_FROM_THE_MANIFEST():
    """⭐ THE RAIL WHOSE SUBJECT IS THE DATA. Every entry declaring
    `reads: "bars"` must be reported unresolvable on bars that put it in a hole,
    and resolvable on bars that do not — and BOTH directions are asserted per
    entry, so an entry that reads as unresolvable because the fixture is broken
    cannot pass.

    ⛔ THE ROT CONTROLS ARE THE OTHER TWO ASSERTIONS. (1) If no fixture can hole
    a declared entry any more, this fails BY NAME rather than skipping it — a
    rail whose premise has dissolved is a false claim, not a pass. (2) If the
    comparison stops laundering that hole into a confident 0.0, this fails too,
    because that is the premise the whole file rests on.

    ⭐ IT ALREADY EARNED ITS SHAPE: `obvN` landed in `closedTable.json` from a
    parallel lane WHILE this file was being written, and was swept with no edit
    here — which is the entire argument for deriving the set instead of listing it.
    """
    declared = ast_table.bar_readers(_manifest())

    # NON-VACUITY, stated as a floor rather than assumed: the manifest declares
    # bar readers at all, `ast_table` agrees with the file on disk, and the
    # walker binds exactly that set.
    assert len(declared) >= 2, (
        f"the manifest declares {len(declared)} bar readers; this sweep proves "
        "nothing about a set that small")
    assert tuple(declared) == tuple(ast_table.bar_readers()), (
        "ast_table.bar_readers() disagrees with the manifest file this rail "
        "read — one of them is not reading closedTable.json")
    assert set(declared) == set(ast_interpret.BAR_READERS), (
        "the walker's dispatch set and the manifest have forked")

    functions = _manifest()["functions"]
    met = _instant_bars()
    anchor = met[1]["t"]

    swept = {}
    for name in declared:
        spec = functions[name]
        node = _call(name, *_args_for(name, spec, anchor))
        tree = _op(">", _series("close"), node)

        # (a) the entry CAN compute — so (b) is about the bars, not the fixture.
        column = ast_interpret.interpret(node, met, opts={"tf": "5"})
        assert any(isinstance(v, float) and math.isfinite(v) for v in column), (
            f"{name}: the 'computable' fixture produced no value at all, so the "
            "'holed' assertions below would pass for the wrong reason")
        assert ast_interpret.unresolved_inputs(tree, {}, met, -1) == [], (
            f"{name}: reported unresolvable on bars it CAN compute over — this "
            "rail would refuse a working screen")

        # (b) …and on bars that hole it, the comparison launders that hole into a
        #     confident answer, which is what `unresolved_inputs` must catch.
        holed = []
        for why, sample in _hole_fixtures(met).items():
            if ast_interpret.interpret(node, sample,
                                       opts={"tf": TF})[-1] is not None:
                continue
            laundered = ast_interpret.interpret(tree, sample, opts={"tf": TF})
            assert laundered[-1] == 0.0, (
                f"{name}: the premise moved — with {why}, the comparison no "
                f"longer launders this entry's hole into a confident 0.0 (got "
                f"{laundered[-1]!r}). Do not leave a passing test whose reason "
                "has dissolved.")
            assert ast_interpret.unresolved_inputs(tree, {}, sample, -1) == [name], (
                f"{name}: declares reads:'bars' and is NOT asked about before "
                f"the sweep evaluates ({why}) — the hole is laundered and the "
                "receipt says the symbol was answered")
            holed.append(why)

        assert holed, (
            f"{name} declares reads:'bars' and NO fixture in this rail can put "
            "it in a hole any more. Either its holes are gone (then say so, "
            "deliberately) or it holes for a THIRD reason nothing here models — "
            "add the fixture. A declared entry that is silently skipped is the "
            "shape that reads as coverage.")
        swept[name] = holed

    assert sorted(swept) == sorted(declared), (
        f"swept {sorted(swept)} of the declared {list(declared)} — a declared "
        "entry was skipped, which is the shape that reads as coverage")


# ═══ 3. the HISTORY axis — the same defect one axis over ════════════════════

def test_a_SHORT_HISTORY_symbol_is_NOT_COMPUTABLE_not_a_confident_NO(store, bars):
    """🔴 `unresolved_lookback` WAS WRITTEN FOR THIS AND THE SWEEP NEVER CALLED IT.

    Its own docstring measures the case verbatim — *"`interpret(close >
    sma(close, 300))` -> 200 x 0.0, a confident 'no'"* — and names this defect as
    the reason it exists. `alert_user_series` calls it; `scan_evaluator` did not,
    so a symbol that has not lived long enough to answer a 300-bar question was
    reported as a symbol that answered NO.

    ⛔ IT IS `not_computable`, NOT `no-bars`. A drop says *"we tried and failed;
    re-run them"*; re-running tomorrow does not give a symbol more past.
    """
    tree = _op(">", _series("close"), _call("sma", _series("close"), _num(300)))
    bars["YOUNG"] = _daily_rows(n=100)
    bars["OLD"] = _daily_rows(n=400)

    assert set(ast_interpret.interpret(
        tree, _bars_from_rows(bars["YOUNG"]))) == {0.0}, (
        "the premise moved: a short series no longer launders into 0.0")

    r = _run(tree, ["YOUNG", "OLD"])
    assert r["answered"] == 1 and r["not_computable"] == 1, r
    assert r["evaluated"] == r["answered"] + r["dropped"] + r["not_computable"]

    listed = {d["ticker"]: d for d in r["dropped_symbols"]}
    assert set(listed) == {"YOUNG"}, (
        "the symbol with enough history was reported unanswered, or the short "
        "one was counted as an answer")
    detail = listed["YOUNG"]["detail"]
    assert "100" in detail and "300" in detail, (
        "the receipt must say how much history the symbol has and how much the "
        f"tree reads; got {detail!r}")


# ═══ 4. the two operators that disagree about NaN ═══════════════════════════

def test_cmp_COLLAPSES_and_logical_PROPAGATES__and_the_honest_one_is_reachable():
    """⭐⭐ THE SECOND FINDING, SETTLED BY CONSTRUCTION RATHER THAN BY READING.

    `_cmp` collapses NaN to 0; `_logical` propagates it. Two adjacent entries in
    one table disagreeing about what NaN means invites the reading that
    `_logical`'s honesty is UNREACHABLE — a branch that cannot fire, which is
    `lesson_gate_that_cannot_fail` in different clothes.

    ⛔ IT IS REACHABLE, AND THIS IS THE CONSTRUCTION. `&&` declares
    `yields: "bool"` whatever its operands are, so `vwap() && (volume > 1)` is a
    legal, savable scan whose LEFT operand is not a comparison — `_logical` sees
    the NaN and propagates it, and the sweep's own `math.isfinite` test then
    reported the symbol honestly. It has always worked.

    ⚠️ WHAT IS TRUE IS NARROWER AND SHARPER: it is unreachable through the one
    path that matters. A member writes `close > vwap() && volume > 1000`, both
    operands are comparisons, and `_cmp` has destroyed the NaN before `_logical`
    is reached. So the SAME question, spelled two ways, got two different
    receipts — and which one a member got depended on their spelling rather than
    on what was knowable. That is what this lane closes: both spellings now
    report `not_computable`.
    """
    nan = float("nan")

    # The two rules, read off the implementation rather than restated.
    assert ast_interpret._BINARY[">"](nan, 1.0) == 0.0
    assert math.isnan(ast_interpret._BINARY["&&"](nan, 1.0))
    assert math.isnan(ast_interpret._BINARY["||"](nan, 1.0))
    assert math.isnan(ast_interpret._UNARY["!"](nan))

    unmet = _bars_from_rows(_daily_rows(n=8))

    # (a) THROUGH a comparison: `_cmp` ate it and `_logical` never sees a NaN.
    through = _op("&&", GT_VWAP, _op(">", _series("volume"), _num(1)))
    assert set(ast_interpret.interpret(through, unmet, opts={"tf": TF})) == {0.0}

    # (b) WITHOUT one: `_logical`'s NaN branch fires, and the tree is savable.
    direct = _op("&&", VWAP, _op(">", _series("volume"), _num(1)))
    assert scan_definition.assert_scannable(
        _definition(direct))["yields"] == "bool", (
        "the comparison-free spelling is refused at the save door, which would "
        "make `_logical`'s NaN branch unreachable after all — this verdict "
        "would need re-deriving")
    assert ast_interpret.interpret(direct, unmet, opts={"tf": TF}) == \
        [None] * len(unmet)

    # (c) AND THE FIX MAKES THE RECEIPT INDEPENDENT OF THE SPELLING.
    assert ast_interpret.unresolved_inputs(through, {}, unmet, -1) == ["vwap"]
    assert ast_interpret.unresolved_inputs(direct, {}, unmet, -1) == ["vwap"]


# ═══ 5. the premise, and the declarations this file makes ═══════════════════

def test_the_PREMISE_this_file_rests_on_is_ASSERTED_not_assumed():
    """⛔ THE ROT CONTROL FOR THE WHOLE FILE.

    Every fixture above is a hole because the nightly sweep runs `DEFAULT_TF` and
    `bars_sqlite` stores daily bars with `ts` as a `YYYYMMDD` int, which is below
    `VWAP_MIN_INSTANT` and is refused as a unit error. If someone makes
    `_read_bars` hand out real instants, these bars stop being holes and every
    assertion above would pass for a reason that no longer exists.

    So the premise is named, read from its OWNER, and asserted here — one place,
    where a change to it fails by name.
    """
    assert scan_evaluator.DEFAULT_TF == "D", (
        "the nightly sweep no longer runs the daily timeframe; the premise "
        "below is about daily storage")
    sample = _daily_rows(n=3)[0][0]
    assert sample < indicator_compute.VWAP_MIN_INSTANT, (
        f"the store's daily key {sample} is no longer below VWAP_MIN_INSTANT "
        f"({indicator_compute.VWAP_MIN_INSTANT}); this file's fixtures are no "
        "longer holes and its assertions have become vacuous")
    assert indicator_compute.AVWAP_MIN_INSTANT is indicator_compute.VWAP_MIN_INSTANT


def test_the_JS_LANE_DELIBERATELY_HAS_NO_TWIN__and_the_declaration_is_TRUE():
    """⚠️ `unresolved_scalars` DECLARES ITSELF *"PYTHON-ONLY, DECLARED RATHER
    THAN FORGOTTEN"*. Widening it to `unresolved_inputs` had to keep that true,
    or the JS lane would owe a mirror it does not need.

    It stays true for the reason the original gives: the consumer is the
    server-side universe sweep, which owes a member a COVERAGE RECEIPT. A browser
    evaluates ONE symbol, holds its own bars, and draws a hole as a gap in the
    line — there is no receipt there to protect, so a mirrored export would be a
    callable nothing calls, the silently-dead shape this phase exists to retire.

    ⛔ AND THE DECLARATION IS CHECKED, not merely repeated: the JS interpreter
    exports no such name.
    """
    js = (MANIFEST_PATH.parent / "interpret.js").read_text(encoding="utf-8")
    assert "unresolvedInputs" not in js and "unresolvedScalars" not in js, (
        "the JS lane grew a twin of a question the browser does not ask — "
        "either it has a real consumer (then the docstring's declaration is now "
        "FALSE and must be corrected) or it is dead code")
    doc = inspect.getdoc(ast_interpret.unresolved_inputs) or ""
    assert "PYTHON-ONLY" in doc, (
        "the widened question dropped the declaration it inherited")


def test_the_WIDER_QUESTION_still_CONTAINS_the_narrow_one__BY_AST():
    """⛔ `unresolved_inputs` MUST CALL `unresolved_scalars`, NOT RE-DERIVE IT.

    Two implementations of *"which declared scalars have no value here"* is this
    repo's most repeated defect, and the first thing that would diverge is the
    `math.isfinite` rule that makes the whole question work.
    """
    tree = pyast.parse(inspect.getsource(ast_interpret.unresolved_inputs))
    names = {n.func.id for n in pyast.walk(tree)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)}
    assert "unresolved_scalars" in names
    assert "interpret" in names, (
        "the bar-reader verdict is no longer the BINDING's — if this function "
        "restates VWAP_MIN_INSTANT or avwap's rules it is a second authority "
        "over the same value")

    body = inspect.getsource(ast_interpret.unresolved_inputs).split('"""')[-1]
    assert "BAR_READERS" in body, (
        "the NaN-capable set is no longer read off closedTable.json")
    assert "vwap" not in body and "avwap" not in body, (
        "the NaN-capable set is hand-listed rather than derived from "
        "closedTable.json")
