"""scripts/study/course_dups.py: near-duplicate questions ACROSS course units (the importer only compares inside one skill).

Only checker-passed questions count; two questions inside one unit are the checker's job; two vocabulary questions
about different words are different questions however alike they read.
"""
from __future__ import annotations

from scripts.study import course_dups
from scripts.study import courses_lib as cl


def _unit(uid, questions, verify):
    return {"unit": uid, "questions": questions, "verify": verify}


def _q(key, text, term=None, choices=("Market", "Limit", "Stop", "Stop-limit")):
    q = {"key": key, "q": text, "choices": list(choices)}
    if term:
        q["term"] = term
    return q


PASS = {"status": "pass"}


def _patch(monkeypatch, docs):
    monkeypatch.setattr(cl, "unit_files", lambda: list(docs))
    monkeypatch.setattr(cl, "load_unit", lambda p: docs[p])


def test_flags_the_same_question_in_two_units(monkeypatch):
    text = "You want to buy only if the stock trades above 50.00. Which order type does that?"
    _patch(monkeypatch, {
        "a": _unit("F10.01", [_q("q1", text)], {"q1": PASS}),
        "b": _unit("F10.02", [_q("q4", text)], {"q4": PASS}),
    })
    found = course_dups.pairs(0.8)
    assert len(found) == 1
    j, x, y, _, _ = found[0]
    assert j >= 0.99 and {x, y} == {"F10.01#q1", "F10.02#q4"}


def test_ignores_unchecked_same_unit_and_different_word_pairs(monkeypatch):
    text = "You want to buy only if the stock trades above 50.00. Which order type does that?"
    word = "Which word means the price a buyer will pay right now?"
    _patch(monkeypatch, {
        "a": _unit("F10.01", [_q("q1", text), _q("q2", text)], {"q1": PASS, "q2": PASS}),      # same unit: skipped
        "b": _unit("F10.02", [_q("q4", text)], {"q4": {"status": "fix"}}),                     # not passed: skipped
        "c": _unit("V.06", [_q("q1", word, term="bid")], {"q1": PASS}),
        "d": _unit("V.07", [_q("q1", word, term="ask")], {"q1": PASS}),                        # another word: skipped
    })
    assert course_dups.pairs(0.8) == []


def test_main_reports_and_always_exits_zero(monkeypatch, capsys):
    _patch(monkeypatch, {})
    assert course_dups.main(["--threshold", "0.7"]) == 0
    assert "0 pair(s) at or above 0.7" in capsys.readouterr().out
