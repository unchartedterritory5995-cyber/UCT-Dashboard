"""THE VALUE CASES: what the Create Indicator door answered, held to an independent account of what was asked.

Until this file, nothing in the repository compared a model-built indicator's NUMBERS with a calculation of the
member's words. The evaluation runner compares an answer with a reference formula on the same engine; the house
set holds fourteen frozen indicators. Whether "plot how many of the last 10 bars closed in the top half of their
range" came back as the right count on every bar was checked by hand, a round at a time, in private notes.

A case is the member's words, the lane it belongs on, and the answer the door gave on production (recorded as a
synthetic test account), all in `tests/fixtures/authoring/value_cases.json`:
  * lane "formula": a plain calculation written from the words, importing nothing of the engine
    (`tools/value_cases/rules.py`), must equal what was built on every bar;
  * lane "wall": the request cannot be served; the right answer builds nothing, refuses, and NAMES THE WALL in
    plain words. One evidence tier, negatives included.

What is held here, on a built market with deliberate ties (`tools/value_cases/market.py`), with no paid call:
  * every recorded answer is right on its lane;
  * THE CHECK CAN FAIL: a formula two bars late, a neighbouring request's answer, a rule read one bar late, a
    refusal that names nothing, a build where a refusal belongs: each turns a right case wrong;
  * most single-number slips are caught (a window of 20 written as 21), measured over the whole set;
  * THE RULE NEVER LEARNS FROM THE DOOR: every rule's numbers are fingerprinted in the case, and a changed rule
    is red until the case records the reason with words quoted from the request;
  * the calculations import nothing of the product, and the market is the same on every run and has ties.

The record is refreshed by `tools/value_eval.py` after a live re-run; this file never calls a model.
"""
from __future__ import annotations

import ast
import copy
import json
from pathlib import Path

import pytest

from tools import value_eval
from tools.value_cases import grade as G
from tools.value_cases import market, rules

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = DATA["cases"]
BY_ID = {c["id"]: c for c in CASES}
FORMULA = [c for c in CASES if c["lane"] == "formula"]
WALL = [c for c in CASES if c["lane"] == "wall"]
#: the formula cases the record holds RIGHT, and the known defects it holds WRONG (each named, never passed)
RIGHT = [c for c in FORMULA if c.get("recorded_verdict") != "wrong"]
KNOWN_WRONG = [c for c in FORMULA if c.get("recorded_verdict") == "wrong"]
#: the walls the record holds RIGHT (a wall recorded WRONG is a known defect of the door's refusal, named in the case)
RIGHT_WALL = [c for c in WALL if c.get("recorded_verdict") != "wrong"]
#: graded here; the script lane runs the browser engine and has its own file (tests/test_value_cases_scripts.py)
HERE = FORMULA + WALL
#: the fewest cases each lane may hold: a fixture cut to a handful would still pass every other test
FLOOR = {"formula": 100, "wall": 28}
FIRST_REASON = "written from the request's words before the answer was read"


def test_the_fixture_is_whole():
    assert DATA["schema"] == "uct.value-cases/1"
    assert len(FORMULA) >= FLOOR["formula"] and len(WALL) >= FLOOR["wall"]
    assert len(BY_ID) == len(CASES)                                  # no id twice
    assert {c["lane"] for c in CASES} <= {"formula", "wall", "script"}
    for case in CASES:
        assert case["words"].strip() and len(case["words"]) > 12, case["id"]
        assert case["recorded"]["on"][:4] == "2026", case["id"]
        assert ("rule" in case) == (case["lane"] in ("formula", "script")) and ("wall" in case) == (case["lane"] == "wall"), case["id"]
        # a case may be recorded WRONG: a known defect of the door, named, never silently passed
        assert case.get("recorded_verdict", "wrong" if "defect" in case else None) in (None, "wrong"), case["id"]
        assert ("defect" in case) == (case.get("recorded_verdict") == "wrong") and len(case.get("defect") or "x" * 99) > 80, case["id"]
    assert [c["id"] for c in CASES if c.get("recorded_verdict") == "wrong"] == ["intraday-01", "intraday-02", "date-start-01", "j06", "count-on-bars-01", "table-format-01", "wall-26"]     # every one is named here, on purpose


