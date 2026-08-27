"""The five BOUNDED STATE entries — `barssince`, `valuewhen`, `highestbars`,
`lowestbars`, `obvN` — and the three decisions a value comparison cannot see.

⭐ WHY THIS FILE IS SEPARATE FROM `test_ast_interpret.py`. That file covers the
DECISIONS the closed table makes about shapes and domains; this one covers the
rulings these five entries carry that nothing else in the table has had to make
before:

  1. ⛔⛔ **THE TIE-BREAK.** `highestbars`/`lowestbars` return an OFFSET, and an
     offset has an answer where a VALUE does not: when two bars in the window
     tie, `highest` returns the same number either way and `highestbars` does
     not. Two hand-written lanes will each pick one, both will look obviously
     right, and **a corpus is blind to it unless a fixture happens to contain a
     tie** (`lesson_a_corpus_is_blind_beside_what_it_measures`: zero drift across
     24 fixtures coexisted with two live mistranslations). So the rule is
     DECLARED in `closedTable.json` and measured here over a CONSTRUCTED tie, in
     BOTH lanes, rather than left to whichever series the corpus happens to hold.

  2. ⛔ **THE LEFT EDGE.** All five answer a window, so a bar whose window runs
     off the start of the FETCH is NOT COMPUTABLE — never a sentinel, never a
     zero. `lesson_a_derived_value_must_not_depend_on_the_request`: a `barssince`
     that said "10 bars, not seen" on bar 0 would say something different the
     moment the fetch widened by one bar. ⭐ AND THE CONVERSE IS THE HALF THAT
     IS EASY TO GET WRONG: a bar that FINDS its answer inside the bars it has
     answers, however short the fetch, because widening the fetch cannot move a
     hit that is already the nearest one.

  3. ⛔ **A HOLE IN THE CONDITION IS NOT A FALSE BAR.** `barssince`'s sentinel is
     a claim about `n` bars it actually READ; a NaN condition bar stops the
     backward scan, so the sentinel is withheld until `n` contiguous readable
     bars exist.

⚠️ WHAT THIS FILE DOES NOT COVER, named so nobody reads it as covered. The
cross-lane NUMBERS over the real 579-bar series are
`tools/ast_conformance.py --check`; the tie cases below are CONSTRUCTED inputs
that the real series does not contain, which is the whole reason they are here
and not only there.
"""
from __future__ import annotations

import math
import pathlib
import re
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac  # noqa: E402
from api.services import ast_budget, ast_interpret, ast_table  # noqa: E402

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731


def mk_bars(rows, t0=1780000000, step=300):
    """`(o, h, l, c, v)` tuples -> bar dicts on a 5-minute clock."""
    return [{"t": t0 + i * step, "o": o, "h": h, "l": lo, "c": c, "v": v}
            for i, (o, h, lo, c, v) in enumerate(rows)]


# ⭐ 260 BARS, AND THE NON-VACUITY FLOOR IS WHY. A window function measured over
# a series barely longer than its window is measured almost entirely on its own
# warm-up pad: every assertion would be about NaN and the maths would be
# untested. The task's floor is >200 FINITE bars per column, and the assertions
# below spend it.
#
# The rule, so every expected value below is hand-countable:
#   * bars 0..219   — `close > open` exactly when `i % 3 == 0`
#   * bars 220..259 — a 40-bar DROUGHT: no up bar at all, so every window
#     function crosses from "answered" to "the window holds nothing" INSIDE the
#     series rather than at its edge.
#   * `open` rises 0.1 a bar, so no two bars share a price by accident and the
#     tie fixture below is the only tie anywhere in this file.
def _rows():
    rows = []
    for i in range(260):
        up = (i % 3 == 0) and i < 220
        o = 100.0 + i * 0.1
        c = o + 1.0 if up else o - 1.0
        rows.append((o, max(o, c) + 0.5, min(o, c) - 0.5, c, 1000 + i))
    return rows


BARS = mk_bars(_rows())
#: The control. Every bar identical — so `close > open` is never true, and every
#: window is a total tie.
FLAT = mk_bars([(100.0, 100.0, 100.0, 100.0, 1000)] * 260)

IS_UP = OP(">", SER("close"), SER("open"))


def run(ast, bars=BARS):
    return ast_interpret.interpret(ast, bars, {})


def finite(col):
    return [v for v in col
            if v is not None and not (isinstance(v, float) and math.isnan(v))]


def at(col, i):
    v = col[i]
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else v


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE FIVE COLUMNS, HAND-COUNTED
# ═══════════════════════════════════════════════════════════════════════════ #

def test_barssince_counts_to_the_last_true_bar_and_saturates_at_its_window():
    col = run(CALL("barssince", IS_UP, NUM(10)))
    assert len(col) == len(BARS)
    # bars 0..219: up on every third bar, so the count IS `i % 3`.
    for i in (0, 1, 2, 3, 100, 101, 102, 219):
        assert at(col, i) == i % 3, (i, at(col, i))
    # the drought: bar 219 was the last up bar, so the count climbs one a bar…
    for i in range(220, 229):
        assert at(col, i) == i - 219, (i, at(col, i))
    # …and STOPS at the window. ⛔ 10 is the SENTINEL "not true within the last
    # 10 bars", not a count — at bar 259 the true bar is 40 bars back.
    for i in (229, 230, 259):
        assert at(col, i) == 10, (i, at(col, i))
    assert len(finite(col)) > 200, len(finite(col))


def test_barssince_on_a_flat_series_is_the_SENTINEL_and_NOT_COMPUTABLE_before():
    """⛔ THE LEFT EDGE, AND IT IS THE WHOLE REASON A SENTINEL IS NOT ENOUGH.

    `close > open` is never true here. From bar 9 on, ten real bars have been
    looked at and the answer "not within the last 10" is a FACT. Before bar 9 the
    window runs off the start of the FETCH, and "10" there would be a different
    answer the moment somebody asked for one more bar of history —
    `lesson_a_derived_value_must_not_depend_on_the_request`.
    """
    col = run(CALL("barssince", IS_UP, NUM(10)), FLAT)
    for i in range(9):
        assert at(col, i) is None, (i, at(col, i))
    for i in (9, 10, 259):
        assert at(col, i) == 10, (i, at(col, i))
    assert len(finite(col)) > 200, len(finite(col))


