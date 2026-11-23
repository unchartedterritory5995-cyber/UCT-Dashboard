"""A FIXED DEFECT STAYS IN THE FIXTURE AS A SPECIMEN (`found`).

`tools/value_eval.py --adopt` makes a live run's RIGHT answers the record. A case that was recorded WRONG and that the
door now gets right used to lose its wrong answer and its defect sentence that day, and with them the example every
test of that finding rests on. Now it keeps them: the wrong answer is APPENDED to the case's `found` list as
{answer, defect, recorded, fixed_by} and `answer` becomes the right one.

Held here:
  * THE INVARIANT, for every case that carries a `found`: each specimen is graded WRONG and the record is graded
    RIGHT, by the SAME rule. A specimen the rule would pass is no specimen; a record the rule fails is no fix;
  * ⭐ (e95 unit 1, coordinator ruling 2026-11-22; a schema extension for the studio's review) A SPECIMEN THE ENGINE
    FIXED: a wrong answer whose ONLY fault was what the engine drew carries `engine_fixed: {by, since_engine}`, and the
    invariant is two-sided: such a specimen must grade RIGHT through the engine (the engine fix, held), every other
    specimen WRONG. The specimen stays the regression test it was: an engine that blanks it again turns this red;
  * adopt keeps the specimen, appends (a second defect on the same case is a second entry, the first is untouched),
    and adopts a fixed defect ONLY with what fixed it (a PR and its merge commit): without that the old record stands;
  * `grade.specimen(case)` is the wrong answer a finding rests on, before and after adoption;
  * a case that never was wrong has no specimen, and a right answer adopted over a right record makes none.

No paid calls. The script-lane half of the invariant needs node; where it is missing it SKIPS, and the lane that
runs this file treats a skip as a failure.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from tools import value_eval
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
CASES = DATA["cases"]
WITH_FOUND = [c for c in CASES if c.get("found")]
KEYS = {"answer", "defect", "recorded", "fixed_by"}
#: ⭐ e95 unit 1 — the one optional key: a specimen the ENGINE fixed (`{by, since_engine}`), graded RIGHT, never WRONG
ENGINE_FIXED = "engine_fixed"
FIX = {"pr": "#0000", "merge": "0123456789abcdef"}
STAMPS = {"started": "2026-11-22T10:00Z", "front": "abcdef0123", "model": "m"}
#: a wall case and an answer its rule passes, and one it fails (the yes that names nothing)
WALL = next(c for c in CASES if c["lane"] == "wall" and set(c["wall"]) == {"names"} and c.get("recorded_verdict") != "wrong")
RIGHT_ANSWER = copy.deepcopy(WALL["answer"])
WRONG_ANSWER = {"disposition": "unsupported", "reply": "I can't build that."}
DEFECT = "The reply names nothing the member can act on: it says it cannot, and not what is missing or where the wall is, so the member learns nothing."


def wrong_case():
    """A copy of a wall case as it stands the day a live run finds it WRONG."""
    case = copy.deepcopy(WALL)
    case.update({"answer": dict(WRONG_ANSWER), "recorded_verdict": "wrong", "defect": DEFECT, "recorded": {"on": "2026-11-21", "front": "1111111111"}})
    return case


def report_right(case):
    return {"verdicts": {case["id"]: "right"}, "answers": {case["id"]: copy.deepcopy(RIGHT_ANSWER)}}


def test_CONTROL_the_two_answers_of_these_tests_are_right_and_wrong_by_the_rule():
    assert G.grade_case(WALL, RIGHT_ANSWER)["verdict"] == "right" and G.grade_case(WALL, WRONG_ANSWER)["verdict"] == "wrong"
    assert len(DEFECT) > 80


# ── adopt ──

def test_a_fixed_defect_is_kept_as_a_specimen_and_the_right_answer_becomes_the_record():
    case = wrong_case()
    data = {"cases": [case]}
    adopted, kept = value_eval.adopt(data, report_right(case), STAMPS, {case["id"]: FIX})
    assert (adopted, kept) == ([case["id"]], [])
    assert case["answer"] == value_eval.record_of(case, RIGHT_ANSWER) and "recorded_verdict" not in case and "defect" not in case
    assert case["recorded"] == {"on": "2026-11-22", "front": "abcdef0123", "model": "m"}
    assert case["found"] == [{"answer": WRONG_ANSWER, "defect": DEFECT, "recorded": {"on": "2026-11-21", "front": "1111111111"}, "fixed_by": FIX}]
    # by the same rule: the specimen is wrong, the record is right
    assert G.grade_case(case, case["found"][0]["answer"])["verdict"] == "wrong" and G.grade_case(case)["verdict"] == "right"


@pytest.mark.parametrize("fixed_by", [None, {}, {"another-case": FIX}, {"__ID__": {"pr": "#1"}}, {"__ID__": {"merge": "abc"}}, {"__ID__": "#1"}])
def test_a_fixed_defect_is_adopted_only_with_what_fixed_it(fixed_by):
    case = wrong_case()
    before = copy.deepcopy(case)
    if fixed_by and "__ID__" in fixed_by:
        fixed_by = {case["id"]: fixed_by["__ID__"]}
    adopted, kept = value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, fixed_by)
    assert (adopted, kept) == ([], [case["id"]]) and case == before          # the old record stands, untouched


def test_a_second_defect_on_the_same_case_is_APPENDED_never_overwrites():
    case = wrong_case()
    value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, {case["id"]: FIX})
    first = copy.deepcopy(case["found"][0])
    # a later run finds it wrong again (the record is replaced by hand with the new wrong answer and its defect) ...
    again = {"disposition": "answer", "reply": "Sure, here it is."}
    case.update({"answer": again, "recorded_verdict": "wrong", "defect": DEFECT.replace("names nothing", "answers as if it could, and names nothing")})
    assert G.grade_case(case)["verdict"] == "wrong"
    # ... and a later one gets it right
    later = {"pr": "#0001", "merge": "fedcba9876543210"}
    value_eval.adopt({"cases": [case]}, report_right(case), {**STAMPS, "front": "2222222222"}, {case["id"]: later})
    assert len(case["found"]) == 2 and case["found"][0] == first
    assert case["found"][1]["answer"] == again and case["found"][1]["fixed_by"] == later
    # the finding's example is the NEWEST defect; every one is still there, oldest first
    assert G.specimen(case)["answer"] == again and [s["answer"] for s in G.specimens(case)] == [WRONG_ANSWER, again]


def test_an_adopted_record_names_the_build_its_OWN_answer_was_given_on():
    """A run is recorded in passes, hours apart, on different builds; the run's own stamp names only the last."""
    case, other = wrong_case(), copy.deepcopy(WALL)
    other["id"] = "another-case"
    stamps = {**STAMPS, "fronts": {case["id"]: {"front": "9999999999", "backend": "8888888888", "at": "2026-11-21T02:29Z"}}}
    report = {"verdicts": {case["id"]: "right", "another-case": "right"}, "answers": {case["id"]: copy.deepcopy(RIGHT_ANSWER), "another-case": copy.deepcopy(RIGHT_ANSWER)}}
    value_eval.adopt({"cases": [case, other]}, report, stamps, {case["id"]: FIX})
    assert case["recorded"] == {"on": "2026-11-21", "front": "9999999999", "model": "m"}
    assert other["recorded"] == {"on": "2026-11-22", "front": "abcdef0123", "model": "m"}       # not named: the run's own stamp
    assert case["found"][0]["recorded"] == {"on": "2026-11-21", "front": "1111111111"}          # the specimen keeps ITS build


