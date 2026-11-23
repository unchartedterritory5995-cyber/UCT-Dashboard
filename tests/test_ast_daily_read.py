"""⭐⭐ U-DAILY (e96, part A) -- A DAILY READ ON A CHART BELOW A DAY, THE SERVER'S LANE.

``tf(x, 'D')`` on a stated chart below a day: ``x`` computed on the symbol's DAILY bars (``opts["frames"]["D"]``) and shown
on each chart bar as THE LAST FINISHED DAY. The twin of ``app/.../ast/dailyRead.test.js`` (the same bars, the same
numbers, worked out by hand: the daily close of row j is 100 + j), plus the one thing only this lane holds:

  * ITS PLACEMENT IS THE JS LANE'S. ``ast_interpret.daily_read_placement`` is asserted equal to fixtures WRITTEN by the
    chart's own projection (``tools/value_cases/daily_read_placement_fixture.mjs`` runs ``mtfProjection.
    projectFrameColumns``), and the fixture is proved current by running that script. Nobody types a placement twice.

And the doors that never evaluate: the lookback, the linter, the scan door, the alert lane, the conversation door.
"""
from __future__ import annotations

import calendar
import json
import math
import os
import subprocess
from pathlib import Path

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai
from api.services import ast_lint, definition_conversation as dc, scan_definition, user_definitions

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "ast" / "daily_read_placement.json"
GENERATOR = ROOT / "tools" / "value_cases" / "daily_read_placement_fixture.mjs"


def N(v):
    return {"type": "num", "value": v}


def S(name):
    return {"type": "series", "name": name}