@pytest.mark.parametrize("case", HERE, ids=[c["id"] for c in HERE])
def test_the_recorded_answer_is_right_on_the_lane_the_request_belongs_on(case):
    result = G.grade_case(case)
    assert result["lane"] == case["lane"]
    if case.get("recorded_verdict") == "wrong":                   # a known defect of the door, named in the case: never passed
        assert result["verdict"] == "wrong", (case["id"], "is recorded WRONG and now grades", result["verdict"], result["lines"])
        return
    assert result["verdict"] == "right", (case["words"], result["lines"])
    if case["lane"] == "formula":
        # something was compared: "right" over no bars would be a pass by silence
        compared = [int(line.rsplit(" on ", 1)[1].split()[0]) for line in result["lines"] if " = " in line]
        assert compared and min(compared) > 200, result["lines"]


def test_every_formula_case_has_a_rule_that_covers_the_whole_market():
    for case in FORMULA:
        want = rules.rules(case["id"])
        assert want, case["id"]
        for what, readings in want.items():
            if what != "__outputs__":
                bars = G.CHARTS[case.get("chart", "daily")]["bars"]        # the chart the case names (daily unless it says)
                assert readings and all(len(col) == len(bars) for _name, col in readings), (case["id"], what)
    assert len(G.CHARTS["daily"]["bars"]) == market.BAR_COUNT and {c.get("chart", "daily") for c in FORMULA} == {"daily", "intraday"}


# ── the rule never learns from the door ──

@pytest.mark.parametrize("case", FORMULA, ids=[c["id"] for c in FORMULA])
def test_a_rule_says_today_what_its_case_recorded(case):
    """A rule whose numbers changed is RED here until the case records why, in the request's own words."""
    assert G.rule_digest(case["id"]) == case["rule"]["digest"], (
        f"the rule of {case['id']} no longer says what the case recorded. If the rule was WRONG about the request's words, add an entry to "
        f"rule.history with the new digest (python tools/value_eval.py --rule-digest {case['id']}), the reason, and the words quoted from the request. "
        "A rule is never changed to agree with what the door built.")


@pytest.mark.parametrize("case", FORMULA, ids=[c["id"] for c in FORMULA])
def test_every_change_of_a_rule_carries_its_reason_and_the_words_it_rests_on(case):
    history = case["rule"]["history"]
    assert history and history[0]["reason"] == FIRST_REASON
    assert history[-1]["digest"] == case["rule"]["digest"]
    for entry in history[1:]:
        assert len(entry["reason"]) > 40, case["id"]
        assert entry["quote"] and entry["quote"].lower() in case["words"].lower(), (case["id"], entry.get("quote"))


def test_CONTROL_the_fingerprint_moves_when_a_rule_changes_and_only_then(monkeypatch):
    cid = FORMULA[0]["id"]
    before = G.rule_digest(cid)
    assert before == G.rule_digest(cid) and len(before) == 16
    assert G.rule_digest("no-such-case") is None
    real = rules.rules

    def nudged(c):
        want = real(c)
        first = next(k for k in want if k != "__outputs__")
        name, col = want[first][0]
        k = next(i for i, v in enumerate(col) if G._ok(v))
        want[first][0] = (name, col[:k] + [col[k] * 1.001 + 1.0] + col[k + 1:])  # ONE bar of one reading, a tenth of a percent
        return want
    monkeypatch.setattr(rules, "rules", nudged)
    assert G.rule_digest(cid) != before


# ── the check can fail: formulas ──

def _late(tree, bars=2):
    """The same formula read `bars` bars late. TWO by default: a request for "the last 20 bars" is honestly read with
    or without this bar, a rule lists both readings, and one bar late IS the other reading for many of them."""
    return {"type": "offset", "value": bars, "args": [tree]}


def _outputs(answer):
    return [o for op in answer["ops"] for o in (op.get("outputs") or []) if isinstance(o, dict) and o.get("tree") is not None]