def test_a_right_answer_over_a_right_record_makes_no_specimen_and_a_wrong_run_adopts_nothing():
    case = copy.deepcopy(WALL)
    value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, {})
    assert "found" not in case and case["recorded"]["front"] == "abcdef0123"
    stays = wrong_case()
    before = copy.deepcopy(stays)
    adopted, kept = value_eval.adopt({"cases": [stays]}, {"verdicts": {stays["id"]: "wrong"}, "answers": {stays["id"]: WRONG_ANSWER}}, STAMPS, {stays["id"]: FIX})
    assert (adopted, kept) == ([], [stays["id"]]) and stays == before


def _a_run(tmp_path, case, answer):
    """A fixture holding one case, and a run folder holding one answer to it."""
    fixture = tmp_path / "value_cases.json"
    fixture.write_text(json.dumps({"cases": [case], "thresholds": {"formula": None, "wall": None, "script": None}}), encoding="utf-8")
    run = tmp_path / "run"
    run.mkdir()
    (run / f"{case['id']}-0.body.json").write_text(json.dumps(answer), encoding="utf-8")
    (run / "run.json").write_text(json.dumps(STAMPS), encoding="utf-8")
    return fixture, run


def test_the_command_reads_what_fixed_each_defect_from_a_file_and_says_what_it_would_not_adopt(tmp_path, monkeypatch, capsys):
    case = wrong_case()
    fixture, run = _a_run(tmp_path, case, RIGHT_ANSWER)
    monkeypatch.setattr(value_eval, "FIXTURE", fixture)
    # without the file: recorded WRONG, right in this run, and NOT adopted; the command says so by name
    assert value_eval.main(["--answers", str(run), "--adopt"]) == 0
    out = capsys.readouterr().out
    assert "NOT ADOPTED" in out and case["id"] in out and "adopted 0 right answers" in out
    assert json.loads(fixture.read_text(encoding="utf-8"))["cases"][0] == case
    # with it: adopted, and the specimen names the fix
    named = tmp_path / "fixed_by.json"
    named.write_text(json.dumps({case["id"]: FIX}), encoding="utf-8")
    assert value_eval.main(["--answers", str(run), "--adopt", "--fixed-by", str(named)]) == 0
    out = capsys.readouterr().out
    assert "adopted 1 right answers" in out and "NOT ADOPTED" not in out
    now = json.loads(fixture.read_text(encoding="utf-8"))["cases"][0]
    assert now["found"][0]["fixed_by"] == FIX and now["found"][0]["answer"] == WRONG_ANSWER and "recorded_verdict" not in now


