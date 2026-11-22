"""scripts/study/wave_plan.py and integrate_wave.py: the overbuild wave tools (docs/study/OVERBUILD_PLAN.md)."""
from __future__ import annotations

import json

from scripts.study import courses_lib as cl
from scripts.study import integrate_wave as iw
from scripts.study import wave_plan as wp
from tests.test_study_courses import _unit


def _synthetic_lesson(tmp_path, monkeypatch, n=80, risky=20):
    """A lesson of n live questions; the first `risky` cite one fact only (+3) and are numeric (+2), so they score 5."""
    d = tmp_path / "courses" / "F1"
    d.mkdir(parents=True)
    unit = _unit()
    qs = []
    for i in range(n):
        hot = i < risky
        qs.append({"key": f"q{i + 1:02d}", "skill": "basics.spread", "rung": 1 + i % 9, "format": "numeric" if hot else "mcq",
                   "facts": ["f1"] if hot else ["f1", "f2"], "answer": 1 if hot else "a", "why": "w", "lesson_line": "l"})
    unit.update(unit="F1.98", track="F1", questions=qs, verify={q["key"]: {"status": "pass"} for q in qs}, conflicts=[])
    (d / "F1.98.json").write_text(json.dumps(unit), encoding="utf-8")
    monkeypatch.setattr(cl, "COURSES_DIR", tmp_path / "courses")


def test_the_split_plan_routes_risky_questions_to_one_full_chunk_and_splits_the_rest(tmp_path, monkeypatch):
    _synthetic_lesson(tmp_path, monkeypatch)
    chunks = wp.plan(["F1.98"])
    full = [c for c in chunks if c["route"] == "full"]
    light = [c for c in chunks if c["route"] == "light"]
    assert len(full) == 1 and len(full[0]["keys"]) == 20
    assert sum(len(c["keys"]) for c in light) == 60 and all(len(c["keys"]) <= 36 for c in light)
    keys = [k for c in chunks for k in c["keys"]]
    assert len(keys) == len(set(keys)) == 80                                     # every live question exactly once


def test_an_already_upgraded_question_is_not_planned_again():
    doc = cl.load_unit(cl.COURSES_DIR / "SET" / "SET.07.json")
    planned = {k for c in wp.plan(["SET.07"]) for k in c["keys"]}
    assert not planned & {q["key"] for q in doc["questions"] if q.get("simple")}


def test_risk_score_follows_the_rubric():
    doc = {"conflicts": ["q02 rests on D-029"], "verify": {"q03": {"fixed": True}}}
    assert wp.risk_score(doc, {"key": "q01", "facts": ["f1", "f2"], "format": "mcq", "answer": "x"}) == 0
    assert wp.risk_score(doc, {"key": "q01", "facts": ["f1"], "format": "mcq", "answer": "x"}) == 3
    assert wp.risk_score(doc, {"key": "q02", "facts": ["f1", "f2"], "format": "mcq", "answer": "x"}) == 2
    assert wp.risk_score(doc, {"key": "q03", "facts": ["h1"], "format": "numeric", "answer": 1}) == 8   # one fact +3, house +2, computed +2, fixed +1


def test_integrate_layers_the_chunk_files_applies_cuts_last_and_reports_what_is_missing(tmp_path, monkeypatch):
    courses = tmp_path / "courses" / "F1"
    courses.mkdir(parents=True)
    unit = _unit()
    unit["unit"] = "F1.99"
    unit["track"] = "F1"
    (courses / "F1.99.json").write_text(json.dumps(unit), encoding="utf-8")
    monkeypatch.setattr(cl, "COURSES_DIR", tmp_path / "courses")
    wave = tmp_path / "wave"
    (wave / "F1.99-full").mkdir(parents=True)
    (wave / "F1.99-lighta").mkdir()          # a chunk that produced nothing
    simple = "The bid is the most a buyer will pay right now."
    (wave / "F1.99-full" / "upgraded.json").write_text(json.dumps({"questions": {
        "q01": {"simple": simple, "tier": "core"}, "q02": {"simple": "The bid is what a buyer will pay now."}}}), encoding="utf-8")
    (wave / "F1.99-full" / "final.json").write_text(json.dumps({"questions": {"q01": {"tier": "extended"}}, "cut": ["q02"]}), encoding="utf-8")
    (wave / "F1.99-full" / "check_final.json").write_text(json.dumps({"questions": {"q01": {"status": "pass", "notes": "ok"}}}), encoding="utf-8")
    doc, rep = iw.integrate(wave, "F1.99", "waveT")
    q1 = next(q for q in doc["questions"] if q["key"] == "q01")
    assert q1["tier"] == "extended" and q1["simple"] == simple and doc["verify"]["q01"]["by"] == "checker"
    assert doc["verify"]["q02"]["status"] == "cut"                                   # the cut beats the upgrade
    assert rep["problems"] == [] and any("lighta: no upgraded.json" in s for s in rep["skipped"])
    # a dry run writes nothing
    assert json.loads((courses / "F1.99.json").read_text(encoding="utf-8")) == unit


def test_the_balanced_plan_makes_even_chunks_riskiest_first_and_routes_by_risk_share(tmp_path, monkeypatch):
    _synthetic_lesson(tmp_path, monkeypatch)
    chunks = wp.plan_balanced(["F1.98"])
    assert [len(c["keys"]) for c in chunks] == [27, 27, 26]                          # 80 questions, even, none over 36
    keys = [k for c in chunks for k in c["keys"]]
    assert len(keys) == len(set(keys)) == 80
    assert chunks[0]["route"] == "full" and set(chunks[0]["keys"]) == {f"q{i:02d}" for i in range(1, 21)} | set(chunks[0]["keys"])
    assert all(f"q{i:02d}" in chunks[0]["keys"] for i in range(1, 21))              # the 20 risky ones all land in the first chunk
    assert [c["route"] for c in chunks] == ["full", "light", "light"]