def test_CONTROL_a_formula_two_bars_late_is_wrong():
    caught = 0
    with_outputs = [c for c in FORMULA if _outputs(c["answer"])]
    for case in with_outputs:
        answer = copy.deepcopy(case["answer"])
        for o in _outputs(answer):
            o["tree"] = _late(o["tree"])
        caught += G.grade_case(case, answer)["verdict"] == "wrong"
    # a line that does not move is the same two bars late; nearly everything else is not
    assert len(with_outputs) >= FLOOR["formula"] - 5 and caught >= len(with_outputs) - 3, (caught, len(with_outputs))


def test_CONTROL_another_requests_answer_is_wrong():
    wrong = sum(G.grade_case(case, FORMULA[(k + 7) % len(FORMULA)]["answer"])["verdict"] == "wrong" for k, case in enumerate(FORMULA))
    assert wrong >= len(FORMULA) - 3, wrong                           # a few requests are near twins of another


def test_CONTROL_a_rule_read_one_bar_late_fails_the_right_answer(monkeypatch):
    real = rules.rules

    def late(cid):
        want = real(cid)
        return None if want is None else {what: (readings if what == "__outputs__" else [(name, [G.NAN] + list(col[:-1])) for name, col in readings])
                                          for what, readings in want.items()}
    monkeypatch.setattr(rules, "rules", late)
    wrong = sum(G.grade_case(c)["verdict"] == "wrong" for c in FORMULA)
    assert wrong >= len(FORMULA) - 3, wrong


def test_CONTROL_an_empty_answer_and_an_unknown_id_are_named_never_passed():
    some = FORMULA[0]
    assert G.grade(some["id"], {"ops": []})["verdict"] == "not built"
    assert G.grade(some["id"], None)["verdict"] == "not built"
    assert G.grade("no-such-case", some["answer"])["verdict"] == "no rule"
    assert G.grade_case(some, {"ops": []})["verdict"] == "not built"


def _bump_first_window(tree):
    """The same formula with its first whole number above 1 (or its first offset) raised by one: 20 written as 21."""
    done = {"hit": False}

    def walk(node):
        if isinstance(node, dict):
            if not done["hit"] and node.get("type") in ("num", "offset") and isinstance(node.get("value"), int) and not isinstance(node["value"], bool) \
                    and (1 < node["value"] < 900 if node["type"] == "num" else node["value"] >= 1):
                done["hit"] = True
                return {**node, "value": node["value"] + 1}
            return {k: walk(v) for k, v in node.items()}
        return [walk(v) for v in node] if isinstance(node, list) else node
    return walk(tree), done["hit"]


def test_most_single_number_slips_are_caught():
    tried = caught = 0
    for case in FORMULA:
        answer = copy.deepcopy(case["answer"])
        outs = _outputs(answer)
        if not outs:
            continue
        outs[0]["tree"], hit = _bump_first_window(outs[0]["tree"])
        if hit:
            tried += 1
            caught += G.grade_case(case, answer)["verdict"] != "right"
    # not every number matters (a warmup of 300 is as good as 301): the floor is measured, and it is high
    assert tried >= 70 and caught / tried >= 0.85, (caught, tried)


# ── the check can fail: walls ──

def test_CONTROL_a_refusal_that_names_nothing_is_wrong():
    for case in WALL:
        vague = {"disposition": "unsupported", "reply": "I can't build that here. Tell me what else you would like to see."}
        assert G.grade_case(case, vague)["verdict"] == "wrong", case["id"]


def test_CONTROL_a_build_where_a_refusal_belongs_is_wrong_whatever_it_says():
    built = FORMULA[0]["answer"]
    for case in WALL:
        answer = {**copy.deepcopy(built), "disposition": "change", "reply": case["answer"]["reply"]}
        result = G.grade_case(case, answer)
        assert result["verdict"] == "wrong" and "BUILT" in result["lines"][0], case["id"]


def test_CONTROL_a_question_is_not_a_refusal():
    case = WALL[0]
    asked = {"disposition": "clarify", "reply": case["answer"]["reply"]}
    assert G.grade_case(case, asked)["verdict"] == "wrong"


def test_every_wall_is_named_in_the_requests_own_words():
    for case in WALL:
        names = case["wall"]["names"]
        assert names and any(n.lower() in case["words"].lower() for n in names), case["id"]