# ── the specimen a finding rests on ──

def test_the_specimen_is_the_record_while_WRONG_and_the_newest_found_after():
    never = copy.deepcopy(WALL)
    assert G.specimen(never) is None and G.specimens(never) == []
    case = wrong_case()
    assert G.specimen(case) == {"answer": WRONG_ANSWER, "defect": DEFECT, "recorded": {"on": "2026-11-21", "front": "1111111111"}, "fixed_by": None}
    value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, {case["id"]: FIX})
    assert G.specimen(case)["answer"] == WRONG_ANSWER and G.specimen(case)["fixed_by"] == FIX      # the same answer, now named as fixed
    assert [s["answer"] for s in G.specimens(case)] == [WRONG_ANSWER]
    # a returned specimen is a copy: changing it does not change the case
    G.specimen(case)["defect"] = "x"
    assert case["found"][0]["defect"] == DEFECT


# ── THE INVARIANT, over the fixture ──

def test_every_specimen_in_the_fixture_is_whole_and_names_what_fixed_it():
    for case in WITH_FOUND:
        assert isinstance(case["found"], list) and case["found"], case["id"]
        for kept in case["found"]:
            assert set(kept) - {ENGINE_FIXED} == KEYS, (case["id"], sorted(kept))
            if ENGINE_FIXED in kept:
                ef = kept[ENGINE_FIXED]
                assert set(ef) == {"by", "since_engine"} and str(ef["by"]).strip(), (case["id"], ef)
                assert isinstance(ef["since_engine"], int) and ef["since_engine"] > 0, (case["id"], ef)
            assert len(kept["defect"] or "") > 80 and (kept["recorded"] or {}).get("front"), case["id"]
            assert str(kept["fixed_by"].get("pr", "")).startswith("#") and len(str(kept["fixed_by"].get("merge", ""))) >= 10, case["id"]
        assert case.get("recorded_verdict") != "wrong" or "defect" in case       # a case wrong AGAIN still names its standing defect
    # a case is recorded WRONG, or carries what it once got wrong, or neither: every specimen is one of those two
    for case in CASES:
        assert len(G.specimens(case)) == len(case.get("found") or []) + (case.get("recorded_verdict") == "wrong"), case["id"]