def C(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def O(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def TF(value, child):
    return {"type": "tf", "value": value, "args": [child]}


def SYM(value, child):
    return {"type": "sym", "value": value, "args": [child]}


def OFF(value, child):
    return {"type": "offset", "value": value, "args": [child]}


# THREE SESSIONS of four 5 minute bars (09:30..09:45 New York, EST = UTC-5): Monday 12 to Wednesday 14 January 2026
DAYS = ["2026-01-12", "2026-01-13", "2026-01-14"]
CHART = []
for _d in DAYS:
    _y, _m, _dd = (int(x) for x in _d.split("-"))
    for _k in range(4):
        _t = calendar.timegm((_y, _m, _dd, 14, 30, 0)) + _k * 300
        _c = 200.0 + len(CHART)
        CHART.append({"t": _t, "o": _c, "h": _c + 1, "l": _c - 1, "c": _c, "v": 1000.0})
FRAME_DAYS = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
              "2026-01-12", "2026-01-13", "2026-01-14"]


def daily_of(days, base):
    return [{"t": t, "o": base + j, "h": base + j + 2, "l": base + j - 2, "c": float(base + j), "v": 5000.0}
            for j, t in enumerate(days)]


FRAME = daily_of(FRAME_DAYS, 100)
SPY = daily_of(FRAME_DAYS, 500)


def five(frame=FRAME, symbols=None, newest_final=True, **extra):
    return dict({"tf": "5", "frames": {"D": {"bars": frame, "symbols": symbols or {}, "newestFinal": newest_final}}}, **extra)


def run(tree, opts=None):
    return ai.interpret(tree, CHART, {}, None, None, opts or {})


def each(a, b, c):
    return [a] * 4 + [b] * 4 + [c] * 4


def guard_of(fn):
    try:
        fn()
    except ai.TableRefusal as exc:
        return exc.guard
    return None


# ── the placement: the JS lane's, by a fixture it writes ──

def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_THE_FIXTURE_IS_WHAT_THE_JS_PROJECTION_WRITES_TODAY():
    """The committed placements are the chart's own projection's: the generator is run and its output compared. A
    hard failure, never a skip: a fixture nobody can regenerate is a hand-written expectation."""
    node = os.environ.get("NODE_BIN", "node")                              # ``tools/ast_conformance.py::_node``'s rule
    proc = subprocess.run([node, str(GENERATOR), "--print"], cwd=str(ROOT), capture_output=True,
                          text=True, encoding="utf-8", errors="replace")
    assert proc.returncode == 0, (proc.stderr or "")[-1500:]
    assert json.loads(proc.stdout) == _fixture(), (
        "tests/fixtures/ast/daily_read_placement.json is not what the JS projection writes: run "
        "`node tools/value_cases/daily_read_placement_fixture.mjs --write`")


def test_the_fixture_is_not_vacuous():
    cases = _fixture()["cases"]
    assert len(cases) >= 9
    every = [a for c in cases for a in c["at"]]
    assert sum(1 for a in every if a >= 0) > 300 and sum(1 for a in every if a < 0) > 20
    assert any(c["stale"] for c in cases) and any(not c["stale"] for c in cases)
    assert {c["chartTf"] for c in cases} >= {"5", "15", "30", "60"}
    assert any(c["newestFinal"] is False for c in cases)


@pytest.mark.parametrize("case", _fixture()["cases"], ids=[c["name"] for c in _fixture()["cases"]])
def test_THE_PYTHON_PLACEMENT_IS_THE_JS_ONE(case):
    at, stale = ai.daily_read_placement([{"t": t} for t in case["frameTimes"]], [{"t": t} for t in case["chartTimes"]],
                                        case["chartTf"], case["newestFinal"])
    assert at == case["at"], case["why"]
    assert stale == case["stale"], case["why"]


# ── the evaluator ──

def test_each_bar_of_a_day_shows_the_day_before_it():
    # Monday 12th shows Friday 9th (row 5: (103 + 104 + 105) / 3 = 104), Tuesday Monday (105), Wednesday Tuesday (106)
    assert run(TF("D", C("sma", S("close"), N(3))), five()) == each(104.0, 105.0, 106.0)


def test_the_rest_of_the_formula_stays_on_the_charts_own_bars():
    got = run(O("-", S("close"), TF("D", S("close"))), five())
    assert got == [b["c"] - (105 if i < 4 else 106 if i < 8 else 107) for i, b in enumerate(CHART)]


def test_another_symbol_inside_the_read_is_read_on_its_own_daily_bars():
    assert run(TF("D", SYM("SPY", S("close"))), five(symbols={"SPY": SPY})) == each(505.0, 506.0, 507.0)
    assert ai.daily_read_symbols(TF("D", SYM("spy", S("close")))) == ["SPY"]


def test_CONTROL_the_newest_daily_bar_not_proven_final_changes_nothing_here():
    assert run(TF("D", S("close")), five(newest_final=False)) == each(105.0, 106.0, 107.0)


def test_a_day_the_daily_bars_do_not_hold_is_withheld_and_so_is_what_reads_it_through_nz():
    clock = {}
    got = run(C("nz", TF("D", S("close")), N(0)), five(frame=FRAME[6:], chartClockSink=clock))
    assert got[:4] == [None] * 4                                    # not 0: nz never saw them
    assert got[4:] == [106.0] * 4 + [107.0] * 4
    assert ai.DAILY_READ_DAY_NOT_HELD in clock


def test_and_every_root_bar_within_the_trees_reach_of_it():
    got = run(OFF(1, C("nz", TF("D", S("close")), N(0))), five(frame=FRAME[6:]))
    assert got[:5] == [None] * 5                                    # bar 4 reads bar 3: withheld, never nz's 0
    assert got[5:] == [106.0] * 4 + [107.0] * 3


def test_no_daily_bars_handed_withholds_every_bar_by_name():
    clock = {}
    assert run(TF("D", S("close")), {"tf": "5", "chartClockSink": clock}) == [None] * len(CHART)
    assert ai.DAILY_READ_NO_DAILY_BARS in clock
    # an unstated chart (the server's daily consumers): the tree runs and is withheld whole
    assert run(O(">", S("close"), TF("D", C("sma", S("close"), N(3)))), {}) == [None] * len(CHART)


def test_refused_on_a_daily_or_higher_chart():
    for tf in ("D", "W", "M"):
        assert guard_of(lambda tf=tf: run(TF("D", S("close")), {"tf": tf, "frames": five()["frames"]})) == "interpret:timeframe"
    assert "D" not in ai.TF_RESAMPLABLE


def test_refused_inside_another_read_and_with_another_timeframe_inside_it():
    assert guard_of(lambda: run(SYM("SPY", TF("D", S("close"))), five())) == "interpret:timeframe"
    assert guard_of(lambda: run(TF("W", TF("D", S("close"))), five())) == "interpret:timeframe"
    assert guard_of(lambda: run(TF("D", TF("W", S("close"))), five())) == "interpret:timeframe"
    # CONTROL: a `sym` under a weekly read is still refused, by its own guard
    assert guard_of(lambda: run(TF("W", SYM("SPY", S("close"))), {"tf": "D"})) == "interpret:symbol"


# ── the gates that never evaluate ──

def test_the_lookback_counts_the_childs_daily_reach_plus_the_finished_day():
    child = C("sma", S("close"), N(50))
    assert ai.max_lookback(TF("D", child)) == ai.max_lookback(child) + 1


def test_the_same_read_written_twice_is_one_read_one_column_one_series_of_the_budget():
    from api.services import ast_budget

    def a():
        return TF("D", C("sma", S("close"), N(10)))

    def b():
        return TF("D", C("sma", S("close"), N(20)))
    tree = O("&&", O(">", a(), b()), O("&&", O(">", a(), OFF(5, a())), O(">", b(), OFF(5, b()))))
    assert ast_budget.series_refs(tree) == 3                               # close, and the two distinct daily reads
    ast_budget.check_budget(tree, None)                                    # must not raise
    # the same read nine times is ONE column on the chart's bars too: inside the budget's eight series (nine leaves
    # would not be), each bar adding the same value nine times
    nine = TF("D", C("sma", S("close"), N(3)))
    for _k in range(8):
        nine = O("+", nine, TF("D", C("sma", S("close"), N(3))))
    assert run(nine, five()) == each(9 * 104.0, 9 * 105.0, 9 * 106.0)


def test_the_linter_calls_it_non_repainting_and_its_literal_is_the_engines():
    assert ast_lint.lint_repaint(O(">", S("close"), TF("D", C("sma", S("close"), N(50)))))["mode"] == "non-repainting"
    assert ast_lint._DAILY_READ_CODE == ai.DAILY_READ                      # noqa: SLF001


def test_a_scan_is_refused_at_the_door():
    tree = O(">", S("close"), TF("D", C("sma", S("close"), N(50))))
    definition = {"schemaVersion": 1, "id": "u_000000000001", "version": 1,
                  "meta": {"name": "A Screen", "shortName": "SCR", "repaint": "non-repainting"},
                  "compute": {"kind": "ast", "ast": tree, "fn": user_definitions.ast_hash(tree)},
                  "placement": {"target": "price"}, "plots": [{"key": "value", "style": "line", "role": "primary"}],
                  "inputs": []}
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(definition)
    assert exc.value.gate == "cadence" and "last finished day" in str(exc.value)


def test_the_alert_lane_names_the_daily_bars_it_is_not_handed():
    tree = O(">", S("close"), TF("D", S("close")))
    assert aus.UNSUPPLIED_DAILY_READ in aus.unsupplied_reads(tree, {})
    assert aus.UNSUPPLIED_DAILY_READ not in aus.unsupplied_reads(tree, {"frames": {"D": {"bars": FRAME}}})
    assert aus.unsupplied_reads(O(">", S("close"), C("sma", S("close"), N(50))), {}) == []          # CONTROL
    assert "holds no daily bars" in aus._unsupplied_reason(tree, [aus.UNSUPPLIED_DAILY_READ])      # noqa: SLF001


# ── the conversation door ──

FIVE_CHART = {"sym": "NVDA", "tf": "5"}
DAILY_CHART = {"sym": "NVDA", "tf": "D"}


def _change(*trees, calc=None):
    ops = [{"op": "create", "name": "x", "placement": "price",
            "outputs": [{"key": f"o{k}", "tree": t} for k, t in enumerate(trees)]}]
    if calc:
        ops.append({"op": "set_calculation_timeframe", "timeframe": calc})
    return {"disposition": "change", "ops": ops, "reply": "built"}


def _refused(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:                                              # noqa: SLF001
        return exc
    return None


DAILY_CROSS = O(">", S("close"), TF("D", C("sma", S("close"), N(50))))


def test_the_door_builds_a_daily_read_on_a_chart_below_a_day():
    words = "Show when the close is above its 50 day simple moving average"
    assert _refused(dc.check_daily_reads, _change(DAILY_CROSS), words, FIVE_CHART) is None
    assert _refused(dc.check_day_lengths, _change(DAILY_CROSS), words, FIVE_CHART) is None
    # the words may name the chart the request is about (the live rounds were sent from a daily one)
    assert _refused(dc.check_daily_reads, _change(DAILY_CROSS), "On a 5 minute chart, " + words, DAILY_CHART) is None
    # CONTROL: the same days taken as bars of the chart are still sent back, with the daily read as the repair
    stand_in = _change(O(">", S("close"), C("sma", S("close"), N(50))))
    exc = _refused(dc.check_day_lengths, stand_in, words, FIVE_CHART)
    assert exc is not None and "tf(<the measure>, D)" in exc.for_model()


def test_the_door_refuses_a_daily_read_on_a_daily_chart_and_beside_a_calculation_timeframe():
    words = "Show when the close is above its 50 day simple moving average"
    assert _refused(dc.check_daily_reads, _change(DAILY_CROSS), words, DAILY_CHART).gate == "envelope:reference"
    exc = _refused(dc.check_daily_reads, _change(DAILY_CROSS, calc="D"), words, FIVE_CHART)
    assert exc is not None and "set_calculation_timeframe D" in exc.for_model()
    # CONTROL: an answer with no daily read is not this check's
    assert _refused(dc.check_daily_reads, _change(C("sma", S("close"), N(50))), words, DAILY_CHART) is None


def test_the_doors_tree_vocabulary_offers_D_and_the_prompt_teaches_the_finished_day():
    assert "D" in dc._scope_defs()["tf"]["properties"]["value"]["enum"]   # noqa: SLF001
    prompt = " ".join(dc.CONVERSE_SYSTEM_PROMPT.split())
    for piece in ("Build each daily measure as a DAILY READ, tf(<the measure>, D)",
                  "the value of THE LAST FINISHED DAY (yesterday's on every bar of today)",
                  "A DAILY READ IS NEVER TODAY'S VALUE SO FAR",
                  "name every daily read plainly for the day it shows",
                  "ANOTHER SYMBOL GOES INSIDE THE READ"):
        assert piece in prompt, piece


def test_the_python_and_js_leaf_prefixes_cannot_be_spelled_by_a_member():
    assert ai._DAILY_LEAF_PREFIX.startswith("\u0001")                     # noqa: SLF001
    assert not math.isnan(run(TF("D", S("close")), five())[11])