def test_barssince_answers_a_HIT_it_can_see_however_short_the_fetch():
    """⭐ THE OTHER HALF OF THE LEFT EDGE, AND THE ONE A SENTINEL-ONLY RULE GETS
    WRONG. Bar 0 of `BARS` is an up bar, so `barssince` is **0** there even
    though nine tenths of its window is off the front of the series. That is not
    a partial answer: no wider fetch can put a NEARER true bar between bar 0 and
    itself, so the number is already final. The withheld case is the SENTINEL,
    which is a claim about bars nobody read.
    """
    col = run(CALL("barssince", IS_UP, NUM(10)))
    assert at(col, 0) == 0, at(col, 0)
    wider = ast_interpret.interpret(CALL("barssince", IS_UP, NUM(10)), BARS, {})
    narrow = ast_interpret.interpret(CALL("barssince", IS_UP, NUM(10)), BARS[:40], {})
    # …and every bar the SHORT fetch answers, the long one answers identically.
    answered = [i for i in range(40) if at(narrow, i) is not None]
    assert len(answered) >= 30, answered
    for i in answered:
        assert at(narrow, i) == at(wider, i), (i, at(narrow, i), at(wider, i))


def test_valuewhen_carries_the_last_true_bars_value_and_goes_blank_past_the_window():
    col = run(CALL("valuewhen", IS_UP, SER("close"), NUM(10)))
    closes = [b["c"] for b in BARS]
    for i in (0, 1, 2, 3, 100, 101, 219):
        assert at(col, i) == pytest.approx(closes[i - i % 3]), (i, at(col, i))
    # the drought: bar 219's close is carried while it is still inside the window…
    for i in range(220, 229):
        assert at(col, i) == pytest.approx(closes[219]), (i, at(col, i))
    # …and then there is NOTHING to carry. ⛔ NOT the last value it saw — a stale
    # price held past its declared window is a confident wrong number.
    for i in (229, 230, 259):
        assert at(col, i) is None, (i, at(col, i))
    assert len(finite(col)) > 200, len(finite(col))


def test_valuewhen_on_a_flat_series_never_carries_anything():
    col = run(CALL("valuewhen", IS_UP, SER("close"), NUM(10)), FLAT)
    assert finite(col) == []


def test_highestbars_is_zero_at_a_fresh_high_and_points_back_at_the_local_one():
    col = run(CALL("highestbars", SER("high"), NUM(5)))
    # ⭐ bars 0..3 have no full 5-bar window. The same pad `highest(high, 5)` has.
    for i in range(4):
        assert at(col, i) is None, (i, at(col, i))
    # An up bar's high clears the 0.1-a-bar drift by a whole point, so the most
    # recent up bar owns the window: the offset is `i % 3`.
    for i in (4, 5, 6, 100, 101, 102, 219):
        assert at(col, i) == i % 3, (i, at(col, i))
    # In the drought the highs rise monotonically, so every bar IS the high.
    for i in (224, 225, 259):
        assert at(col, i) == 0, (i, at(col, i))
    assert len(finite(col)) > 200, len(finite(col))


def test_lowestbars_points_back_at_the_lowest_bar_of_the_window():
    col = run(CALL("lowestbars", SER("low"), NUM(5)))
    for i in range(4):
        assert at(col, i) is None, (i, at(col, i))
    lows = [b["l"] for b in BARS]
    for i in (4, 5, 6, 100, 150, 219, 240, 259):
        window = lows[i - 4:i + 1]
        want = 4 - max(j for j, v in enumerate(window) if v == min(window))
        assert at(col, i) == want, (i, at(col, i), window)
    assert len(finite(col)) > 200, len(finite(col))


def test_obvN_is_the_signed_volume_of_its_window_and_nothing_older():
    col = run(CALL("obvN", NUM(5)))
    # ⭐ THE HAND SUM, WRITTEN OUT. Closes move by whole points against a 0.1
    # drift, so the SIGN of each bar's move is decided by `i % 3`: up on 0 and 2,
    # down on 1.
    #   bar 100's window is bars 96..100
    #   96%3=0 -> +1096 | 97%3=1 -> -1097 | 98%3=2 -> +1098
    #   99%3=0 -> +1099 | 100%3=1 -> -1100
    #   1096 - 1097 + 1098 + 1099 - 1100 = 1096
    assert at(col, 100) == pytest.approx(1096.0)
    for i in range(5):
        assert at(col, i) is None, (i, at(col, i))
    assert len(finite(col)) > 200, len(finite(col))


def test_obvN_is_BOUNDED_BY_ITS_WINDOW_while_the_unbounded_level_runs_away():
    """⛔ AND IT IS NOT A LEVEL — MEASURED AGAINST THE LEVEL ITSELF, NOT AGAINST
    A TYPED CONSTANT.

    ⚰️ THIS ASSERTION WAS `abs(obvN(5)[105]) < 3000` AND IT WAS **FALSE**: the
    real number there is 3309, because five consecutive bars of this series carry
    four up-moves and one down. A hand-typed bound beside the series it claims to
    describe is the defect the ledger is full of, so the bound is now DERIVED —
    the sum of the window's own volumes, which is the largest number a signed sum
    of them can reach. The claim that MATTERS is the comparison: the unbounded
    level is an order of magnitude bigger by bar 259 and still growing, and this
    is not.
    """
    col = run(CALL("obvN", NUM(5)))
    vols = [float(b["v"]) for b in BARS]
    for i in (105, 200, 259):
        ceiling = sum(vols[i - 4:i + 1])
        assert abs(at(col, i)) <= ceiling, (i, at(col, i), ceiling)
    # ⭐ THE CONTROL THAT MAKES THE CEILING A CLAIM RATHER THAN A TAUTOLOGY: an
    # UNBOUNDED OBV over these same bars is far past it and growing.
    from api.services.indicator_compute import compute_obv_raw
    level = compute_obv_raw(BARS)
    assert abs(level[259]) > 10 * sum(vols[255:260]), (level[259],)
    assert abs(level[259]) > abs(level[105]), (level[105], level[259])


def test_obvN_on_a_flat_series_is_EXACTLY_zero_rather_than_blank():
    """⚠️ THE ONE CONTROL THAT IS NOT A HOLE. A bar that closes unchanged
    contributes nothing — that is `computeOBV`'s own rule, and the windowed form
    inherits it — so a flat series answers 0, which is a FACT about the window
    and not a warm-up."""
    col = run(CALL("obvN", NUM(5)), FLAT)
    for i in range(5):
        assert at(col, i) is None, (i, at(col, i))
    assert all(at(col, i) == 0.0 for i in range(5, 260))
    assert len(finite(col)) > 200, len(finite(col))