# ── ⭐ e95 unit 1 — `engine_fixed`, the studio's conditions (DEEPVUE via the coordinator, 2026-11-22) ──

def test_engine_fixed_is_HAND_MARKED_only_adopt_never_writes_it():
    """Condition 1: like `fixed_by`, `engine_fixed` is written by hand, never by `--adopt`. Adopting a fixed defect
    appends exactly {answer, defect, recorded, fixed_by}, and a second adoption leaves a hand-marked one as it was."""
    case = wrong_case()
    value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, {case["id"]: FIX})
    assert [set(k) for k in case["found"]] == [KEYS]
    case["found"][0][ENGINE_FIXED] = {"by": "#0000 0123456789", "since_engine": 1}
    marked = copy.deepcopy(case["found"][0])
    again = copy.deepcopy(WRONG_ANSWER)
    case.update({"answer": again, "recorded_verdict": "wrong", "defect": DEFECT})
    value_eval.adopt({"cases": [case]}, report_right(case), STAMPS, {case["id"]: FIX})
    assert case["found"][0] == marked and set(case["found"][1]) == KEYS


def test_engine_fixed_is_never_claimed_AHEAD_of_the_engine_that_earns_it():
    """Condition 1: `since_engine` is not above the engine version the lane runs (`scriptEngineVersion.js`, read by
    `user_definitions.read_script_engine_version`, the one reader). ⚠️ ONE ALLOWANCE, NAMED: while the fixing train
    is not numbered yet (the version file carries its `NUMBER PENDING` lines, `train e<n>`), its own number `n` may be
    claimed; the day the coordinator numbers it, the version is `n` and the plain rule holds."""
    import re
    from api.services import user_definitions as ud
    engine = ud.read_script_engine_version()
    assert isinstance(engine, int) and engine > 0
    text = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "scriptEngineVersion.js").read_text(encoding="utf-8")
    pending = {int(n) for n in re.findall(r"NUMBER PENDING = \([^)]*\btrain e(\d+)\b", text)}
    marked = [(c["id"], k[ENGINE_FIXED]) for c in WITH_FOUND for k in c["found"] if ENGINE_FIXED in k]
    assert marked, "no specimen carries engine_fixed: this rail would read nothing"
    for cid, ef in marked:
        n = ef["since_engine"]
        assert n <= engine or (n in pending and n > engine), (cid, ef, "claimed ahead of the engine", engine, sorted(pending))


def test_an_engine_fixed_specimen_keeps_its_defect_and_its_fixed_by():
    """Condition 2: `engine_fixed` is ADDED beside what the specimen already says, never in place of it: #2433 fixed
    what the assistant writes, e95 fixes what the engine draws, and both stay true."""
    case = next(c for c in WITH_FOUND if c["id"] == "table-format-01")
    kept = next(k for k in case["found"] if ENGINE_FIXED in k)
    assert "NO VALUES" in kept["defect"] and kept["fixed_by"]["pr"] == "#2433"
    assert kept[ENGINE_FIXED] == {"by": "e95 unit 1 (#2483)", "since_engine": 95}