def test_a_script_case_is_never_passed_by_this_files_grader():
    script = next(c for c in CASES if c["lane"] == "script")
    assert G.grade_case(script)["verdict"] == "no grader"
    assert G.lane_of(script["answer"]) == "script"


def test_a_refusal_where_a_formula_belongs_is_not_right():
    refused = WALL[0]["answer"]
    result = G.grade_case(FORMULA[0], refused)
    assert result["verdict"] == "not built" and result["lane"] == "wall"


# ── the calculations stand apart from the product ──

@pytest.mark.parametrize("module", ["rules.py", "event_rules.py", "stat_rules.py", "market.py", "intraday_rules.py"])
def test_the_calculations_import_nothing_of_the_product(module):
    tree = ast.parse((ROOT / "tools" / "value_cases" / module).read_text(encoding="utf-8"))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(("." * node.level) + (node.module or ""))
    # `zoneinfo` is the standard library: the 5 minute chart's sessions open at 09:30 New York time, summer and winter
    allowed = {"math", "datetime", "zoneinfo", ".market", ".event_rules", ".stat_rules", ".intraday_rules"}
    assert set(names) <= allowed, sorted(set(names) - allowed)


def test_CONTROL_the_import_check_sees_the_graders_engine_import():
    tree = ast.parse((ROOT / "tools" / "value_cases" / "grade.py").read_text(encoding="utf-8"))
    assert "api.services" in [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]


def test_the_market_is_the_same_every_run_long_enough_and_has_ties():
    assert market._walk(market._DAYS, 20261121, 42.0, 0.012, 0.046, 31, 3.1e7) == market.STOCK
    bars = market.STOCK
    assert len(bars) == market.BAR_COUNT > 960 + 500
    assert bars[-1]["t"] == market.LAST_DAY.isoformat()
    assert all(b["l"] <= min(b["o"], b["c"]) and b["h"] >= max(b["o"], b["c"]) and b["v"] > 0 for b in bars)
    pairs = list(zip(bars, bars[1:]))
    assert sum(1 for a, b in pairs if a["c"] == b["c"]) > 20          # an unchanged close
    assert sum(1 for a, b in pairs if a["h"] == b["h"]) > 20          # an equal high
    assert sum(1 for a, b in pairs if a["l"] == b["l"]) > 20          # an equal low
    assert sum(1 for a, b in pairs if b["h"] < a["h"] and b["l"] > a["l"]) > 50      # inside bars
    assert all([b["t"] for b in series] == [b["t"] for b in bars] for series in market.OTHER.values())


# ── the runner: a fresh run against the record, and the ratchet ──

def _answers_dir(tmp_path, changed=None, missing=()):
    """A run folder as the recorder writes one: <id>-0.body.json per request, the door's whole answer."""
    for case in HERE:
        if case["id"] in missing:
            continue
        answer = (changed or {}).get(case["id"], case["answer"])
        body = {"disposition": answer.get("disposition", "change"), "reply": answer.get("reply", ""), "envelope": {"ops": answer.get("ops")}} \
            if "ops" in answer else dict(answer)
        (tmp_path / f"{case['id']}-0.body.json").write_text(json.dumps(body), encoding="utf-8")
    return tmp_path


def test_a_fresh_run_equal_to_the_record_scores_every_case(tmp_path):
    report = value_eval.grade_run(DATA, _answers_dir(tmp_path))
    # a known defect is ANSWERED and not right: it is in `of` and `answered`, never in `right`, and it is no change
    assert KNOWN_WRONG and len(RIGHT) + len(KNOWN_WRONG) == len(FORMULA)
    assert report["scores"] == {"formula": {"right": len(RIGHT), "of": len(FORMULA), "answered": len(FORMULA)},
                                "wall": {"right": len(RIGHT_WALL), "of": len(WALL), "answered": len(WALL)}}
    assert report["full"] is True and report["full_lanes"] == ["formula", "wall"] and report["changed"] == []


