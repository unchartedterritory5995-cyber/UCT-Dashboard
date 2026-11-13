"""The library audit: its counters on small fixtures, and the live library's floor."""
from __future__ import annotations

from scripts.study import library_audit as la


def _unit(questions, **extra):
    return {"unit": "T.09", "title": "t", "questions": questions, **extra}


def _q(i, fmt="mcq", answer="a long correct answer here", wrong=("b", "c", "d"), **kw):
    d = {"key": f"q{i:02d}", "format": fmt, "rung": 1 + i % 9, "q": f"Question number {i} about thing {i}?", "answer": answer}
    if fmt in ("mcq", "scenario"):
        d["choices"] = [answer, *wrong]
    return {**d, **kw}


def test_a_unit_where_the_right_choice_is_always_longest_is_flagged():
    u = _unit([_q(i) for i in range(1, 25)])
    flags = la.audit_unit(u)["flags"]
    assert any("longest one" in f for f in flags)


def test_a_unit_with_even_choice_lengths_is_not_flagged_for_it():
    u = _unit([_q(i, answer="alpha one", wrong=("bravo two", "delta six", "gamma four")) for i in range(1, 25)])
    assert not any("longest one" in f for f in la.audit_unit(u)["flags"])


def test_all_true_true_false_is_flagged_and_balanced_is_not():
    skew = _unit([_q(i, fmt="tf", answer="True") for i in range(1, 13)])
    ok = _unit([_q(i, fmt="tf", answer="True" if i % 2 else "False") for i in range(1, 13)])
    assert any("true/false answers are" in f for f in la.audit_unit(skew)["flags"])
    assert not any("true/false answers are" in f for f in la.audit_unit(ok)["flags"])


def test_the_audit_sees_the_order_a_member_sees_not_the_file_order():
    u = _unit([_q(i, answer="alpha one", wrong=("bravo two", "delta six", "gamma four")) for i in range(1, 41)])
    live = la.live_questions(u)
    first = sum(1 for q in live if q["choices"][0] == q["answer"])
    assert first <= 14           # written answer-first, shown dealt across four slots (about ten of forty)


def test_a_cut_question_is_not_live():
    u = _unit([_q(1), _q(2)], verify={"q01": {"status": "pass"}, "q02": {"status": "cut"}})
    assert [q["key"] for q in la.live_questions(u)] == ["q01"]


def test_the_live_library_keeps_its_floors():
    rep = la.build()
    total = sum(rep["formats"].values())
    assert total > 4000
    slots = rep["answer_slots"]
    four = sum(v for k, v in slots.items() if k < 4)
    assert max(slots.get(k, 0) for k in range(4)) / four < 0.40       # no slot dominates the whole library
    for u in rep["units"]:
        assert not any(f.startswith("right answer sits") for f in u["flags"]), u["unit"]