def test_THE_INVARIANT_each_specimen_is_WRONG_and_its_record_RIGHT_by_the_same_rule():
    for case in WITH_FOUND:
        if case["lane"] == "script":
            continue                                               # through the engine, below
        for kept in case["found"]:
            got = G.grade_case(case, kept["answer"])
            # ⛔ an engine fix is a statement about the ENGINE: only a script-lane specimen (graded through it) may carry one
            assert ENGINE_FIXED not in kept, (case["id"], "an engine fix on a lane the engine does not draw")
            assert got["verdict"] == "wrong", (case["id"], "a specimen the rule passes is no specimen", got["lines"])
        if case.get("recorded_verdict") != "wrong":
            got = G.grade_case(case)
            assert got["verdict"] == "right", (case["id"], "adopted as right and graded", got["verdict"], got["lines"])


def test_THE_INVARIANT_for_the_script_cases_through_the_engine():
    scripts = [c for c in WITH_FOUND if c["lane"] == "script"]
    if not scripts:
        return
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_grade
    for case in scripts:
        try:
            for kept in case["found"]:
                got = script_grade.grade_all([case], {case["id"]: kept["answer"]})[case["id"]]
                if ENGINE_FIXED in kept:
                    # ⭐ the engine fixed what made this answer wrong: through the engine it is RIGHT now, and an engine
                    # that blanks it again (a reverted fix) turns it back to WRONG, here
                    assert got["verdict"] == "right", (case["id"], "a specimen the engine fixed is wrong again",
                                                       kept[ENGINE_FIXED], got["lines"])
                    continue
                assert got["verdict"] == "wrong", (case["id"], "a specimen the rule passes is no specimen", got["lines"])
            if case.get("recorded_verdict") != "wrong":
                got = script_grade.grade_all([case])[case["id"]]
                assert got["verdict"] == "right", (case["id"], got["lines"])
        except LaneUnavailable as exc:
            pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


# -- a re-recording never costs a capability its only case (2026-11-22: the fresh k01 would have cost two) --

def _script_case(cid, pine, verdict=None):
    case = {"id": cid, "lane": "script", "words": "w", "answer": {"script": {"pine": pine}}, "recorded": {"front": "0000000000"}}
    if verdict:
        case.update(recorded_verdict=verdict, defect="it was wrong")
    return case


def _caps(source):                                                  # a stand-in detector: the words of the script
    return set(source.split())


def _run(answers):
    return {"verdicts": {cid: "right" for cid in answers}, "answers": {cid: {"script": {"pine": pine}} for cid, pine in answers.items()}}


def _adopt(cases, answers, listed=None, fixed_by=None):
    data = {"cases": cases}
    if listed is not None:
        data["capabilities_without_a_case"] = listed
    notes = {}
    adopted, kept = value_eval.adopt(data, _run(answers), STAMPS, fixed_by or {}, notes, capabilities_of=_caps)
    return data, adopted, kept, notes["held_for_coverage"]


def test_a_right_answer_that_would_cost_a_capability_its_only_case_is_not_adopted_and_is_named():
    data, adopted, kept, held = _adopt([_script_case("a", "plot loop tuple"), _script_case("b", "plot")], {"a": "plot", "b": "plot table"})
    assert held == {"a": ["loop", "tuple"]} and adopted == ["b"] and "a" in kept
    assert data["cases"][0]["answer"]["script"]["pine"] == "plot loop tuple"          # the old record stands, whole
    assert data["cases"][0]["recorded"] == {"front": "0000000000"}
    assert data["cases"][1]["answer"]["script"]["pine"] == "plot table"


def test_it_is_adopted_when_another_case_still_holds_the_capability():
    data, adopted, _kept, held = _adopt([_script_case("a", "plot loop"), _script_case("b", "plot loop")], {"a": "plot"})
    assert held == {} and adopted == ["a"] and data["cases"][0]["answer"]["script"]["pine"] == "plot"
    # ... and when the other case is the one that gains it in the same run
    data, adopted, _kept, held = _adopt([_script_case("a", "plot loop"), _script_case("b", "plot")], {"a": "plot", "b": "plot loop"})
    assert held == {} and adopted == ["a", "b"]
    # two re-recordings that would lose it between them: both keep their records
    data, adopted, _kept, held = _adopt([_script_case("a", "plot loop"), _script_case("b", "plot loop")], {"a": "plot", "b": "plot"})
    assert held == {"a": ["loop"], "b": ["loop"]} and adopted == []