def test_obvN_answers_the_same_number_however_much_history_was_fetched():
    """⛔⛔ THE PROPERTY THAT MAKES IT DECLARABLE WHERE `obv` IS REFUSED.

    `_functions_excluded.obv` refuses the LEVEL because it is a fact about where
    the fetch started. The windowed form is that level's INCREMENT over a
    declared window, and the start cancels — so the same bar reads the same
    number off a 60-bar fetch and off a 260-bar one. That is the claim the
    exclusion reason now makes; this measures it.

    ⭐ AND THE CONTROL IS THE LEVEL ITSELF: on the same two fetches `obv` would
    disagree on every bar, which is why it is still refused.
    """
    from api.services.indicator_compute import compute_obv_raw

    wide = run(CALL("obvN", NUM(5)))
    narrow = ast_interpret.interpret(CALL("obvN", NUM(5)), BARS[200:], {})
    for i in range(205, 260):
        assert at(narrow, i - 200) == pytest.approx(at(wide, i)), i
    level_wide = compute_obv_raw(BARS)
    level_narrow = compute_obv_raw(BARS[200:])
    disagree = [i for i in range(205, 260)
                if level_narrow[i - 200] != level_wide[i]]
    assert len(disagree) == 55, len(disagree)


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. ⛔⛔ THE TIE-BREAK — CONSTRUCTED, AND MEASURED IN BOTH LANES
# ═══════════════════════════════════════════════════════════════════════════ #
#
# 🔴 THE MEASURED REASON THIS SECTION EXISTS. `highest(x, n)` returns the same
# number whichever of two equal bars "won"; `highestbars(x, n)` does not. So the
# tie-break is a decision a value corpus is STRUCTURALLY unable to see — it shows
# up only on an input that CONTAINS a tie, and the committed 579-bar series holds
# none in `high` or `low`. Two lanes would each pick one and stay green forever.

#: A window of five in which the maximum appears TWICE and the minimum appears
#: TWICE, at known offsets. Bars 5..9 are the window ending at bar 9:
#:
#:   offset      4    3    2    1    0
#:   high      5.0  9.0  3.0  9.0  1.0   -> max 9.0 at offsets 3 and 1
#:   low       2.0  8.0  2.0  6.0  7.0   -> min 2.0 at offsets 4 and 2
TIE_ROWS = [(1.0, 5.0, 2.0, 1.0, 10),
            (1.0, 4.0, 3.0, 1.0, 10),
            (1.0, 4.0, 3.0, 1.0, 10),
            (1.0, 4.0, 3.0, 1.0, 10),
            (1.0, 4.0, 3.0, 1.0, 10),
            (1.0, 5.0, 2.0, 1.0, 10),
            (1.0, 9.0, 8.0, 1.0, 10),
            (1.0, 3.0, 2.0, 1.0, 10),
            (1.0, 9.0, 6.0, 1.0, 10),
            (1.0, 1.0, 7.0, 1.0, 10)]
TIE_BARS = mk_bars(TIE_ROWS)

#: ⭐ THE DECLARED ANSWER — THE MOST RECENT BAR WINS, so the offset is the
#: SMALLEST one that reaches the extreme. Under the other convention these read
#: 3 and 4.
TIE_CASES = [
    {"id": "tie_highestbars",
     "ast": CALL("highestbars", SER("high"), NUM(5)), "want": 1, "other": 3},
    {"id": "tie_lowestbars",
     "ast": CALL("lowestbars", SER("low"), NUM(5)), "want": 2, "other": 4},
]


def test_the_manifest_DECLARES_the_tie_break_rather_than_leaving_it_to_two_walkers():
    """⛔ ONE DECLARATION, TWO LANES. A tie-break that lives only in two
    implementations IS two implementations, and the point of `closedTable.json`
    is that a rule both lanes obey is DATA. Read off the manifest, so neither
    lane can answer this question privately."""
    note = ast_table.TABLE["_functions_arg_extreme"]
    assert isinstance(note, str) and len(note) > 200
    assert "most recent" in note.lower(), note
    for name in ("highestbars", "lowestbars"):
        spec = ast_table.TABLE["functions"][name]
        assert spec["yields"] == "num"
        assert "most recent" in spec["sentence"].lower(), spec["sentence"]


def test_the_tie_break_is_MOST_RECENT_WINS_in_the_python_lane():
    for case in TIE_CASES:
        col = ast_interpret.interpret(case["ast"], TIE_BARS, {})
        assert at(col, 9) == case["want"], (case["id"], at(col, 9))


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node / no JS interpreter")
def test_the_tie_break_is_MOST_RECENT_WINS_in_the_js_lane_too():
    """⭐ THE SAME CONSTRUCTED INPUT, THROUGH `interpret.js`. ⛔ NOT a cross-lane
    EQUALITY — two lanes that both picked the oldest bar would agree perfectly and
    both be wrong. This asserts the DECLARED number on each side separately, which
    is the only shape that survives both lanes being written by one author."""
    cols = ac.run_js([{"id": c["id"], "ast": c["ast"]} for c in TIE_CASES], TIE_BARS)
    for case in TIE_CASES:
        assert cols[case["id"]][9] == case["want"], (case["id"], cols[case["id"]])


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node / no JS interpreter")
def test_a_TOTAL_tie_reads_zero_in_both_lanes_and_that_is_the_flat_series_case():
    """⭐ THE CHEAPEST TIE THERE IS, and the one a member meets first: a series
    that does not move. Under "the most recent bar wins" every bar is its own
    5-bar high, so the column is 0; under the other convention it would be 4, on
    every bar, forever. A WHOLE COLUMN that differs by the ruling."""
    ast = CALL("highestbars", SER("high"), NUM(5))
    py = ast_interpret.interpret(ast, FLAT, {})
    js = ac.run_js([{"id": "flat", "ast": ast}], FLAT)["flat"]
    assert [at(py, i) for i in range(4, 20)] == [0] * 16
    assert js[4:20] == [0] * 16


