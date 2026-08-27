"""`pivothigh`/`pivotlow` — the SECOND and THIRD entries in this manifest that
produce `preview-repaints`, and the first that a member can reach in three
arguments.

⭐ WHY THAT MATTERS MORE THAN "two more functions". Until these landed, exactly
ONE declared entry had a `forward` (`ichimokuChikou`, `forward: "arg4"`, behind a
six-argument call). That scarcity did measurable damage: a review concluded a
defect was *"latent because every table-legal tree is non-repainting today"* —
false, and it was repeated into a brief; a mutation "did not discriminate"
because no fixture could produce two differing verdicts; and `canSaveFormula`'s
`acknowledged` branch was believed to be dead code. It is not. **This file is the
fixture that makes the repaint machinery non-hypothetical**, so every claim in it
is a number rather than an absence.

⛔ THE EMISSION CONVENTION, PINNED. `pivothigh(src, left, right)` answers at bar
`i` with `src[i]` iff `src[i]` is the STRICT maximum over `[i-left, i+right]`,
else NOT COMPUTABLE. It emits ON THE PIVOT BAR — which is a forward read, and the
manifest says so (`forward: "arg2"`), which is exactly why the badge is
`preview-repaints` rather than a lie.

⚠️ THIS IS NOT THE SAME FUNCTION AS `pivots.test.js`'s COMPOSED PIVOT, and the
difference is the point rather than a conflict. That one is assembled from
backward offsets, so it CANNOT read forward and must fire `right` bars LATE; it
is `non-repainting` and its own test says firing on the pivot bar *"would be a
forward read"*. True — of a composition. This entry declares the forward read
instead of hiding it behind a lag, and a member picks by what they need: the
composed form to act on, this one to draw where the pivot actually is.
"""
from __future__ import annotations

import math
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac  # noqa: E402
from api.services import ast_budget, ast_interpret, ast_lint, ast_table  # noqa: E402

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

#: ⭐ THE SHARED FIXTURE, quoted from `pivots.test.js` so the two lanes measure
#: the same series. Peaks at index 3 (20) and 17 (25), a lesser one at 8 (15).
HIGHS = [10, 11, 12, 20, 13, 12, 11, 14, 15, 13, 12, 11, 10, 11, 12, 13, 14, 25,
         16, 15, 14, 13, 12, 11, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
         22, 23, 24, 25]
#: The control: strictly rising, so no bar is ever a strict interior maximum.
RAMP = [10 + i for i in range(40)]
#: ⛔ THE TAIL FIXTURE, AND IT EXISTS BECAUSE MY FIRST ONE PROVED NOTHING.
#: `HIGHS`' own tail is a strict ramp, so its last bars are decided-NOT-a-pivot
#: anyway and widening the fetch changed **0 bars** — measured. Raising index 36
#: to 30 puts a REAL pivot in the undecidable tail, so the two cases separate.
TAIL = HIGHS[:36] + [30] + HIGHS[37:]
#: A plateau: the max appears TWICE, so under a STRICT rule neither bar is a
#: pivot. A `>=` implementation emits both and looks perfectly reasonable.
PLATEAU = [10, 11, 12, 20, 20, 12, 11, 10]
#: ⭐ LEFT AND RIGHT ARE NOT INTERCHANGEABLE, and this is the series that proves
#: it: `(1, 3)` finds two pivots and `(3, 1)` finds none.
ASYM = [10, 30, 11, 12, 20, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]


def bars_of(values):
    """One series, spread across all four price fields so either entry can read it."""
    return [{"t": 1780000000 + i * 300, "o": float(v), "h": float(v),
             "l": float(v), "c": float(v), "v": 1000 + i}
            for i, v in enumerate(values)]


def at(col, i):
    v = col[i]
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else v


def hits(col):
    return [(i, at(col, i)) for i in range(len(col)) if at(col, i) is not None]


def run(ast, values):
    return ast_interpret.interpret(ast, bars_of(values), {})


PH = lambda l, r: CALL("pivothigh", SER("high"), NUM(l), NUM(r))   # noqa: E731, E741
PL = lambda l, r: CALL("pivotlow", SER("low"), NUM(l), NUM(r))     # noqa: E731, E741


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE COLUMNS, HAND-COUNTED
# ═══════════════════════════════════════════════════════════════════════════ #