def test_a_fixed_defect_is_adopted_whatever_its_old_script_used():
    data, adopted, _kept, held = _adopt([_script_case("a", "plot loop", "wrong")], {"a": "plot"}, fixed_by={"a": FIX})
    assert adopted == ["a"] and held == {} and data["cases"][0]["found"][0]["answer"]["script"]["pine"] == "plot loop"


def test_the_list_of_capabilities_without_a_case_goes_down_with_the_record_and_never_up():
    data, _a, _k, _h = _adopt([_script_case("a", "plot")], {"a": "plot table"}, listed=["loop", "table"])
    assert data["capabilities_without_a_case"] == ["loop"]                           # `table` has a case now
    data, _a, _k, held = _adopt([_script_case("a", "plot loop")], {"a": "plot"}, listed=["table"])
    assert held == {"a": ["loop"]} and data["capabilities_without_a_case"] == ["table"]     # nothing is ever added
    # a fixed defect whose old script was a capability's only case: adopted, and still nothing is added to the list
    data, adopted, _k, _h = _adopt([_script_case("a", "plot loop", "wrong")], {"a": "plot"}, listed=["table"], fixed_by={"a": FIX})
    assert adopted == ["a"] and data["capabilities_without_a_case"] == ["table"]


def test_the_command_names_each_answer_it_did_not_adopt_for_coverage():
    lines = value_eval.coverage_lines({"k01": ["history-expr", "tuple-destructure"], "a": ["loop"]})
    assert lines == ["NOT ADOPTED a: right again, but its recorded script is the only case of ['loop']; the old record stands",
                     "NOT ADOPTED k01: right again, but its recorded script is the only case of ['history-expr', 'tuple-destructure']; the old record stands"]
    assert value_eval.coverage_lines({}) == [] and value_eval.coverage_lines(None) == []
    # the command prints them, from what THIS adoption held (its code, never a comment)
    import ast
    main = next(n for n in ast.walk(ast.parse((ROOT / "tools" / "value_eval.py").read_text(encoding="utf-8"))) if isinstance(n, ast.FunctionDef) and n.name == "main")
    loops = [n for n in ast.walk(main) if isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and getattr(n.iter.func, "id", None) == "coverage_lines"]
    assert loops and any(isinstance(c, ast.Call) and getattr(c.func, "id", None) == "print" for n in loops for c in ast.walk(n))
    assert "held_for_coverage" in ast.dump(loops[0].iter)
    calls = [c for c in ast.walk(main) if isinstance(c, ast.Call) and getattr(c.func, "id", None) == "adopt"]
    assert calls and all(len(c.args) >= 5 for c in calls)                             # the notes are handed to adopt


def test_the_real_detector_is_the_one_an_adoption_reads_and_formula_cases_are_not_asked():
    from api.services import pine_capabilities
    src = next(c for c in DATA["cases"] if c["lane"] == "script")["answer"]["script"]["pine"]
    assert G.capabilities_of(src) == pine_capabilities.capabilities_of(src)
    assert value_eval.held_by([{"id": "f", "lane": "formula", "answer": {"script": {"pine": "x"}}}, {"id": "w", "lane": "wall", "answer": {}}], _caps) == {}
    held = value_eval.held_by(DATA["cases"], pine_capabilities.capabilities_of)
    assert not set(DATA["capabilities_without_a_case"]) & set(held)                 # the list and the record agree today