#: ⭐ THE DECLARED NUMBERS, ONE PER RULING, ASSERTED IN **EACH LANE SEPARATELY**.
#:
#: 🔴 A MEASURED SWEEP SURVIVOR IS WHY THIS EXISTS. Making `interpret.js`'s
#: `valueWhen` hold its carried price PAST the declared window — deleting
#: `since < n` — left BOTH suites green: the Python twin was railed by the
#: hand-counted cases above, the corpus could not see it (the real 579-bar series
#: has an up bar at least every ten bars, so the drought that exposes the rule
#: never occurs in it), and a cross-lane EQUALITY cannot catch a lane that is
#: alone in being wrong. `lesson_rail_the_mirror_not_just_the_lane`: a fix rails
#: the lane you are thinking about and leaves the twin green and unguarded.
#:
#: ⛔ SO EVERY ROW BELOW IS A NUMBER THE MANIFEST DECLARES, CHECKED AGAINST
#: `interpret.js` ON ITS OWN — never against the Python column.
JS_RULINGS = [
    # (id, ast, bars, [(bar, want)], what a wrong lane would say)
    ("js_barssince_sentinel_needs_a_full_window",
     CALL("barssince", IS_UP, NUM(10)), "FLAT",
     [(0, None), (8, None), (9, 10), (259, 10)],
     "a sentinel before ten bars were read"),
    ("js_barssince_counts_and_then_saturates",
     CALL("barssince", IS_UP, NUM(10)), "BARS",
     [(0, 0), (101, 2), (228, 9), (229, 10), (259, 10)],
     "a count that runs past its declared window"),
    ("js_valuewhen_goes_blank_past_its_window",
     CALL("valuewhen", IS_UP, SER("close"), NUM(10)), "BARS",
     [(228, 122.9), (229, None), (259, None)],
     "a stale price held past the window it declares"),
    ("js_highestbars_offset",
     CALL("highestbars", SER("high"), NUM(5)), "BARS",
     [(3, None), (4, 1), (102, 0), (259, 0)],
     "the wrong bar named, or the warm-up pad dropped"),
    ("js_lowestbars_offset",
     CALL("lowestbars", SER("low"), NUM(5)), "BARS",
     [(3, None), (4, 3), (259, 4)],
     "the wrong bar named"),
    ("js_obvN_is_the_window_not_the_level",
     CALL("obvN", NUM(5)), "BARS",
     [(4, None), (5, 1005.0), (100, 1096.0)],
     "OBV's unbounded level wearing the bounded name"),
    ("js_obvN_on_a_flat_series_is_exactly_zero",
     CALL("obvN", NUM(5)), "FLAT",
     [(4, None), (5, 0.0), (259, 0.0)],
     "a flat series answering anything but zero"),
    # 🔴 A SECOND MEASURED SURVIVOR, AND THE ONE THE FIRST PASS OF THIS LIST
    # MISSED. Deleting `run = 0` from `interpret.js`'s NaN branch — so a
    # NOT-COMPUTABLE condition bar stops RESETTING the readable run — left every
    # row above green, because `close > open` is finite on every bar of both
    # fixtures and neither can contain a hole. The condition below is a CROSSING,
    # the only 0/1 shape in this table that carries NaN, and under that mutation
    # the sentinel arrives at bar 9 instead of bar 39.
    ("js_barssince_withholds_the_sentinel_across_a_hole",
     CALL("barssince",
          CALL("crossOver", SER("close"), CALL("sma", SER("close"), NUM(30))),
          NUM(10)), "BARS",
     [(0, None), (9, None), (29, None), (38, None), (39, 10), (259, 10)],
     "a sentinel counted across bars the engine could not read"),
    ("js_barssince_resumes_the_bar_after_a_hole_closes",
     CALL("barssince",
          CALL("crossOver", SER("close"), CALL("sma", SER("close"), NUM(3))),
          NUM(10)), "BARS",
     [(0, None), (2, None), (3, 0), (4, 1), (5, 2), (6, 0)],
     "a hole latching the column blank forever"),
]


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node / no JS interpreter")
def test_every_bounded_state_RULING_holds_in_the_JS_lane_on_its_own():
    """⛔ NOT A CROSS-LANE EQUALITY. Two lanes that are wrong together agree
    perfectly; this asserts the DECLARED number against `interpret.js` alone, so a
    mutation in one lane cannot hide behind the other."""
    fixtures = {"BARS": BARS, "FLAT": FLAT}
    for which in ("BARS", "FLAT"):
        cases = [{"id": r[0], "ast": r[1]} for r in JS_RULINGS if r[2] == which]
        cols = ac.run_js(cases, fixtures[which])
        for cid, _ast, _b, wants, wrong in (r for r in JS_RULINGS if r[2] == which):
            col = cols[cid]
            assert len(col) == 260, (cid, len(col))
            for i, want in wants:
                got = col[i]
                if want is None:
                    assert got is None, (cid, i, got, wrong)
                else:
                    assert got == pytest.approx(want), (cid, i, got, want, wrong)
            # NON-VACUITY per row: a column of nulls satisfies every `None` above.
            assert sum(1 for v in col if v is not None) > 200, (cid, wrong)


def test_the_tie_fixture_really_CONTAINS_a_tie_so_the_cases_above_are_not_vacuous():
    """⛔ THE CONTROL FOR THE CONTROL. A tie fixture with no tie in it passes
    under BOTH conventions, which is exactly the blindness this section exists to
    remove."""
    highs = [b["h"] for b in TIE_BARS[5:10]]
    lows = [b["l"] for b in TIE_BARS[5:10]]
    assert highs.count(max(highs)) == 2, highs
    assert lows.count(min(lows)) == 2, lows
    # …and the two conventions really would disagree on THIS window.
    for case, series in ((TIE_CASES[0], highs), (TIE_CASES[1], lows)):
        pick = max if series is highs else min
        hits = [j for j, v in enumerate(series) if v == pick(series)]
        assert 4 - max(hits) == case["want"]
        assert 4 - min(hits) == case["other"]


def test_the_corpus_DOES_see_the_tie_break_and_here_is_how_much_of_it():
    """⚰️⚰️ THE CLAIM I ARRIVED WITH WAS FALSE, AND THE MEASUREMENT IS WHY THIS
    CASE EXISTS AT ALL.

    The task text, the manifest note I first wrote, and my own reasoning all said
    *"the committed 579-bar series contains no tie, so the corpus is structurally
    blind to the tie-break"*. **It contains 56.** Walking the real replay bars, 56
    of the 5-bar windows of `high` and 36 of `low` hold their extreme TWICE, and on
    every one of them the two conventions name a DIFFERENT bar — so the frozen
    digest of a `highestbars(high, 5)` corpus case moves if the tie-break flips.

    ⭐ THAT IS BETTER NEWS THAN THE PREMISE, AND IT IS WHY THE NUMBERS ARE ASSERTED
    RATHER THAN THE ABSENCE: the ruling is caught in THREE independent places — the
    constructed fixture above, per lane; the cross-lane comparison; and the
    conformance digest. But the digest catches it only for the WINDOW the corpus
    case happens to use, and only while the series keeps its ties. A NUMBER here
    fails loudly if either changes; *"assert there are none"* would have frozen a
    false sentence into the manifest, which is the defect this wave keeps paying
    for.

    ⛔ SO THE CONSTRUCTED FIXTURE IS NOT REDUNDANT, and this case names the two
    things it covers that the corpus cannot: a TOTAL tie (every bar of the window
    equal — no corpus window of `high` or `low` is flat, and `volume` has no tie at
    all), and an assertion of the DECLARED NUMBER on each lane SEPARATELY rather
    than of the two lanes agreeing with each other.
    """
    bars = ac.corpus_bars()
    assert len(bars) > 500, len(bars)

    def sweep(field, n, pick):
        col = [float(b[field]) for b in bars]
        ties = disagree = 0
        for i in range(n - 1, len(col)):
            win = col[i - n + 1:i + 1]
            hits = [j for j, v in enumerate(win) if v == pick(win)]
            if len(hits) > 1:
                ties += 1
                if max(hits) != min(hits):
                    disagree += 1
        return ties, disagree

    assert sweep("h", 5, max) == (56, 56), sweep("h", 5, max)
    assert sweep("l", 5, min) == (36, 36), sweep("l", 5, min)

    # ⛔ AND THE CORPUS CASE THAT SPENDS THEM REALLY IS IN THE CORPUS. Without a
    # `highestbars` case those 56 windows are 56 windows nothing looks at, and this
    # whole paragraph would describe a coverage that does not exist.
    corpus = ac.load_corpus()
    named = {n for c in corpus["cases"] for n in ac.names_in(c["ast"])}
    for name in ("highestbars", "lowestbars"):
        assert name in named, f"{name} has no corpus case, so no digest pins it"

    # ⭐ THE HALF THE CORPUS CANNOT REACH: a TOTAL tie.
    assert sweep("v", 5, max) == (0, 0), sweep("v", 5, max)
    flat = 0
    for field in ("h", "l"):
        col = [float(b[field]) for b in bars]
        flat += sum(1 for i in range(4, len(col))
                    if len(set(col[i - 4:i + 1])) == 1)
    assert flat == 0, flat