def test_pivothigh_emits_the_pivot_PRICE_on_the_pivot_BAR_and_nowhere_else():
    """⛔ THE VALUE IS THE PRICE, NOT A FLAG. A 0/1 column would be a different
    function wearing the name, and a member drawing pivots needs the level."""
    col = run(PH(2, 2), HIGHS)
    assert hits(col) == [(3, 20.0), (8, 15.0), (17, 25.0)], hits(col)
    # …and the emission is ON the pivot bar, so bar 5 — where the COMPOSED pivot
    # in `pivots.test.js` fires — is empty here.
    assert at(col, 5) is None, at(col, 5)


def test_pivotlow_is_the_same_function_with_the_comparison_turned_over():
    col = run(PL(2, 2), [-h + 40 for h in HIGHS])
    assert hits(col) == [(3, 20.0), (8, 25.0), (17, 15.0)], hits(col)


def test_a_STRICT_RAMP_has_no_pivots_at_all():
    """⛔ THE CONTROL. Without it an implementation that emitted on every bar
    would satisfy every case above at the three bars they name."""
    assert hits(run(PH(2, 2), RAMP)) == []
    assert hits(run(PL(2, 2), RAMP)) == []


def test_a_PLATEAU_IS_NOT_A_PIVOT_because_the_rule_is_STRICT():
    """⛔ THE RULING, AND IT IS INVISIBLE ON A SERIES WITH NO TIES. Two equal
    maxima mean neither bar is uniquely the extreme, so neither is a pivot. A
    `>=` implementation emits BOTH and looks entirely reasonable — see the corpus
    case below for how many real bars separate the two rules."""
    assert hits(run(PH(2, 2), PLATEAU)) == []
    assert hits(run(PL(2, 2), [-v for v in PLATEAU])) == []


def test_LEFT_and_RIGHT_are_not_interchangeable():
    """⛔ THE SLOT-ORDER RAIL. `lookback: "arg1"` and `forward: "arg2"` name
    different slots, and a lane that read them the other way round would still
    produce a plausible column on any SYMMETRIC fixture — which is every other
    case in this file."""
    assert hits(run(PH(1, 3), ASYM)) == [(1, 30.0), (4, 20.0)], hits(run(PH(1, 3), ASYM))
    assert hits(run(PH(3, 1), ASYM)) == [], hits(run(PH(3, 1), ASYM))


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. ⛔ THE TAIL — "not yet decidable" is NOT "decided false"
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_TAIL_is_NOT_YET_DECIDABLE_and_the_fetch_proves_which_bars_those_are():
    """⛔⛔ BOTH READ AS NaN IN THE COLUMN, AND THAT IS THE WHOLE DIFFICULTY.
    `pivothigh` answers a price or nothing, so a bar that is *decided not a
    pivot* and a bar that *cannot be decided yet* are the same blank. The
    distinction is not visible in one column — it is visible when the FETCH
    WIDENS: a decided bar keeps its answer forever, an undecidable one can
    change.

    ⭐ AND THAT IS EXACTLY WHAT `preview-repaints` MEANS, made concrete. The
    value at bar `i` is not settled until bar `i + right` exists. This is the
    repaint, measured rather than asserted.

    ⚰️ MY FIRST TAIL FIXTURE PROVED NOTHING: `HIGHS` ends in a strict ramp, so its
    last bars are decided-not-a-pivot anyway and widening the fetch changed **0
    bars**. `TAIL` puts a real pivot at index 36 so the two cases separate.
    """
    short = ast_interpret.interpret(PH(2, 2), bars_of(TAIL[:38]), {})
    full = ast_interpret.interpret(PH(2, 2), bars_of(TAIL), {})

    # Both bars are blank at the short fetch — indistinguishable there.
    assert at(short, 36) is None and at(short, 37) is None

    # …and they resolve DIFFERENTLY once the two missing bars arrive.
    assert at(full, 36) == 30.0, at(full, 36)      # was NOT YET DECIDABLE
    assert at(full, 37) is None, at(full, 37)      # is DECIDED NOT a pivot

    # ⛔ AND EVERY BAR OUTSIDE THE LAST `right` IS ALREADY FINAL. This is the
    # other half: `preview-repaints` promises settlement AT k, so nothing before
    # `len - right` may move.
    moved = [i for i in range(38 - 2)
             if (at(short, i) is None) != (at(full, i) is None)
             or (at(short, i) is not None and at(short, i) != at(full, i))]
    assert moved == [], moved
    assert len(short) == 38 and len(full) == 40


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. ⭐ THE REPAINT VERDICT — the machinery this task makes non-hypothetical
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_pivot_lints_PREVIEW_REPAINTS_and_names_the_bar_it_settles_on():
    reach = ast_lint.ast_reach(PH(2, 2))
    assert reach["forward"] == 2, reach
    assert reach["back"] == 2, reach
    assert ast_lint.mode_from_reach(reach["forward"]) == "preview-repaints"
    verdict = ast_lint.lint_repaint(PH(2, 2))
    assert verdict["mode"] == "preview-repaints", verdict
    # …and the reach follows the ARGUMENTS, not a constant.
    assert ast_lint.ast_reach(PH(1, 5))["forward"] == 5
    assert ast_lint.ast_reach(PH(1, 5))["back"] == 1