def test_an_adoption_handed_no_detector_asks_the_products_own():
    scripts = copy.deepcopy([c for c in DATA["cases"] if c["lane"] == "script"])
    only = value_eval.held_by(scripts, G.capabilities_of)
    recorded_right = {c["id"] for c in scripts if c.get("recorded_verdict") != "wrong"}
    cap, cid = next((cap, ids[0]) for cap, ids in sorted(only.items()) if len(ids) == 1 and ids[0] in recorded_right)
    plain = '//@version=5' + chr(10) + 'indicator("x")' + chr(10) + 'plot(close)' + chr(10)
    assert cap not in G.capabilities_of(plain)                                    # CONTROL: the plain script does not use it
    notes = {}
    adopted, kept = value_eval.adopt({"cases": scripts}, {"verdicts": {cid: "right"}, "answers": {cid: {"script": {"pine": plain}}}}, STAMPS, {}, notes)
    assert adopted == [] and cid in kept and cap in notes["held_for_coverage"][cid]


# -- a record a test rests on, line by line, stands when the door answers right again (2026-11-22: intraday-04) --

def test_a_right_answer_over_a_record_the_case_says_to_keep_is_not_adopted_and_is_named():
    kept = dict(_script_case("a", "plot day low"), keep_record="a test changes these lines")
    data, adopted, kept_ids, _held = _adopt([kept, _script_case("b", "plot")], {"a": "plot other lines", "b": "plot table"})
    assert adopted == ["b"] and "a" in kept_ids and data["cases"][0]["answer"]["script"]["pine"] == "plot day low"
    notes = {}
    value_eval.adopt({"cases": [dict(kept)]}, _run({"a": "plot other lines"}), STAMPS, {}, notes, capabilities_of=_caps)
    assert notes["kept_by_name"] == {"a": "a test changes these lines"}
    assert value_eval.kept_lines(notes["kept_by_name"]) == ["NOT ADOPTED a: right again, and its record stands by the case's own word: a test changes these lines"]
    assert value_eval.kept_lines({}) == [] and value_eval.kept_lines(None) == []
    # a wall or formula case may say it too
    wall = dict(copy.deepcopy(WALL), keep_record="why")
    adopted, kept_ids = value_eval.adopt({"cases": [wall]}, report_right(wall), STAMPS, {})
    assert adopted == [] and kept_ids == [wall["id"]]


def test_a_FIXED_DEFECT_on_such_a_case_is_adopted_all_the_same():
    wrong = dict(_script_case("a", "plot loop", "wrong"), keep_record="a test changes these lines")
    data, adopted, _kept, _held = _adopt([wrong], {"a": "plot"}, fixed_by={"a": FIX})
    assert adopted == ["a"] and data["cases"][0]["answer"]["script"]["pine"] == "plot" and data["cases"][0]["found"][0]["defect"] == "it was wrong"
    assert data["cases"][0]["keep_record"] == "a test changes these lines"          # the word stays on the case


def test_the_cases_that_say_keep_my_record_say_why_and_a_test_really_rests_on_each():
    named = {c["id"]: c["keep_record"] for c in CASES if c.get("keep_record")}
    assert set(named) == {"intraday-04"} and all(isinstance(why, str) and len(why) > 40 for why in named.values())
    # the reason names a test file that exists and reads that case
    for cid, why in named.items():
        path = ROOT / why.split(" ")[0]
        assert path.exists() and cid in path.read_text(encoding="utf-8"), (cid, why)
    # the command prints them, from what THIS adoption kept (its code, never a comment)
    import ast
    main = next(n for n in ast.walk(ast.parse((ROOT / "tools" / "value_eval.py").read_text(encoding="utf-8"))) if isinstance(n, ast.FunctionDef) and n.name == "main")
    loops = [n for n in ast.walk(main) if isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and getattr(n.iter.func, "id", None) == "kept_lines"
             and "kept_by_name" in ast.dump(n.iter)]
    assert loops and any(isinstance(c, ast.Call) and getattr(c.func, "id", None) == "print" for n in loops for c in ast.walk(n))