def test_highestbars_agrees_with_highest_about_WHICH_bar_it_names():
    """⭐ THE JOIN, AND IT IS WHY A WRONG TIE-BREAK CAN BE INVISIBLE. `highest`
    names the VALUE and `highestbars` names the BAR; if they ever disagreed,
    `high[highestbars(high, n)] != highest(high, n)` and a member reading both
    would have two answers about one window."""
    off = run(CALL("highestbars", SER("high"), NUM(5)))
    top = run(CALL("highest", SER("high"), NUM(5)))
    highs = [b["h"] for b in BARS]
    checked = 0
    for i in range(len(BARS)):
        if at(off, i) is None:
            continue
        assert highs[i - int(at(off, i))] == pytest.approx(at(top, i)), i
        checked += 1
    assert checked > 200, checked


def test_a_NaN_anywhere_in_the_window_blanks_the_offset_exactly_as_it_blanks_the_VALUE():
    """⛔ THE SAME RULE `windowExtreme` ALREADY STATES: *"NaN does not lose a
    comparison"*. A hole in the window means the extreme is UNKNOWN, so naming a
    bar for it would be a confident wrong answer — and it must blank on exactly
    the bars `highest` blanks on, or the two disagree about one window again."""
    src = CALL("sma", SER("high"), NUM(30))     # a 29-bar hole at the front
    off = run(CALL("highestbars", src, NUM(5)))
    top = run(CALL("highest", src, NUM(5)))
    blank_off = [i for i in range(len(BARS)) if at(off, i) is None]
    blank_top = [i for i in range(len(BARS)) if at(top, i) is None]
    assert blank_off == blank_top, (blank_off[:8], blank_top[:8])
    assert len(blank_off) >= 33, blank_off


# ─────────────────────────────────────────────────────────────────────────── #
# ⛔ A HOLE IN THE CONDITION — AND THE CONDITION HAS TO REALLY HOLD ONE
# ─────────────────────────────────────────────────────────────────────────── #
#
# ⚰️ THE FIRST DRAFT OF THIS SECTION USED `sma(close, 30) > open` AS ITS "HOLE",
# AND THAT CONDITION HAS NO HOLE IN IT. `_cmp` turns NaN into **0.0** — the
# `_booleans` rule, deliberate and far older than these entries — so a comparison
# over a 29-bar warm-up is a column of confident FALSE, not a column of unknowns
# (this is X23, and section 5 measures what it costs a member). The only 0/1
# columns in this table that carry NaN at all are `crossOver`/`crossUnder` and the
# logical operators, so the hole below is built from a crossing.

#: A 30-bar hole that NEVER FIRES afterwards: this series drifts 0.1 a bar, so
#: `close` sits above its own 30-bar mean on every bar and the crossing never
#: happens. That makes it the strongest possible probe of the SENTINEL rule.
LONG_HOLE = CALL("crossOver", SER("close"), CALL("sma", SER("close"), NUM(30)))
#: A 3-bar hole that DOES fire afterwards — the same rule, with the answer
#: resuming, so the case above cannot pass for the wrong reason.
SHORT_HOLE = CALL("crossOver", SER("close"), CALL("sma", SER("close"), NUM(3)))


def test_a_HOLE_in_the_condition_withholds_the_sentinel_until_n_readable_bars_exist():
    """⛔ AN UNKNOWN CONDITION IS NOT A FALSE ONE, AND THE SENTINEL IS A CLAIM
    ABOUT BARS THAT WERE READ.

    `crossOver(close, sma(close, 30))` is NOT COMPUTABLE for thirty bars. The
    sentinel `10` says *"not true in the last 10 bars"*; at bar 9 this engine has
    read no condition bar at all, and at bar 35 it has read six. It may not say
    `10` until bar **39** — the first bar with ten contiguous readable condition
    bars behind it. ⛔ A walker that counted a hole as FALSE would answer `10`
    from bar 9 and be wrong for thirty bars, in a way nothing else here can see.
    """
    since = run(CALL("barssince", LONG_HOLE, NUM(10)))
    assert [i for i in range(50) if at(since, i) is not None] == list(range(39, 50))
    assert at(since, 39) == 10, at(since, 39)
    assert len(finite(since)) > 200, len(finite(since))
    # …and `valuewhen` has nothing to carry across the same hole, ever.
    when = run(CALL("valuewhen", LONG_HOLE, SER("close"), NUM(10)))
    assert finite(when) == []


def test_the_answer_RESUMES_the_bar_after_the_hole_closes():
    """⭐ THE CONTROL FOR THE CASE ABOVE. A `barssince` that simply refused
    forever once it met a NaN would pass that test perfectly. Here the hole is
    three bars wide and the condition fires on the fourth, so both columns must
    answer from bar 3 — the hole is a hole, not a latch.
    """
    since = run(CALL("barssince", SHORT_HOLE, NUM(10)))
    when = run(CALL("valuewhen", SHORT_HOLE, SER("close"), NUM(10)))
    closes = [b["c"] for b in BARS]
    for i in range(3):
        assert at(since, i) is None, (i, at(since, i))
        assert at(when, i) is None, (i, at(when, i))
    assert at(since, 3) == 0, at(since, 3)
    assert at(when, 3) == pytest.approx(closes[3]), at(when, 3)
    assert len(finite(since)) > 200, len(finite(since))
    assert len(finite(when)) > 200, len(finite(when))


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. ⭐ RAILS WHOSE SUBJECT IS THE SHARED MANIFEST
# ═══════════════════════════════════════════════════════════════════════════ #

