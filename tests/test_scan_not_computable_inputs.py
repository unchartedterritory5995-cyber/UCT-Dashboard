"""W9a.1 / X23 — a screen that silently returns NOTHING, or THE ENTIRE UNIVERSE.

🔴 WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE. `_cmp` answers **0** when either
side is NaN. That is deliberate, it is correct for a bar warm-up (*the crossing
did not happen*), it is *"the one place JS and Python agree by luck"*, and it is
pinned by the frozen cross-lane conformance digests. Its cost is that the hole is
visible at the LEAF and invisible one node up — so the design does not change the
comparison, it asks a question BEFORE evaluating. `unresolved_scalars` is that
question on the SCALAR axis and it has been asked since E-1.

⛔ IT WAS THE ONLY AXIS ASKED ABOUT, AND THREE ARE NOW ASKED. Measured on this
branch, on bars built exactly as `scan_evaluator._read_bars` builds them:

    close > vwap()              -> [0.0 x N]   a confident NO  for every symbol
    !(close > vwap())           -> [1.0 x N]   a confident YES for every symbol
    close > sma(close, 300)     -> [0.0 x N]   on a symbol with 100 bars

…each with `answered == evaluated` and `not_computable == 0`. A member is told the
market is quiet, or is handed the whole board, and the receipt agrees with both.

⭐ BOTH POLARITIES ARE RAILED, and that is not thoroughness for its own sake: the
defect has two faces and a rail on one is half a rail. `>` returns nothing; `!`
and `||` return everything, which is the face that puts 3,700 rows in front of a
trader.

⛔ AND THREE IS NOT "ALL". The set the input question sweeps is `BAR_READERS`
∪ the declared scalars -- narrower than "every input that can be a hole" -- and
ONE surface is deliberately left open, pinned by its own test rather than by this
paragraph: a data-dependent hole in an ordinary function (`valuewhen`, which the
manifest cannot currently tell from `sma`). It goes RED the day its fix lands.

⚰️ THERE WERE TWO. The other was a declared all-NaN argument domain
(`macd(close, 26, 12)`) and it was CLOSED on 2026-08-27 -- not here, but at the
resolve pass, as `resolve:domain`, because a fact that is true of the FORMULA on
every row is decided where the formula is admitted rather than 3,742 times a
night. The test that pinned it went RED and was deleted deliberately; what stands
in its place asserts the CLOSURE, so this paragraph cannot quietly re-open.

⭐ AND ONE FIXTURE HERE HOLES AN ENTRY IN THE MIDDLE RATHER THAN AT THE FRONT.
A rail built only on warm-up prefixes measures the easy half: a prefix hole is
also what the history question catches, so it cannot tell which question is
working, and an interior hole slips past all of it. Measured in this wave: a
`barsSince` mutation survived 587 Python and 212 JS tests because both of its
hole fixtures put the hole in a leading prefix.

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


def test_an_OFFSET_above_a_bar_reader_is_asked_about_THE_BAR_IT_ACTUALLY_READS():
    """⭐ ``vwap()[3]`` READS THE BAR THREE BACK, AND THE QUESTION FOLLOWS IT.

    The pre-pass asks about the bar the sweep will READ. An offset above the call
    moves that bar, so asking at the caller's index would be asking about a
    different bar than the walker answers from -- the exact defect threading
    ``index`` and ``opts`` through exists to avoid, one axis over.

    ⚠️ NOT REACHABLE THROUGH TODAY'S TABLE, AND RAILED ANYWAY. A
    ``lookback: "session"`` entry cannot be wrapped in an offset at all (the
    budget cap IS ``sessionMaxBars``), and for a windowed entry the history
    question happens to cover exactly the offsets that matter. Two unrelated
    guards overlapping the hole is correct BY LUCK, and the first anchored entry
    with a small declared lookback breaks both -- so the question is made right
    here rather than left resting on them.
    """
    bars = _bars_from_rows(_daily_rows(n=200))
    inner = lambda: _call("obvN", _num(20))          # noqa: E731 - a fresh node
    off = lambda k, c: {"type": "offset", "value": k, "args": [c]}  # noqa: E731

    if "obvN" not in ast_interpret.BAR_READERS:      # pragma: no cover
        pytest.skip("no windowed bar reader is declared to offset")

    # The bar the offset reads is INSIDE the warm-up, so it is a hole …
    assert ast_interpret.interpret(off(199, inner()), bars)[-1] is None
    deep = _op(">", _series("close"), off(199, inner()))
    assert ast_interpret.interpret(deep, bars)[-1] == 0.0, "not laundered any more"
    assert ast_interpret.unresolved_inputs(deep, {}, bars, -1) == ["obvN"], (
        "the pre-pass read the CALLER's bar instead of the bar the offset "
        "actually reads, and answered about a value the sweep will never see")

    # … and the CONTROL: an offset that lands clear of the warm-up must NOT be
    # refused, or the fix is an over-refusal. ⛔ THE CONTROL IS ON THE ENTRY'S OWN
    # COLUMN, not on the comparison: `close > obvN(...)` is legitimately 0.0 here
    # (a price is not above a volume total), and reading that as "a hole" would
    # be this file's own defect committed inside its control.
    assert ast_interpret.interpret(off(45, inner()), bars)[-1] is not None
    shallow = _op(">", _series("close"), off(45, inner()))
    assert ast_interpret.unresolved_inputs(shallow, {}, bars, -1) == []

    # A bar BEFORE the series starts is a hole too, never a skipped question.
    past = _op(">", _series("close"), off(400, inner()))
    assert ast_interpret.unresolved_inputs(past, {}, bars, -1) == ["obvN"]


def test_an_INTERIOR_hole_is_caught__not_just_a_WARM_UP_PREFIX():
    """⭐⭐ THE HOLE IS AT THE END AND THE VALUES ARE AT THE FRONT — THE INVERSE
    OF A WARM-UP, ON AN ENTRY THIS PRE-PASS COVERS.

    ⛔ WHY THIS CASE EXISTS AT ALL. Every other fixture in this file holes an
    entry in a LEADING PREFIX, which is the easy half: a prefix hole is also what
    the history question catches, so a rail built only on prefixes cannot tell
    which question is doing the work, and a bug whose hole is interior slips
    through all of them. That is not hypothetical — in this same wave a
    `barsSince` mutation SURVIVED 587 Python and 212 JS tests because both of its
    hole fixtures put the hole in a leading prefix where the counter was already 0.

    `avwap`'s RULE 2 gives the inverse shape for free, and it is DECLARED rather
    than contrived: bars more than `sessionMaxBars` past the anchor are not
    computable, *"so every bar it does answer for was computed from inside the
    window it declares"*. Anchor at bar 1 of a 1,000-bar series and the column is

        bar 0         hole    (strictly before the anchor)
        bars 1..961   REAL
        bars 962..999 hole    <- the bar a sweep actually reads

    ⛔ AND THE HISTORY QUESTION IS BLIND TO IT BY CONSTRUCTION: `max_lookback` is
    960 and the series holds 1,000, so `unresolved_lookback` returns 0. Only the
    input question can see this one.
    """
    bars = _instant_bars(n=1000)
    if "avwap" not in ast_interpret.BAR_READERS:          # pragma: no cover
        pytest.skip("no anchored bar reader is declared")

    node = _call("avwap", _num(bars[1]["t"]))
    tree = _op(">", _series("close"), node)
    column = ast_interpret.interpret(node, bars, opts={"tf": "5"})

    holes = [i for i, v in enumerate(column) if v is None]
    assert holes, "the anchored entry no longer holes at all"
    assert holes != list(range(len(holes))), (
        "the hole is a leading prefix again, so this test has quietly become "
        "another copy of the warm-up case and the interior class is unrailed")
    assert column[len(column) // 2] is not None, (
        "the middle of the column is a hole too — the fixture is broken and the "
        "assertions below would pass for the wrong reason")

    # ⛔ THE HISTORY QUESTION CANNOT SEE THIS. If it could, the input question
    # below would be untested here.
    assert ast_interpret.unresolved_lookback(tree, bars) == 0

    # The laundering, at the bar a sweep reads — and the pre-pass catching it.
    assert ast_interpret.interpret(tree, bars, opts={"tf": "5"})[-1] == 0.0
    assert ast_interpret.unresolved_inputs(
        tree, {}, bars, -1, opts={"tf": "5"}) == ["avwap"], (
        "an INTERIOR hole at the read bar was not caught — the pre-pass is only "
        "seeing warm-up prefixes")

    # CONTROL, IN THE SAME FIXTURE: a bar inside the declared window answers.
    assert ast_interpret.unresolved_inputs(
        tree, {}, bars, len(bars) // 2, opts={"tf": "5"}) == [], (
        "the pre-pass refused a bar the entry answers for — an over-refusal that "
        "would cost a member every symbol on a working screen")


def test_a_DATA_DEPENDENT_HOLE_in_an_ORDINARY_function_is_STILL_LAUNDERED():
    """⛔⛔ THE SECOND GAP, PINNED. `valuewhen` IS NEITHER A BAR READER NOR A
    SCALAR, SO THIS PRE-PASS DOES NOT SEE IT AT ALL.

    `valuewhen(cond, src, n)` holes wherever `cond` has not been true within the
    last `n` bars. That is a fact about THE DATA, not about the formula — so the
    argument that sends the `macd` domain error to the save door does NOT cover
    it — and it is not a warm-up either: the values sit at the FRONT and the holes
    run to the END.

    ⛔ AND THE MANIFEST CANNOT CURRENTLY EXPRESS THE DIFFERENCE. `valuewhen`
    declares `lookback: "arg2"` / `yields: "num"`, exactly as `sma` declares
    `lookback: "arg1"` / `yields: "num"`. Nothing in any of the 57 entries
    separates "holes only inside its declared window" from "can hole at any bar",
    so closing this needs a NEW DECLARATION in `closedTable.json` — adding a name
    to `unresolved_inputs` would be the list-that-rots shape the derived set
    exists to avoid. The predicate, and what it costs, is the controller's call;
    this test is here so the gap cannot be forgotten or misremembered.

    ⭐ IT GOES RED THE DAY THE GAP CLOSES, and names what goes stale with it.
    """
    functions = _manifest()["functions"]
    if "valuewhen" not in functions:                       # pragma: no cover
        pytest.skip("valuewhen is not declared in this manifest")
    assert functions["valuewhen"].get("reads") != "bars", (
        "valuewhen now declares reads:'bars', so the derived set covers it and "
        "this test is obsolete — delete it and drop gap (2) from "
        "`unresolved_inputs`' docstring")

    bars = _bars_from_rows(_daily_rows(n=60))
    # `close < 15` is true only on the first few bars, so the hole is INTERIOR:
    # values at the front, holes from bar 14 to the end.
    node = _call("valuewhen", _op("<", _series("close"), _num(15)),
                 _series("close"), _num(10))
    column = ast_interpret.interpret(node, bars)
    holes = [i for i, v in enumerate(column) if v is None]
    assert holes and holes != list(range(len(holes))), (
        "the fixture no longer produces an interior hole")
    assert column[-1] is None

    tree = _op(">", _series("close"), node)
    positive = ast_interpret.interpret(tree, bars)
    negated = ast_interpret.interpret(_op("!", tree), bars)
    # BOTH POLARITIES, ON THE HOLED BARS ONLY. An interior hole means the bars
    # that DO have a value answer honestly, which is exactly why a set-wide
    # assertion here would be wrong -- and why this class is harder to see than
    # the warm-up one, where every bar in the prefix is laundered together.
    assert holes and all(positive[i] == 0.0 and negated[i] == 1.0
                         for i in holes), "the laundering has changed shape"
    assert positive[-1] == 0.0

    # ⛔ THE POINT. Both per-row questions are clean, so every symbol is ANSWERED.
    assert ast_interpret.unresolved_lookback(tree, bars) == 0
    assert ast_interpret.unresolved_inputs(tree, {}, bars, -1) == [], (
        "`valuewhen` is now covered by the input question — the gap is CLOSED. "
        "Delete this test deliberately, drop gap (2) from `unresolved_inputs`' "
        "docstring and from `scan_evaluator`'s comment, and say what the new "
        "predicate is and what IT misses.")


def test_a_DECLARED_DOMAIN_ERROR_is_refused_AT_THE_DOOR__so_this_function_never_sees_it():
    """⚰️⭐ THE GAP THAT WAS PINNED HERE IS CLOSED, AND THIS IS ITS REPLACEMENT.

    Until 2026-08-27 this file carried
    `test_a_DECLARED_DOMAIN_ERROR_is_still_laundered__and_that_is_NOT_this_functions_job`,
    which asserted the OPPOSITE of every line below and promised to go RED the day
    the save door closed. It did, and it was deleted deliberately rather than
    edited into agreement -- the disclaimers it guarded (in `unresolved_inputs`'
    docstring and in `scan_evaluator`'s comment) were dropped in the same commit.

    ⛔ THE FIX IS AT THE RESOLVE PASS, NOT IN THE PRE-PASS, AND THAT DISTINCTION
    IS WHAT THIS TEST ASSERTS. `fast > slow` is a fact about the FORMULA -- true
    on every bar, for every symbol, forever -- so it is decided ONCE where the
    formula is admitted. `unresolved_inputs` is deliberately NOT widened: the
    tree never reaches it, because it never resolves.

    ⛔ BOTH DIRECTIONS, or this is a guard that refuses everything. The
    conventional `macd(close, 12, 26)` must still save and still compute.
    """
    bars = _bars_from_rows(_daily_rows(n=400))
    bad = _call("macd", _series("close"), _num(26), _num(12))   # fast > slow
    tree = _op(">", _series("close"), bad)

    # The manifest DECLARES this, so the case is not an accident of the walker.
    domain = _manifest()["functions"]["macd"]["domain"]
    assert _manifest()["functions"]["macd"][domain] == "arg2", (
        "`macd` no longer declares an argument domain pointing at its lookback; "
        "the premise of this test is gone")

    # ⛔ THE TREE NO LONGER RESOLVES -- by name, at the token, naming the argument.
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.interpret(tree, bars)
    assert exc.value.guard == "resolve:domain"
    assert "macd argument 1 is its fastPeriod at 26" in str(exc.value)

    # …and the SAVE DOOR says no, where it used to hand back `yields: bool`.
    with pytest.raises(scan_definition.ScanRefused) as refused:
        scan_definition.assert_scannable(_definition(tree))
    assert refused.value.gate == "tree"
    assert "resolve:domain" not in str(refused.value)   # the SENTENCE, not the id
    assert "put the larger one in argument 2" in str(refused.value)

    # ⛔ THE CONTROL. The same formula the member meant still saves and still
    # computes -- a guard that refused both would pass half of what matters.
    good = _op(">", _series("close"), _call("macd", _series("close"), _num(12), _num(26)))
    assert scan_definition.assert_scannable(_definition(good))["yields"] == "bool"
    assert len({v for v in ast_interpret.interpret(good, bars) if v is not None}) == 2

    # ⛔ AND EQUAL PERIODS ARE IN DOMAIN, because the declaration is an upper
    # bound and not a strict order: `macd(close, 26, 26)` computes a flat zero.
    equal = _op(">", _series("close"), _call("macd", _series("close"), _num(26), _num(26)))
    assert scan_definition.assert_scannable(_definition(equal))["yields"] == "bool"


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

    # ⭐ THE SUBTREE IS EVALUATED IN THE SWEEP'S OWN ENVIRONMENT — STRUCTURALLY,
    # BECAUSE NOTHING BEHAVIOURAL CAN SEE IT YET. The pre-pass must run the entry
    # under the SAME row, the SAME clock and at the SAME bar the answer will be
    # read from, or it is answering about something else. Dropping `scalars` was
    # a real defect in the first cut of this function and a mutation sweep SAW
    # NOTHING: no declared bar reader takes a `series` argument today
    # (`vwap: []`, `avwap: ["int"]`, `obvN: ["int"]`), so no scalar can reach one
    # and every behavioural rail stayed green.
    # ⛔ THAT IS PRECISELY WHY IT IS PINNED HERE. The docstring promises a third
    # entry is "covered the day it lands"; the first one that accepts a series
    # would report a false `not_computable` naming itself whenever a member's
    # argument names a scalar, and a promise nothing can red on is not a promise.
    call = next(n for n in pyast.walk(pyast.parse(inspect.getsource(
        ast_interpret.unresolved_inputs)))
        if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)
        and n.func.id == "interpret")
    threaded = {kw.arg for kw in call.keywords}
    assert "scalars" in threaded and "opts" in threaded, (
        "the pre-pass evaluates the bar-reader subtree in a DIFFERENT "
        f"environment than the sweep will ({sorted(threaded)}) — it is asking "
        "about a different value than the one the member's answer comes from")

    # …and the bar it asks about follows the offsets on the path to the call.
    src_body = inspect.getsource(ast_interpret.unresolved_inputs)
    assert "index - back" in src_body, (
        "the pre-pass asks about the CALLER's bar rather than the bar an "
        "offset above the call actually reads")
