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
def test_the_recorded_script_is_what_its_case_says_it_is(case, graded):
    """RIGHT, for every case but the ones recorded WRONG: a known defect of the door, named in the case, that stays
    on the record (and counts against the lane) until a live re-run gets it right."""
    result = graded[case["id"]]
    assert result["lane"] == "script"
    if case.get("recorded_verdict") == "wrong":
        assert result["verdict"] == "wrong", (case["id"], "is recorded WRONG and now grades", result["verdict"], result["lines"])
        assert any(line.lstrip().startswith("CHECK") for line in result["lines"]), result["lines"]
        return
    assert result["verdict"] == "right", (case["words"], result["lines"])
    # something was held (a reading that is not the one built says CHECK beside the one that is: the verdict decides)
    assert any(line.lstrip().startswith("RIGHT") for line in result["lines"]), result["lines"]


def test_ORACLE_DRIFT_the_weekly_table_is_held_to_the_words_not_to_the_script(graded):
    """⚰️ 2026-11-22, found in review. j06 asks "whether the close is above the 10 week moving average and above the
    10 month moving average". Its script reads both one DAILY bar back, and the rule had come to read the week and
    the month BEFORE the newest bar's own: it mirrored the script and called it right. On the engine's bars, which
    end on a Friday that is also its month's last weekday, the script shows each average a whole period stale."""
    case = next(c for c in SCRIPT if c["id"] == "j06")
    assert case.get("recorded_verdict") == "wrong" and len(case.get("defect") or "") > 80
    lines = " ".join(graded["j06"]["lines"])
    assert "113.56" in lines and "120.29" in lines                   # what the script shows
    assert "114.0490" in lines and "118.7162" in lines               # the 10 week and the 10 month average, by hand
    # the rule holds BOTH honest readings and they are one number here: the newest bar completes its week and month
    script_rules.bind(_lane(script_grade.script_lane.run, [{"id": "bars", "source": '//@version=5\nindicator("b")\nplot(close)\n', "chart": "daily"}])["charts"]["daily"])
    numbers = dict((what, values) for what, values in script_rules.drawn_rules("j06")["numbers"])
    for values in numbers.values():
        assert len(values) == 2 and values[0] == values[1]


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


#: A window SHORTER than 5 bars, by case. The slip below leaves the numbers under 5 alone (in a drawing script they are
#: mostly widths and counts of things kept), so a case whose window is that short names it here and the slip raises
#: that number too. ⚰️ MEASURED 2026-11-23: cap-04's swing is "the 3 bars before it and the 3 bars after it", its
#: recorded script holds no number from 5 to 300 that is a window, and the slip left it exactly as it was.
SHORT_WINDOWS = {"cap-04": 3}


def _every_window_one_longer(source, short=None):
    """The same script reading ONE BAR FURTHER everywhere: every whole number from 5 to 300 in its code raised by one
    (20 written as 21, 252 as 253), and every look-back one bar deeper (`high[1]` written as `high[2]`).
    The first number of a drawing script is often a style or a count of things kept, so one slip proves little."""
    lines, hits = [], 0
    for line in source.splitlines():
        code, sep, comment = line.partition("//")
        if not code.lstrip().startswith(("indicator(", "strategy(")):
            numbers = (f"{int(short)}|" if short else "") + r"[5-9]|[1-9]\d|[12]\d\d|300"
            code, n = re.subn(r"(?<![\w.\"#\[])(?:" + numbers + r")(?![\w.\"%\]])", lambda m: str(int(m.group(0)) + 1), code)
            code, k = re.subn(r"\[(\d{1,3})\]", lambda m: "[" + str(int(m.group(1)) + 1) + "]", code)
            hits += n + k
        lines.append(code + sep + comment)
    return "\n".join(lines), hits > 0


def test_a_script_with_every_window_one_longer_is_caught():
    answers, tried = {}, []
    for case in SCRIPT:
        source, hit = _every_window_one_longer(case["answer"]["script"]["pine"], SHORT_WINDOWS.get(case["id"]))
        if hit:
            answers[case["id"]] = {"turn": "script", "script": {"pine": source}}
            tried.append(case)
    got = _lane(script_grade.grade_all, tried, answers)
    caught = [c["id"] for c in tried if got[c["id"]]["verdict"] != "right"]
    # EVERY case, no exceptions. ⚰️ MEASURED 2026-11-21 before the edge charts: 11 of 17. The six that stayed right
    # were drawings held on the newest bar, where on the plain bars one bar more changes nothing (the highest high of
    # 253 bars WAS the highest of 252; "above its 51 day average" read the same as 50). A case that cannot tell an
    # off-by-one window proves nothing about the window, so each of those names an EDGE (`case["edge"]`): one bar,
    # just outside the window the request names, made a strict extreme.
    assert len(tried) == len(SCRIPT) >= FLOOR
    assert sorted(caught) == sorted(c["id"] for c in tried), sorted({c["id"] for c in tried} - set(caught))