def test_an_entry_READS_THE_BARS_exactly_when_it_declares_no_series_argument():
    """⭐⭐ THE INVARIANT BEHIND `reads: "bars"`, DERIVED FROM THE MANIFEST RATHER
    THAN FROM THE NAMES THAT HAVE IT TODAY.

    `_functions_bar_readers` argues the rule out loud: `_bind_shipped` fabricates
    `t` as a bar INDEX precisely because it packs bars out of argument COLUMNS, so
    an entry with no columns to pack is handed the real bars instead. Both halves
    bite. An entry with a series argument that ALSO read the bars would have two
    sources for one series; an entry with NO series argument that did NOT read
    them is a function of its integers alone — a constant column.

    ⛔ A SWEEP, NOT A LIST. A fourth bar reader lands covered on the day it lands,
    in both lanes, with no edit here.
    """
    wrong = []
    for name, spec in ast_table.TABLE["functions"].items():
        reads_bars = spec.get("reads") == "bars"
        has_series = any(k != "int" for k in spec["args"])
        if reads_bars and has_series:
            wrong.append(f"{name}: reads the bars AND declares a series argument")
        if not reads_bars and not has_series:
            wrong.append(f"{name}: declares no series argument and does not read the bars")
    assert not wrong, wrong
    declared = set(ast_table.bar_readers())
    assert declared == {n for n, s in ast_table.TABLE["functions"].items()
                        if not any(k != "int" for k in s["args"])}
    assert len(declared) >= 3, sorted(declared)


def test_the_bar_reader_invariant_CATCHES_a_planted_violation_of_either_half():
    """⛔ THE NON-VACUITY CONTROL FOR THE SWEEP ABOVE. A rule that holds over
    fifty-seven entries proves nothing unless breaking it is visible, and BOTH
    halves have to be — the sweep above is two rules wearing one assertion."""
    def offenders(functions):
        out = []
        for name, spec in functions.items():
            reads_bars = spec.get("reads") == "bars"
            has_series = any(k != "int" for k in spec["args"])
            if reads_bars and has_series:
                out.append(f"{name}:both")
            if not reads_bars and not has_series:
                out.append(f"{name}:neither")
        return out

    real = dict(ast_table.TABLE["functions"])
    assert offenders(real) == []
    both = dict(real, zz_both={"args": ["series", "int"], "reads": "bars"})
    assert "zz_both:both" in offenders(both)
    neither = dict(real, zz_neither={"args": ["int"]})
    assert "zz_neither:neither" in offenders(neither)


def bounded_state_names():
    """The bounded-state roster, DERIVED FROM THE MANIFEST'S OWN NOTE.

    ⛔ NOT A LIST IN THIS FILE, AND THE REASON IS MEASURED RATHER THAN
    PRINCIPLED. When `obvN` landed, W9a's DERIVED bar-reader sweep covered it with
    no edit at all while FOUR hand-listed assertions in neighbouring files went
    red on the same entry. So the subject is read out of
    `_functions_bounded_state` — every backticked `name(` it spells that the table
    actually declares — which makes the note load-bearing in both directions: a
    sixth entry added to it is covered the day it lands, and a note that quietly
    stops naming one SHRINKS the rail and fails the floor below.
    """
    note = ast_table.TABLE["_functions_bounded_state"]
    spelled = set(re.findall(r"`([A-Za-z][A-Za-z0-9_]*)\(", note))
    # ⛔ MINUS THE DECLARED RECURRENCE, AND THAT SUBTRACTION IS THE NOTE'S OWN
    # FIRST SENTENCE — *"carry bar-to-bar state WITHOUT `accum`'s per-bar body"*.
    # The note spells `accum(-1, …)` while explaining the sentinel, so a bare
    # intersection captured it and the roster read six. Derived, not stripped by
    # name: a second recurrence entry drops out on the day it lands.
    named = sorted((spelled & set(ast_table.TABLE["functions"]))
                   - set(ast_table.recurrences()))
    assert len(named) >= 5, (named, "the note stopped naming its own entries")
    return named


def test_the_bounded_state_roster_is_DERIVED_and_the_derivation_can_FAIL():
    """⭐ THE CONTROL FOR THE DERIVATION. A reader that returned everything, or
    nothing, would make every case below pass for the wrong reason."""
    named = bounded_state_names()
    assert set(named) == {"barssince", "valuewhen", "highestbars", "lowestbars",
                          "obvN"}, named
    # …and it really reads the NOTE: a note naming a function the table does not
    # declare contributes nothing, and one naming none fails the floor.
    note = ast_table.TABLE["_functions_bounded_state"]
    assert "`zzNotADeclaredEntry(" not in note
    spelled = set(re.findall(r"`([A-Za-z][A-Za-z0-9_]*)\(", note + "`zzNope("))
    assert "zzNope" in spelled
    assert "zzNope" not in set(spelled & set(ast_table.TABLE["functions"]))


def test_the_bounded_entries_declare_a_WINDOW_and_never_a_session():
    """⛔ THE HALF THAT MAKES THEM BOUNDED AT ALL. Each declares its own `int`
    slot as its lookback, so `maxLookback` stays a tree sum and the budget can use
    it. A `session` here would spend the WHOLE lookback budget (X22) and make
    every one of them unwrappable."""
    for name in bounded_state_names():
        spec = ast_table.TABLE["functions"][name]
        decl = spec["lookback"]
        assert isinstance(decl, str) and decl.startswith("arg"), (name, decl)
        slot = int(decl[3:])
        assert slot < len(spec["args"]), (name, decl, spec["args"])
        assert spec["args"][slot] == "int", (name, decl, spec["args"])
        assert spec["argRoles"][slot].lower().endswith("period"), (name, spec["argRoles"])


