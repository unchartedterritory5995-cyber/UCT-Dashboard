"""scripts/study/apply_upgrade.py: the merge tool the overbuild pipeline uses (docs/study/OVERBUILD_PLAN.md)."""
from __future__ import annotations

import copy
import json

from scripts.study import apply_upgrade as au
from scripts.study import courses_lib as cl
from tests.test_study_courses import _first, _unit

UP = {"q01": {"simple": "The bid is the most a buyer will pay right now.", "tier": "core",
              "risk": {"score": 2, "reasons": ["stable definition"]}}}


def test_a_clean_upgrade_merges_and_validates():
    d = copy.deepcopy(_unit())
    notes = au.apply(d, UP, "pilot-1")
    assert notes == [] and cl.unit_problems(d) == []
    q = _first(d, "q01")
    assert q["simple"].startswith("The bid") and q["batch"] == "pilot-1"
    assert d["verify"]["q01"]["by"] == "writer" and "awaiting cold re-read" in d["verify"]["q01"]["notes"]


def test_a_fourth_answer_is_merged_and_wrong_notes_for_a_removed_choice_are_dropped():
    d = copy.deepcopy(_unit())
    up = {"q04": {"choices": ["The bid", "The ask", "The midpoint", "The last trade"],
                  "wrong": {"The last trade": "That already traded."}, "simple": "At market you sell at the bid."}}
    au.apply(d, up, "pilot-1")
    q = _first(d, "q04")
    assert len(q["choices"]) == 4 and "The last trade" in q["wrong"] and "The ask" in q["wrong"]
    assert cl.unit_problems(d) == []


def test_a_checker_fix_cut_and_pass_land_in_verify():
    d = copy.deepcopy(_unit())
    au.apply(d, UP, "pilot-1", {
        "q01": {"status": "fix", "notes": "tighter", "fix": {"simple": "The bid is the top price a buyer will pay."}},
        "q02": {"status": "cut", "notes": "ambiguous"},
        "q03": {"status": "pass", "notes": "ok"}})
    assert _first(d, "q01")["simple"].endswith("will pay.") and d["verify"]["q01"] == {
        "status": "pass", "by": "checker", "fixed": True, "notes": "tighter"}
    assert d["verify"]["q02"]["status"] == "cut" and d["verify"]["q03"]["by"] == "checker"


def test_an_unknown_key_is_reported_not_crashed_on_and_the_validator_still_bites():
    d = copy.deepcopy(_unit())
    notes = au.apply(d, {"q99": {"simple": "x y z w."}, "q01": {"simple": " ".join(["plain"] * 30)}}, "b")
    assert any("q99" in n for n in notes)
    assert any("simple is 30 words" in p for p in cl.unit_problems(d))