def test_a_known_defect_the_door_now_gets_right_is_named_as_a_change(tmp_path):
    """wrong -> RIGHT is reported (it is how a fix shows in a live run), and it is never counted as worse."""
    case = KNOWN_WRONG[0]
    fixed = copy.deepcopy(RIGHT[0]["answer"])
    real = G.grade_case
    try:
        G.grade_case = lambda c, answer=None: ({"verdict": "right", "lines": [], "lane": c["lane"]}
                                               if c["id"] == case["id"] and answer is not None else real(c, answer) if answer is not None else real(c))
        report = value_eval.grade_run(DATA, _answers_dir(tmp_path, changed={case["id"]: fixed}))
    finally:
        G.grade_case = real
    assert [(row["id"], row["was"], row["now"]) for row in report["changed"]] == [(case["id"], "wrong", "right")]
    assert report["scores"]["formula"]["right"] == len(RIGHT) + 1


def test_a_fresh_run_names_what_went_wrong_and_what_was_not_answered(tmp_path):
    late = copy.deepcopy(RIGHT[3]["answer"])
    for o in _outputs(late):
        o["tree"] = _late(o["tree"])
    report = value_eval.grade_run(DATA, _answers_dir(tmp_path, changed={RIGHT[3]["id"]: late}, missing={RIGHT_WALL[1]["id"]}))
    assert report["scores"]["formula"]["right"] == len(RIGHT) - 1
    assert report["full"] is False and report["full_lanes"] == ["formula"]      # the wall lane has a request unanswered
    assert [(row["id"], row["was"], row["now"]) for row in report["changed"]] == [(RIGHT[3]["id"], "right", "wrong"), (RIGHT_WALL[1]["id"], "right", "no answer")]


def test_THE_RATCHET_the_first_full_run_writes_the_threshold_and_a_later_run_below_it_is_red(tmp_path):
    data = copy.deepcopy(DATA)
    assert data["thresholds"]["formula"] is None and data["thresholds"]["wall"] is None
    (tmp_path / "a").mkdir()
    full = value_eval.grade_run(data, _answers_dir(tmp_path / "a"))
    verdict = value_eval.apply_ratchet(data, full)
    # the line is what the run got RIGHT: a known defect is below it from the start, and fixing one raises nothing by itself
    assert verdict["ok"] and data["thresholds"]["formula"] == len(RIGHT) and data["thresholds"]["wall"] == len(RIGHT_WALL)
    # a later full run with one formula wrong is below the line: red, and the line does not move
    late = copy.deepcopy(RIGHT[0]["answer"])
    for o in _outputs(late):
        o["tree"] = _late(o["tree"])
    (tmp_path / "b").mkdir()
    worse = value_eval.grade_run(data, _answers_dir(tmp_path / "b", changed={RIGHT[0]["id"]: late}))
    verdict = value_eval.apply_ratchet(data, worse)
    assert verdict["ok"] is False and "formula" in verdict["below"]
    assert data["thresholds"]["formula"] == len(RIGHT)
    # LANE BY LANE: a lane with a request unanswered is neither written nor tested; a lane fully answered is
    data2 = copy.deepcopy(DATA)
    (tmp_path / "c").mkdir()
    partial = value_eval.grade_run(data2, _answers_dir(tmp_path / "c", missing={FORMULA[0]["id"]}))
    verdict = value_eval.apply_ratchet(data2, partial)
    assert verdict["ok"] and data2["thresholds"]["formula"] is None and data2["thresholds"]["wall"] == len(RIGHT_WALL)
    # and a run that answers no lane fully touches nothing
    data3 = copy.deepcopy(DATA)
    (tmp_path / "d").mkdir()
    thin = value_eval.grade_run(data3, _answers_dir(tmp_path / "d", missing={FORMULA[0]["id"], WALL[0]["id"]}))
    assert value_eval.apply_ratchet(data3, thin) == {"ok": True, "below": [], "note": "no lane was fully answered: the thresholds are neither written nor tested"}
    assert data3["thresholds"] == DATA["thresholds"]


def test_the_thresholds_in_the_repository_were_written_by_a_run_or_are_not_yet_set():
    for lane in ("formula", "wall", "script"):
        line = DATA["thresholds"][lane]
        assert line is None or (isinstance(line, int) and 0 < line <= sum(1 for c in CASES if c["lane"] == lane)), lane