def test_the_declared_lookback_is_an_UPPER_BOUND_on_the_warm_up_each_one_takes():
    """⛔ THE ONE DIRECTION `_functions_warmup` SAYS A DECLARATION MAY NEVER TAKE.
    Over-stating a window costs extra NaN; UNDER-stating hands back numbers
    computed from bars that were never fetched. Measured per entry against its own
    column rather than argued: the first bar each one answers on must be no later
    than the lookback it declares.

    ⚠️ `barssince` IS MEASURED ON THE FLAT SERIES DELIBERATELY. On `BARS` it
    answers at bar 0 (an up bar), which would make this pass for a reason that has
    nothing to do with the window; the flat series is the case where the whole
    declared window has to be read before anything can be said.

    ⚰️ AND THE CEILING IS DERIVED, NOT TYPED, BECAUSE MY FIRST ONE WAS WRONG. This
    asserted `first <= declared - 1` — "a series of exactly `lookback` bars
    produces at least one value" — and `obvN(7)` first answers on bar **7**, so it
    was red. That is not a defect: `_functions_warmup` already records a SHIPPED
    class of entries needing `period + 1` bars for their bar-`period` value
    (`rsi`, `mfi`, `atr`), and `obvN` is in it by construction — bar `i`'s window
    reaches `i - n`, because a signed volume needs the bar BEFORE it to have a
    sign. So the ceiling is read off `rsi`, an entry the manifest already places in
    that class, rather than written as a `+ 1` somebody could quietly widen.
    """
    n = 7
    # ⭐ THE CEILING, MEASURED OFF A SHIPPED MEMBER OF THE SAME DECLARED CLASS.
    rsi = CALL("rsi", SER("close"), NUM(n))
    rsi_col = ast_interpret.interpret(rsi, BARS, {})
    ceiling = next(i for i in range(len(rsi_col)) if at(rsi_col, i) is not None)
    assert ast_interpret.max_lookback(rsi) == n
    assert ceiling == n, ceiling      # the `period + 1` class, in one number

    probes = {
        "barssince": (CALL("barssince", IS_UP, NUM(n)), FLAT),
        "valuewhen": (CALL("valuewhen", IS_UP, SER("close"), NUM(n)), BARS),
        "highestbars": (CALL("highestbars", SER("high"), NUM(n)), BARS),
        "lowestbars": (CALL("lowestbars", SER("low"), NUM(n)), BARS),
        "obvN": (CALL("obvN", NUM(n)), BARS),
    }
    # ⛔ THE PROBES MUST COVER THE DERIVED ROSTER, not a private list: a sixth
    # bounded-state entry lands here as a named gap rather than as silence.
    assert sorted(probes) == bounded_state_names(), sorted(probes)
    for name, (ast, bars) in probes.items():
        declared = ast_interpret.max_lookback(ast)
        assert declared == n, (name, declared)
        col = ast_interpret.interpret(ast, bars, {})
        first = next((i for i in range(len(col)) if at(col, i) is not None), None)
        assert first is not None, name
        assert first <= ceiling, (name, first, declared, ceiling)
    # ⛔ AND FOUR OF THE FIVE ARE TIGHTER THAN THE CEILING — `obvN` is the only one
    # in the `period + 1` class, so a rail that let ALL of them slip a bar would be
    # excusing four entries for one entry's reason.
    loose = [name for name, (ast, bars) in probes.items()
             if next(i for i, v in enumerate(ast_interpret.interpret(ast, bars, {}))
                     if at(ast_interpret.interpret(ast, bars, {}), i) is not None) == ceiling]
    assert loose == ["obvN"], loose
    # …and the manifest SAYS SO, so the shortfall is declared rather than inherited
    # silently. `_functions_warmup` is a hand-written list; `obvN` is on it.
    warmup = ast_table.TABLE["_functions_warmup"]
    assert "obvN" in warmup, warmup[-400:]


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. X22 — WHAT HAPPENS WHEN ONE OF THESE WRAPS A SESSION-ANCHORED CALL
# ═══════════════════════════════════════════════════════════════════════════ #

def _over_budget(ast):
    """⛔ `budget_result` FOR THE VERDICT, `check_budget` FOR THE SAFETY — AND
    BOTH, BECAUSE THEY ARE TWO DOORS.

    ⚰️ THIS HELPER READ `ast_budget.check_budget(ast, None)["ok"]`. That function
    RAISES `BudgetExceeded` and returns `None`; the subscript would have been a
    `TypeError` on the refusing path and a `TypeError` on the passing one, so the
    whole section measured nothing in either direction.
    """
    res = ast_budget.budget_result(ast, None)
    assert res["ok"] is False, res
    with pytest.raises(ast_budget.BudgetExceeded) as exc:
        ast_budget.check_budget(ast, None)
    assert exc.value.guard == res["guard"], (exc.value.guard, res["guard"])
    return res


def test_wrapping_vwap_in_a_bounded_state_call_refuses_and_says_WHICH_budget_and_WHY():
    """🔴 THE MEMBER SHAPE, NOT THE ENGINEER SHAPE. `barssince(close > vwap(), 10)`
    is a formula somebody types on day one: "how long since price took back
    VWAP". It measures one session PLUS ten bars against a cap of one session, so
    it refuses — and the refusal has to say the fix is not a smaller window.

    ⛔ NOTHING HERE IS AN EXEMPTION. These five spend an ordinary window; it is
    the `vwap()` INSIDE them that saturates the budget, and the clause names it
    because `session_anchored_in` reads the manifest.
    """
    for src in (CALL("barssince", OP(">", SER("close"), CALL("vwap")), NUM(10)),
                CALL("valuewhen", OP(">", SER("close"), CALL("vwap")), SER("close"), NUM(5)),
                CALL("highestbars", CALL("vwap"), NUM(2)),
                CALL("lowestbars", CALL("vwap"), NUM(2)),
                # ⭐ AND THE TWO SHAPES W2a.4's OWN RAIL HAD OMITTED, wrapped
                # round one of these instead of round `vwap()` directly.
                OP("&&", CALL("crossOver", SER("close"),
                              CALL("valuewhen", OP(">", SER("close"), CALL("vwap")),
                                   SER("close"), NUM(3))),
                   NUM(1)),
                CALL("highest", CALL("highestbars", CALL("vwap"), NUM(2)), NUM(2))):
        res = _over_budget(src)
        assert res["guard"] == "budget:lookback", res
        assert "lookback budget" in res["error"]
        assert "vwap()" in res["error"]
        assert "one whole trading session" in res["error"]
        assert "nothing can be wrapped around it" in res["error"]


def test_a_bounded_state_call_over_a_PLAIN_series_says_nothing_about_sessions():
    """⛔ THE CONTROL, AND IT CARRIES A CALL. A refusal that named a session on
    every over-budget formula would be decoration rather than a reason. These are
    over the cap for the ordinary reason — the window is too long — and there the
    fix IS a smaller window."""
    cap = ast_budget.DEFAULT_BUDGET["maxLookback"]
    for src in (CALL("barssince", IS_UP, NUM(cap + 1)),
                CALL("obvN", NUM(cap + 1)),
                CALL("highestbars", SER("high"), NUM(cap + 1))):
        res = _over_budget(src)
        assert res["guard"] == "budget:lookback", res
        assert "trading session" not in res["error"], res["error"]