def test_the_command_line_writes_a_copy_and_leaves_the_original(tmp_path):
    src = tmp_path / "unit.json"
    src.write_text(json.dumps(_unit()), encoding="utf-8")
    up = tmp_path / "up.json"
    up.write_text(json.dumps({"questions": UP}), encoding="utf-8")
    out = tmp_path / "out.json"
    assert au.main([str(src), str(up), "--out", str(out), "--batch", "t"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["questions"][0].get("simple")
    assert "simple" not in json.loads(src.read_text(encoding="utf-8"))["questions"][0]


def test_new_questions_facts_and_cuts_are_applied_and_later_files_override_earlier_ones(tmp_path):
    d = copy.deepcopy(_unit())
    nq = {"key": "q90", "skill": "basics.spread", "rung": 2, "format": "tf", "facts": ["f9"], "why": "That's the bid.",
          "lesson_line": "The bid is what a buyer pays you.", "q": "The bid is the most a buyer will pay right now.",
          "answer": "True"}
    extra = {"cut": ["q02"], "new_questions": [nq],
             "new_facts": [{"id": "f9", "source": "s1", "quote": "The bid price is the highest price a buyer will pay.",
                            "claim": "The bid is the most a buyer will pay right now."}], "new_sources": []}
    notes = au.apply(d, {}, "pilot-1", None, extra)
    assert notes == []
    assert d["verify"]["q02"]["status"] == "cut" and any(q["key"] == "q90" and q["batch"] == "pilot-1" for q in d["questions"])
    assert any(f["id"] == "f9" for f in d["facts"])
    # the same fact and question again are not added twice
    assert any("already exists" in n for n in au.apply(d, {}, "pilot-1", None, extra))
    assert sum(1 for f in d["facts"] if f["id"] == "f9") == 1
    # the command line layers files: the later one wins field by field
    src = tmp_path / "unit.json"
    src.write_text(json.dumps(_unit()), encoding="utf-8")
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps({"questions": {"q01": {"simple": "The bid is the most a buyer will pay right now.", "tier": "core"}}}), encoding="utf-8")
    b.write_text(json.dumps({"questions": {"q01": {"tier": "extended"}}}), encoding="utf-8")
    out = tmp_path / "out.json"
    assert au.main([str(src), str(a), str(b), "--out", str(out)]) == 0
    q1 = json.loads(out.read_text(encoding="utf-8"))["questions"][0]
    assert q1["tier"] == "extended" and q1["simple"].startswith("The bid")


def test_a_cut_beats_an_upgrade_and_a_pass_and_a_calc_can_be_replaced():
    d = copy.deepcopy(_unit())
    au.apply(d, UP, "b", {"q01": {"status": "pass", "notes": "ok"}}, {"cut": ["q01"]})
    assert d["verify"]["q01"]["status"] == "cut"
    d2 = copy.deepcopy(_unit())
    au.apply(d2, {"q06": {"calc": {"fn": "spread", "args": {"bid": 20.0, "ask": 20.1}}, "answer": 0.1,
                         "q": "The bid is 20.00 and the ask is 20.10. What is the spread in dollars?",
                         "why": "0.10. Ask minus bid."}}, "b")
    assert cl.unit_problems(d2) == []


def test_a_fact_shipped_inside_a_checker_fix_is_added_to_the_lesson():
    d = copy.deepcopy(_unit())
    fact = {"id": "f9", "source": "s1", "quote": "The bid price is the highest price a buyer will pay.", "claim": "Bid."}
    au.apply(d, {}, "b", {"q01": {"status": "fix", "notes": "x", "fix": {"facts": ["f1", "f9"], "new_fact": fact, "house": True}}})
    assert any(f["id"] == "f9" for f in d["facts"]) and _first(d, "q01")["facts"] == ["f1", "f9"]
    assert "new_fact" not in _first(d, "q01") and "house" not in _first(d, "q01")


def test_a_typed_number_question_may_become_multiple_choice_and_nothing_else_changes_format():
    """Owner 2026-11-12: multiple choice over typed numbers; no other format change is allowed."""
    from scripts.study import apply_upgrade as au
    q = {"key": "q1", "format": "numeric", "answer": 0.5}
    au._set_fields(q, {"format": "mcq", "choices": ["0.5%", "0.1%", "5%", "0.05%"], "answer": "0.5%"})
    assert q["format"] == "mcq" and q["answer"] == "0.5%"
    t = {"key": "q2", "format": "tf", "answer": "True"}
    au._set_fields(t, {"format": "mcq"})
    assert t["format"] == "tf"
    # the visuals plan (2026-11-14): a chart question gains its story by becoming a scenario; never the other way
    m = {"key": "q3", "format": "mcq", "answer": "Wait"}
    au._set_fields(m, {"format": "scenario", "story": "Hidden ticker, the day before the trigger."})
    assert m["format"] == "scenario" and m["story"].startswith("Hidden ticker")
    s = {"key": "q4", "format": "scenario", "answer": "Wait"}
    au._set_fields(s, {"format": "mcq"})
    assert s["format"] == "scenario"


def test_a_checker_fix_can_drop_a_chart_and_a_writer_null_cannot():
    """2026-11-14: a checker that finds the bars contradict a chart drops it with "chart": null in its fix."""
    d = copy.deepcopy(_unit())
    q = _first(d, "q01")
    q["chart"] = {"sym": "ABC", "asof": "2024-01-02", "window": 120, "forward": 20}
    au.apply(d, {"q01": {"chart": None}}, "b")               # a writer's null is ignored
    assert _first(d, "q01").get("chart", {}).get("sym") == "ABC"
    au.apply(d, {}, "b", {"q01": {"status": "fix", "notes": "the close is under the low", "fix": {"chart": None}}})
    assert "chart" not in _first(d, "q01") and d["verify"]["q01"]["fixed"] is True