def test_the_FORWARD_DECLARATION_IS_LOAD_BEARING_and_here_is_the_control():
    """⛔ THE MUTATION THE SPEC ASKS FOR, AS A CASE. A copy of the entry with its
    `forward` REMOVED lints `non-repainting` — so the badge is carried by the
    declaration and not by the function's name, its arity, or anything else that
    happens to be true of it. Driven through a PLANTED manifest, so the shipped
    one is untouched."""
    # ⛔ `ast_lint.TABLE`, NOT `ast_table.TABLE` — AND THAT IS A REAL TRAP, NOT
    # A STYLE CHOICE. `ast_table.TABLE` is DEEP-FROZEN into `mappingproxy`, and
    # `ast_lint._own_window` opens with `if not isinstance(spec, dict)` — a
    # `mappingproxy` is not a `dict` subclass, so handing the frozen manifest in
    # as `opts["table"]` makes EVERY entry unanalysable and every tree
    # `repaints`. It fails in the SAFE direction, and it is invisible: the
    # verdict is a plausible one. Measured while writing this case.
    table = dict(ast_lint.TABLE)
    fns = dict(table["functions"])
    spec = dict(fns["pivothigh"])
    assert "forward" in spec, spec
    backward_only = {k: v for k, v in spec.items() if k != "forward"}
    fns["zzBackwardOnlyPivot"] = backward_only
    table["functions"] = fns

    tree = CALL("zzBackwardOnlyPivot", SER("high"), NUM(2), NUM(2))
    got = ast_lint.lint_repaint(tree, {"table": table})
    assert got["forward"] == 0, got
    assert got["mode"] == "non-repainting", got
    # …while the real entry, through the SAME planted table, still repaints.
    real = ast_lint.lint_repaint(PH(2, 2), {"table": table})
    assert real["mode"] == "preview-repaints", real


