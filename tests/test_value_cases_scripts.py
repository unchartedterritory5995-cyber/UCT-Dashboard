"""THE VALUE CASES, SCRIPT LANE: what a script the assistant wrote computes and DRAWS, held to what was asked.

The formula lane of the value cases (`tests/test_value_cases.py`) holds a patch of formulas to a plain calculation.
A request a formula cannot hold (a table, labels on bars, a line between two points, boxes, a count that carries
state) is answered with a SCRIPT, and until this file nothing in the repository checked what such a script shows.

A script case is the member's words and the script the door wrote on production, in
`tests/fixtures/authoring/value_cases.json` (lane "script"). Here each recorded script is:
  * run through the member pane's OWN path, in node (`tools/value_cases/script_lane.mjs`: `memberPaneDefinition`,
    `nativeRegistry.computeFor`, the engine's render state), on the engine's built bars;
  * held to `tools/value_cases/script_rules.py`: every plotted column against a plain calculation of the words, and
    every drawn thing (a table's numbers and words, labels on the right bars, a line at the right level, boxes
    around the right bars) against the same kind of calculation;
  * read for what it draws that the request did not name.

THE CHECK CAN FAIL: a neighbouring request's script, a script that does not build, a formula where a script
belongs, and a window raised by one each turn a right case wrong. A rule's numbers are fingerprinted in the case
(the rule never learns from the door). No model is called and nothing reaches the network.

This file needs node and `app/node_modules`. Where they are missing it SKIPS, and the lanes that run it treat a
skip as a failure.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from tools.converse_eval import LaneUnavailable
from tools.value_cases import script_grade, script_rules

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
SCRIPT = [c for c in DATA["cases"] if c["lane"] == "script"]
FLOOR = 17
FIRST_REASON = "written from the request's words before the answer was read"


def _lane(fn, *args):
    try:
        return fn(*args)
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


@pytest.fixture(scope="module")
def graded():
    return _lane(script_grade.grade_all, SCRIPT)


@pytest.fixture(scope="module")
def digests():
    return _lane(script_grade.rule_digests, SCRIPT)


def test_the_fixture_holds_the_script_cases():
    assert len(SCRIPT) >= FLOOR
    for case in SCRIPT:
        assert case["chart"] in ("daily", "intraday"), case["id"]
        assert script_grade.source_of(case["answer"]) and "indicator(" in case["answer"]["script"]["pine"], case["id"]
        assert script_rules.has_rule(case["id"]), case["id"]


@pytest.mark.parametrize("case", SCRIPT, ids=[c["id"] for c in SCRIPT])
def test_the_recorded_script_computes_and_draws_what_was_asked(case, graded):
    result = graded[case["id"]]
    assert result["verdict"] == "right", (case["words"], result["lines"])
    assert result["lane"] == "script"
    # something was held (a reading that is not the one built says CHECK beside the one that is: the verdict decides)
    assert any(line.lstrip().startswith("RIGHT") for line in result["lines"]), result["lines"]


@pytest.mark.parametrize("case", SCRIPT, ids=[c["id"] for c in SCRIPT])
def test_the_recorded_script_draws_nothing_that_was_not_asked_for(case, graded):
    assert graded[case["id"]]["not_asked_for"] == {}, case["words"]


# ── the rule never learns from the door ──

@pytest.mark.parametrize("case", SCRIPT, ids=[c["id"] for c in SCRIPT])
def test_a_script_rule_says_today_what_its_case_recorded(case, digests):
    assert digests[case["id"]] == case["rule"]["digest"], (
        f"the rule of {case['id']} no longer says what the case recorded. If the rule was WRONG about the request's words, add an entry to "
        "rule.history with the new digest, the reason, and the words quoted from the request. A rule is never changed to agree with the door.")
    history = case["rule"]["history"]
    assert history and history[0]["reason"] == FIRST_REASON and history[-1]["digest"] == case["rule"]["digest"]
    for entry in history[1:]:
        assert len(entry["reason"]) > 40 and entry["quote"].lower() in case["words"].lower(), case["id"]


# ── the check can fail ──

def test_CONTROL_a_neighbouring_requests_script_is_wrong():
    answers = {case["id"]: SCRIPT[(k + 5) % len(SCRIPT)]["answer"] for k, case in enumerate(SCRIPT)}
    got = _lane(script_grade.grade_all, SCRIPT, answers)
    wrong = [cid for cid, r in got.items() if r["verdict"] == "wrong"]
    assert len(wrong) >= len(SCRIPT) - 1, sorted(set(got) - set(wrong))


def test_CONTROL_a_script_that_does_not_build_and_a_formula_where_a_script_belongs():
    formula = next(c for c in DATA["cases"] if c["lane"] == "formula")
    answers = {SCRIPT[0]["id"]: {"turn": "script", "script": {"pine": "//@version=5\nindicator(\"x\")\nplot(clse +)\n"}},
               SCRIPT[1]["id"]: formula["answer"],
               SCRIPT[2]["id"]: {"disposition": "unsupported", "reply": "I can't build that."}}
    got = _lane(script_grade.grade_all, SCRIPT[:3], answers)
    assert got[SCRIPT[0]["id"]]["verdict"] == "did not run"
    assert got[SCRIPT[1]["id"]]["verdict"] == "wrong" and "formula lane" in got[SCRIPT[1]["id"]]["lines"][0]
    assert got[SCRIPT[2]["id"]]["verdict"] == "wrong" and "wall lane" in got[SCRIPT[2]["id"]]["lines"][0]


def _every_window_one_longer(source):
    """The same script with EVERY whole number from 5 to 300 in its code raised by one (20 written as 21, 50 as 51).
    The first number of a drawing script is often a style or a count of things kept, so one slip proves little."""
    lines, hits = [], 0
    for line in source.splitlines():
        code, sep, comment = line.partition("//")
        if not code.lstrip().startswith(("indicator(", "strategy(")):
            code, n = re.subn(r"(?<![\w.\"#])(?:[5-9]|[1-9]\d|[12]\d\d|300)(?![\w.\"%])", lambda m: str(int(m.group(0)) + 1), code)
            hits += n
        lines.append(code + sep + comment)
    return "\n".join(lines), hits > 0


def test_a_script_with_every_window_one_longer_is_caught():
    answers, tried = {}, []
    for case in SCRIPT:
        source, hit = _every_window_one_longer(case["answer"]["script"]["pine"])
        if hit:
            answers[case["id"]] = {"turn": "script", "script": {"pine": source}}
            tried.append(case)
    got = _lane(script_grade.grade_all, tried, answers)
    caught = [c["id"] for c in tried if got[c["id"]]["verdict"] != "right"]
    # MEASURED 2026-11-21: 11 of 17. The six that stay right are drawings held on the newest bar only, where one bar
    # more changes nothing: the highest high of 253 bars is the highest of 252, "above its 51 day average" reads
    # the same as 50 today. A column case (a value on every bar) is caught every time; the floor is the measure.
    assert len(tried) >= 14 and len(caught) / len(tried) >= 0.6, (sorted(caught), [c["id"] for c in tried])
    with_columns = [c["id"] for c in tried if c["id"] in script_rules.RULES]
    assert with_columns and set(with_columns) <= set(caught), sorted(set(with_columns) - set(caught))


# ── the rules stand apart from the product ──

def test_the_script_rules_import_nothing_of_the_product():
    tree = ast.parse((ROOT / "tools" / "value_cases" / "script_rules.py").read_text(encoding="utf-8"))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(("." * node.level) + (node.module or ""))
    assert set(names) == {"datetime", "re"}, names


def test_the_lane_reads_its_two_build_flags_from_the_gates_own_source():
    from tools.value_cases import script_lane
    flags = {script_lane._flag("objectsOnlyPaneGate.js"), script_lane._flag("runtimePaneGate.js")}
    assert len(flags) == 2 and all(f.startswith("VITE_PINE_") for f in flags)
    assert all(f in script_lane._build_script() for f in flags)