def test_a_short_window_is_the_one_the_request_names():
    by_id = {c["id"]: c for c in SCRIPT}
    assert set(SHORT_WINDOWS) <= set(by_id)
    for cid, window in SHORT_WINDOWS.items():
        assert 1 <= window < 5 and f"the {window} bars before it and the {window} bars after it" in by_id[cid]["words"], cid
    # the slip really reaches such a window, and without the case's number it does not
    source = 'left = input.int(3, "Bars before")\npl = ta.pivotlow(low, left, 3)\n'
    assert _every_window_one_longer(source) == (source.rstrip("\n"), False)
    assert _every_window_one_longer(source, 3) == ('left = input.int(4, "Bars before")\npl = ta.pivotlow(low, left, 4)', True)


#: ⭐ 2026-11-24 (coordinator's ruling): ONE phrasing counts its window back from the bar BEFORE the newest, "looking
#: back at most N bars" (cap-01), so the bar just outside it is N + 1 back. Only that exact phrasing reads so.
AT_MOST = re.compile(r"\blooking back at most (\d+) bars\b")


def _edge_is_in_the_words(case):
    """The window an edge sits outside is the one the member's words name: "the last 252 bars" does not reach the bar
    252 bars before the newest; "looking back at most 250 bars" does not reach the bar 251 before it."""
    edge, words = case["edge"], case["words"]
    if re.search(rf"(?<!\d){edge['back']}(?!\d)", words):
        return True
    said = AT_MOST.search(words)
    return bool(said) and int(said.group(1)) + 1 == edge["back"]


def test_an_edge_sits_one_bar_outside_the_window_the_request_names():
    edged = [c for c in SCRIPT if c.get("edge")]
    assert len(edged) >= 5
    for case in edged:
        edge = case["edge"]
        assert set(edge) <= {"back", "high", "low", "othersClose", "close", "ties"}, case["id"]
        for t in edge.get("ties") or []:                                   # 2026-11-25: exact ties, for strict words
            assert {"field", "back", "as"} <= set(t) <= {"field", "back", "as", "from"}, (case["id"], t)
            assert t["field"] in "ohlcv" and t.get("from", t["field"]) in "ohlcv" and t["back"] != t["as"], (case["id"], t)
        if set(edge) == {"ties"}:
            continue                                                       # a tie names no window: it tells > from >=
        assert isinstance(edge["back"], int), case["id"]
        assert edge.get("high") or edge.get("low") or edge.get("othersClose") or edge.get("close"), case["id"]
        assert _edge_is_in_the_words(case), (case["id"], case["words"])


def test_only_the_looking_back_at_most_phrasing_reads_its_window_from_the_bar_before():
    """Control (coordinator 2026-11-24): the words check does not loosen for every case."""
    ordinary = {"edge": {"back": 252, "high": True}, "words": "Draw a horizontal line at the highest high of the last 252 bars"}
    assert _edge_is_in_the_words(ordinary)
    assert not _edge_is_in_the_words({**ordinary, "edge": {"back": 253, "high": True}})     # N + 1 is not N
    at_most = {"edge": {"back": 251, "close": True},
               "words": "plot how many bars back the most recent close above today's close was, looking back at most 250 bars"}
    assert _edge_is_in_the_words(at_most)
    assert not _edge_is_in_the_words({**at_most, "edge": {"back": 252, "close": True}})    # N + 2 is not N + 1
    for other in ("plot how many bars back, at most 250 bars back", "within the last 250 bars", "looking back 250 bars"):
        assert not _edge_is_in_the_words({**at_most, "words": other}), other              # only that exact phrasing


def test_the_close_edge_makes_cap01s_window_decisive_on_the_newest_bar():
    """The edge works only if, ON IT, the recorded script and the same script one bar longer differ on the newest bar
    (coordinator 2026-11-24); on the plain bars they cannot be told apart, which is why the edge exists."""
    from tools.value_cases import script_lane
    case = next(c for c in SCRIPT if c["id"] == "cap-01")
    assert case["edge"] == {"back": 251, "close": True}
    source = case["answer"]["script"]["pine"]
    longer, hit = _every_window_one_longer(source, SHORT_WINDOWS.get(case["id"]))
    assert hit and "251" in longer and "251" not in source
    # "above" is strict in the words; the same script counting a close AT LEAST today's (coordinator 2026-11-24)
    at_least = source.replace("if close[i] > close", "if close[i] >= close")
    assert at_least != source
    run = _lane(script_lane.run, [{"id": "recorded@edge", "source": source, "chart": "daily", "edge": case["edge"]},
                                  {"id": "longer@edge", "source": longer, "chart": "daily", "edge": case["edge"]},
                                  {"id": "at-least@edge", "source": at_least, "chart": "daily", "edge": case["edge"]},
                                  {"id": "recorded@plain", "source": source, "chart": "daily"},
                                  {"id": "longer@plain", "source": longer, "chart": "daily"},
                                  {"id": "at-least@plain", "source": at_least, "chart": "daily"}])
    column = lambda job: next(iter(run["scripts"][job]["columns"].values()))   # noqa: E731 -- the script's one plot
    assert column("recorded@edge")[-1] is None and column("longer@edge")[-1] == 251
    assert column("at-least@edge")[-1] == 2                                   # the tie, 2 bars back
    # on the plain bars neither slip can be told apart: why the edge exists
    assert column("recorded@plain") == column("longer@plain") == column("at-least@plain")


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
