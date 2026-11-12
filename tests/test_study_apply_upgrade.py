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
