"""ALERT TF_MERGE (coordinator ruling 2026-11-19, option A) -- the SERVER half.

Since #1996 the chart draws ``request.security(sym, "W", close)[1]`` on the newest bar (the bar before's merge
is settled); the alert lane refused every plot holding a ``tf_merge`` anywhere. It now admits a plot when EVERY
merge it reads is reached only through a literal history offset k >= 1 that no setting moves, with no other
request, no forward-reaching call and no moved offset on the way or inside the merge
(``alert_user_series.merge_newest_unproven``, twin ``evaluability.js::mergeNewestUnproven``). Everything else keeps
``withheld`` / ``request:htf-newest-unconfirmed`` and its sentence.

The shared fixture ``tests/fixtures/ast/alert_tf_merge_history.json`` is WRITTEN by
``app/src/components/chart/engine/alertTfMergeHistory.test.js`` and read here:
  * the PARITY rail: the server's answer (``_gate_lane`` + ``plot_admissions``) for every case equals the
    fixture's, which the browser preflight is held to by the JS file; one lane narrowed and not the other is red
    on that lane;
  * the VALUE rail: for every admitted shape, the alert lane's column (``fn.column``, on the store's YYYYMMDD
    bars) equals the chart's served column bar for bar, newest bar included and finite there.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret

ROOT = pathlib.Path(__file__).resolve().parent
FIX = json.loads((ROOT / "fixtures" / "ast" / "alert_tf_merge_history.json").read_text("utf-8"))
CASES = FIX["cases"]
ADMITTED = [c for c in CASES if c.get("served")]


def store_bars(days):
    """The fixture's bars as the store keys them (``bars_sqlite``: daily ``t`` is a YYYYMMDD int)."""
    return [{"t": int(d.replace("-", "")), "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i}
            for i, d in enumerate(days)]


def server_answer(definition: dict, plot_key: str) -> dict:
    """``test_p1_truth_core.server_alert_answer``'s reading: ``_gate_lane``, then ``plot_admissions``."""
    def_id = definition["id"]
    try:
        aus._gate_lane({"def_id": def_id, "definition": definition})
        _ok, withheld = aus.plot_admissions(def_id, definition)
    except aus.AdmissionRefused as exc:
        return {"status": "refused", "gate": exc.gate, "message": str(exc)}
    refused = withheld.get(f"{def_id}.{plot_key}")
    if refused is not None:
        return {"status": "refused", "gate": refused.gate, "message": str(refused)}
    return {"status": "supported", "gate": None, "message": ""}


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_parity_the_server_answers_every_case_as_the_fixture(case):
    got = server_answer(case["definition"], case["plotKey"])
    want = case["expect"]
    assert got["status"] == want["status"], got
    assert got["gate"] == want["gate"], got
    for code in want["codes"]:
        assert code in got["message"], (code, got["message"])
    if got["status"] == "refused":
        # the member's sentence is the one every tf_merge refusal has carried (`_unsupplied_reason`)
        assert "it reads a weekly or monthly value the way TradingView's" in got["message"]
    assert (got["status"] == "refused") == aus.merge_newest_unproven(
        case["definition"]["compute"]["ast"], case["definition"]["compute"])


def test_the_fixture_is_not_vacuous():
    statuses = [c["expect"]["status"] for c in CASES]
    assert statuses.count("supported") >= 6 and statuses.count("refused") >= 6
    assert len(ADMITTED) >= 6
    assert {c["expect"]["gate"] for c in CASES if c["expect"]["status"] == "refused"} == {"withheld"}


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(float(a), float(b), rel_tol=1e-12, abs_tol=1e-12)


@pytest.mark.parametrize("case", ADMITTED, ids=lambda c: c["name"])
@pytest.mark.parametrize("bar_set", ["tuesday", "friday"])
def test_value_the_alert_column_equals_the_chart_bar_for_bar_newest_included(case, bar_set):
    definition = case["definition"]
    admissible, withheld = aus.plot_admissions(definition["id"], definition)
    assert not withheld
    fn = dict(admissible)[f"{definition['id']}.{case['plotKey']}"]
    days = FIX["days"][bar_set]
    bars = store_bars(days)
    alert = fn.column(bars, {}, "D")
    chart = case["served"][bar_set]
    assert len(alert) == len(chart) == len(days)
    diffs = [(i, a, c) for i, (a, c) in enumerate(zip(alert, chart)) if not _same(a, c)]
    assert diffs == [], diffs[:5]
    # ⛔ non-vacuous: the newest bar -- the one the merge's own newest bar is unknown on -- is a number in both,
    # and the forming lane's reader (`_last_finite`) reads that bar, not an older one
    assert alert[-1] is not None and chart[-1] is not None
    assert fn(bars, {}, "D") == alert[-1]


def test_control_the_tuesday_set_is_the_hard_case_the_alert_lane_withholds_a_direct_read_there():
    """The same bars, the tree ``x`` evaluated as the alert lane would: its newest bar is withheld (``tf_merge_mask``),
    so admitting ``x`` would arm an alert that reads the bar before forever."""
    x = next(c for c in CASES if c["name"].startswith("x (a direct read)"))
    bars = store_bars(FIX["days"]["tuesday"])
    col = ast_interpret.interpret(x["definition"]["compute"]["ast"], bars, {},
                                  opts=ast_interpret.lane_opts_for(x["definition"]))
    assert col[-1] is None and col[-2] is not None


def test_the_rule_reads_the_parameter_manifest_and_no_bars():
    c = next(x for x in CASES if x["name"].startswith("x[len]"))
    tree = c["definition"]["compute"]["ast"]
    assert aus.merge_newest_unproven(tree, c["definition"]["compute"]) is True
    assert aus.merge_newest_unproven(tree, {"kind": "ast"}) is False
    shared = {"type": "tf_merge", "value": "W", "args": [{"type": "series", "name": "close"}]}
    off = lambda k, a: {"type": "offset", "value": k, "args": [a]}  # noqa: E731
    assert aus.merge_newest_unproven({"type": "op", "name": "+", "args": [off(1, shared), shared]}) is True
    assert aus.merge_newest_unproven({"type": "op", "name": "+", "args": [off(1, shared), off(2, shared)]}) is False