def test_the_five_entries_FIT_the_budget_at_the_windows_a_member_types():
    for src in (CALL("barssince", IS_UP, NUM(10)),
                CALL("valuewhen", IS_UP, SER("close"), NUM(20)),
                CALL("highestbars", SER("high"), NUM(20)),
                CALL("lowestbars", SER("low"), NUM(20)),
                CALL("sma", CALL("obvN", NUM(20)), NUM(20)),
                CALL("crossOver", SER("close"), CALL("obvN", NUM(20))),
                CALL("highest", CALL("barssince", IS_UP, NUM(10)), NUM(2))):
        assert ast_budget.budget_result(src, None)["ok"] is True, src
        assert ast_budget.check_budget(src, None) is None


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. ⚠️ THE `obv` EXCLUSION REASON MUST BE TRUE OF WHAT `obvN` DOES
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_obv_refusal_points_at_obvN_and_the_pointer_resolves():
    """⚠️ A REASON NAMING A MECHANISM IS A CLAIM ABOUT A RUN
    (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`). The `obv`
    entry now ends by naming `obvN`; this asserts the name it hands the reader is
    one the table actually declares, so the pointer cannot rot into a reference to
    something renamed or never landed."""
    reason = ast_table.TABLE["_functions_excluded"]["obv"]
    assert "obvN(n)" in reason, reason
    assert "obvN" in ast_table.TABLE["functions"]
    # ⛔ AND THE REFUSAL IS STILL A REFUSAL. Declaring the bounded form must not
    # quietly make the unbounded name callable.
    assert "obv" not in ast_table.TABLE["functions"]
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        run(CALL("obv"))
    # ⚰️ THIS READ `"resolve:function" in str(exc.value)` AND COULD NEVER PASS:
    # `TableRefusal.__str__` is the MESSAGE and the guard is an ATTRIBUTE, so the
    # assertion was about a string that never contains it. A refusal test that
    # can only fail is the mirror of one that can only pass.
    assert exc.value.guard == "resolve:function", exc.value.guard
    assert "unknown function 'obv'" in str(exc.value), str(exc.value)


def test_NOTHING_ELSE_IN_THE_REPO_still_says_OBV_is_excluded_for_the_OLD_reason():
    """⛔ TWO AGREEING COPIES READ AS CORROBORATION. The exclusion reason was
    edited in ONE file; a second copy of the old sentence somewhere else would go
    on telling the next reader that no bounded form exists.

    ⭐ THE SUBJECT IS DERIVED FROM THE MANIFEST, not typed: the search is for the
    entry's own name beside the words the OLD reason turned on, over the source
    trees that could hold a second copy.
    """
    import re

    excluded = ast_table.TABLE["_functions_excluded"]
    assert "obv" in excluded                     # the subject exists
    needle = re.compile(r"obv", re.IGNORECASE)
    claim = re.compile(r"no finite lookback|cumulative from the first bar", re.IGNORECASE)
    roots = [ROOT / "api" / "services", ROOT / "app" / "src" / "components" / "chart",
             ROOT / "tools", ROOT / "tests"]
    scanned = 0
    offenders = []
    for root in roots:
        for path in root.rglob("*"):
            if path.suffix not in (".py", ".js", ".json") or "node_modules" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            scanned += 1
            for line in text.splitlines():
                if claim.search(line) and needle.search(line):
                    if "obvN" in line:
                        continue          # the CORRECTED sentence names the successor
                    offenders.append(f"{path.relative_to(ROOT)}: {line.strip()[:120]}")
    # ⭐ NON-VACUITY: the sweep really read the tree it claims to have read, and
    # it really can see the sentence it is looking for.
    assert scanned > 400, scanned
    assert claim.search(excluded["obv"]), excluded["obv"]
    assert not offenders, offenders


# ═══════════════════════════════════════════════════════════════════════════ #
# 6. 🔴 X23 — WHAT A MEMBER'S SCAN OVER `valuewhen` DOES TODAY
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_scan_lane_LAUNDERS_a_valuewhen_hole_into_a_confident_answer():
    r"""🔴🔴 THE NaN PREFIX MEETS X23, MEASURED — AND THIS LANE DOES NOT OWN THE FIX.

    `valuewhen` is blank until its condition first fires, and blank again once the
    last hit falls out of the window. That is the honest answer, and on the CHART
    it draws as a gap. On the SCAN lane it does not survive:

      * `scan_definition.assert_scannable` refuses a tree that yields a NUMBER, so
        a bare `valuewhen(...)` is never a scannable spelling — every legal one
        puts it under a COMPARISON;
      * a comparison against a hole is `0`, not a hole (`_cmp`, the `_booleans`
        rule, older than this entry): *"A COMPARISON AGAINST NaN IS 0, NOT NaN"*.

    `scan_evaluator` reaches `not_computable` only on a NON-FINITE value, so the
    hole never gets there. A screen over `valuewhen` therefore answers at FULL
    reported coverage with either NOTHING or THE ENTIRE UNIVERSE, and a member
    cannot tell either from a real result.

    ⛔ NOT THIS TASK'S BUG. The laundering predates these five names and is tracked
    as **X23**, owned by W9a. What this pins is the CONSEQUENCE at the entry that
    makes it reachable, so the manifest's claim cannot rot — and so X23 has a
    NAMED consumer rather than an abstract one.
    """
    flat = FLAT[:5]
    hole = ast_interpret.interpret(
        CALL("valuewhen", IS_UP, SER("close"), NUM(3)), flat, {})
    assert all(v is None for v in hole), hole            # the column IS a hole

    gt = OP(">", CALL("valuewhen", IS_UP, SER("close"), NUM(3)), NUM(0))
    empty = ast_interpret.interpret(gt, flat, {})
    assert empty == [0.0] * 5, empty                     # a screen that finds NOTHING

    negated = ast_interpret.interpret(OP("!", gt), flat, {})
    assert negated == [1.0] * 5, negated                 # …and one that finds EVERYTHING

    # ⛔ AND THE SCAN'S OWN TEST FOR "not computable" NEVER FIRES on these.
    for column in (empty, negated):
        assert all(isinstance(v, float) and math.isfinite(v) for v in column)

    # NON-VACUITY: on a series where the condition DOES fire, the same trees
    # answer with real variety — so the columns above are the hole's doing and
    # not a broken fixture.
    live = ast_interpret.interpret(gt, BARS[:5], {})
    assert set(live) == {1.0}, live
    assert ast_interpret.interpret(
        CALL("valuewhen", IS_UP, SER("close"), NUM(3)), BARS[:5], {})[0] is not None


def test_the_manifest_DECLARES_the_NaN_prefix_and_names_what_a_scan_does_with_it():
    """⛔ DECLARED, NOT LEFT TO A READER TO INFER FROM AN IMPLEMENTATION. The
    entry's own note has to say that the prefix exists AND what the scan lane
    turns it into, because "not computable" and "answered 0" are the two things a
    member cannot tell apart."""
    note = ast_table.TABLE["_functions_bounded_state"]
    assert isinstance(note, str) and len(note) > 400
    low = note.lower()
    for phrase in ("valuewhen", "x23", "entire universe"):
        assert phrase in low, (phrase, note[:200])