def test_a_TWO_PLOT_DOCUMENT_with_two_DIFFERENT_verdicts_is_now_buildable():
    """⭐⭐ THE THING NOBODY COULD BUILD FROM THE SHIPPED TABLE UNTIL NOW.

    `lint_definition` has returned `(defId, plotKey) -> verdict` since Task 7 and
    the owner's ruling is per PLOT — but with one `forward` entry in the whole
    manifest, hidden behind a six-argument Ichimoku call, no ordinary two-plot
    document could hold two DIFFERENT verdicts. So the per-plot machinery was
    exercised only against documents where every row agreed, and three separate
    claims were made about it that a real mixed document would have refuted.

    Here is the mixed document, in the simplest form a member could type.
    """
    defn = {
        "id": "zz_mixed",
        "compute": {"kind": "ast", "trees": {
            "avg": CALL("sma", SER("close"), NUM(20)),
            "pivot": PH(2, 2),
        }},
        "plots": [{"key": "avg", "label": "Average"},
                  {"key": "pivot", "label": "Pivot high"}],
    }
    rows = {r["plotKey"]: r for r in ast_lint.lint_definition(defn)["plots"]}
    assert rows["avg"]["mode"] == "non-repainting", rows["avg"]
    assert rows["pivot"]["mode"] == "preview-repaints", rows["pivot"]
    assert rows["pivot"]["forward"] == 2, rows["pivot"]
    assert rows["avg"]["forward"] == 0, rows["avg"]
    # ⛔ AND THE TWO ROWS ARE DECIDED, so a surface that renders only decided
    # rows renders BOTH — the case where a roll-up has to choose.
    assert {r["decidability"] for r in rows.values()} == {"decided"}


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. THE BUDGET — a forward reach costs no HISTORY, and that is deliberate
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_FORWARD_reach_spends_no_LOOKBACK_budget_and_the_left_side_still_does():
    """⚠️ TWO WINDOWS, ONE OF THEM FREE, STATED SO IT IS NOT READ AS AN OVERSIGHT.
    `budget:lookback` caps how much HISTORY a formula asks for; a forward reach
    asks for none — it makes the last `right` bars unusable, which is the repaint
    linter's business and is already reported there. So `pivothigh(high, 2, 900)`
    fits the budget while `pivothigh(high, 900, 2)` does not, at the same node
    count."""
    cap = ast_budget.DEFAULT_BUDGET["maxLookback"]
    assert ast_budget.budget_result(PH(2, cap + 1), None)["ok"] is True
    over = ast_budget.budget_result(PH(cap + 1, 2), None)
    assert over["ok"] is False and over["guard"] == "budget:lookback", over
    # …and `max_lookback` reads the LEFT slot, so the two are not symmetric.
    assert ast_interpret.max_lookback(PH(7, 3)) == 7


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. THE CORPUS — counts, never absences
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_corpus_SEES_the_STRICTNESS_ruling_and_here_is_the_COUNT():
    """⛔ A COUNT, BECAUSE AN ABSENCE GOES STALE SILENTLY. The last brief in this
    lane claimed the corpus could not see a tie-break; measured, it held 56 tie
    windows in `high` and 36 in `low`. So this one is measured up front: how many
    bars of the committed 579-bar series would a `>=` implementation emit that
    the STRICT rule refuses?
    """
    bars = ac.corpus_bars()
    assert len(bars) == 579, len(bars)
    plateau = {}
    for field in ("h", "l"):
        col = [float(b[field]) for b in bars]
        pick = max if field == "h" else min
        plateau[field] = sum(
            1 for i in range(2, len(col) - 2)
            if col[i] == pick(col[i - 2:i + 3]) and col[i - 2:i + 3].count(col[i]) > 1)
    assert plateau == {"h": 20, "l": 15}, plateau

    # …and the entries really do answer over this series, at a rate worth pinning.
    for ast, want in ((PH(2, 2), 54), (PL(2, 2), 54)):
        col = ast_interpret.interpret(ast, bars, {})
        assert sum(1 for v in col if v is not None) == want, (
            ast["name"], sum(1 for v in col if v is not None))


# ═══════════════════════════════════════════════════════════════════════════ #
# 6. ⭐ BOTH LANES, SEPARATELY
# ═══════════════════════════════════════════════════════════════════════════ #

JS_RULINGS = [
    ("js_pivothigh_on_the_pivot_bar", PH(2, 2), HIGHS, [(3, 20.0), (8, 15.0), (17, 25.0)]),
    ("js_pivothigh_ramp_control", PH(2, 2), RAMP, []),
    ("js_pivothigh_plateau_is_not_a_pivot", PH(2, 2), PLATEAU, []),
    ("js_pivothigh_left_and_right_not_swapped", PH(1, 3), ASYM, [(1, 30.0), (4, 20.0)]),
    ("js_pivothigh_swapped_finds_nothing", PH(3, 1), ASYM, []),
    ("js_pivotlow_mirrors", PL(2, 2), [-h + 40 for h in HIGHS],
     [(3, 20.0), (8, 25.0), (17, 15.0)]),
    ("js_pivothigh_tail_undecidable", PH(2, 2), TAIL[:38], [(3, 20.0), (8, 15.0), (17, 25.0)]),
    ("js_pivothigh_tail_resolves", PH(2, 2), TAIL,
     [(3, 20.0), (8, 15.0), (17, 25.0), (36, 30.0)]),
]


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node / no JS interpreter")
def test_every_pivot_ruling_holds_in_the_JS_lane_on_its_own():
    """⛔ NOT A CROSS-LANE EQUALITY. Two lanes that both admitted a plateau, or
    both swapped left and right, would agree perfectly and both be wrong. Every
    row asserts the DECLARED answer against `interpret.js` alone."""
    for cid, ast, values, want in JS_RULINGS:
        col = ac.run_js([{"id": cid, "ast": ast}], bars_of(values))[cid]
        assert len(col) == len(values), (cid, len(col))
        got = [(i, col[i]) for i in range(len(col)) if col[i] is not None]
        assert got == want, (cid, got, want)
