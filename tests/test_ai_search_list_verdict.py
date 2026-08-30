"""Grading a desk LIST, not just a named ticker (2026-08-29).

`S3-03` asks "Which of today's scanner candidates has the best setup, and why?"
and fails every run with GATE-MISS. Cause: the per-ticker packs (verdict,
patterns, quote) only run on symbols the member NAMED. A question about "today's
candidates" names none, so the desk hands over the candidate LIST and no read on
any of them — and the model picks one and justifies it from nothing.

This is the shape of question a trader actually asks a desk, so it is worth its
own pack rather than a gate widening.
"""
import pytest

import api.routers.ai_search as ai

_CANDS = {"candidates": {
    "pullback_ma": [{"ticker": "NVDA"}, {"ticker": "AMD"}],
    "remount": [{"ticker": "CRWD"}],
}}


def _stub(monkeypatch, cands=_CANDS, verdicts=None):
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_candidates", lambda: cands)
    verdicts = verdicts if verdicts is not None else {
        "NVDA": "NVDA verdict GO, regime bull_trend, setup VCP grade A",
        "AMD": "AMD verdict HOLD, regime bull_trend",
        "CRWD": "CRWD verdict SKIP, regime bull_trend",
    }
    monkeypatch.setattr(ai, "_ctx_verdict", lambda s: verdicts.get(s, ""))


def test_a_best_of_the_scan_question_grades_the_list(monkeypatch):
    """Fails while the desk hands over the candidate list with no read on any
    of its names."""
    _stub(monkeypatch)
    out = ai._ctx_list_verdict("Which of today's scanner candidates has the best setup, and why?", [])
    assert "NVDA" in out and "GO" in out, out
    assert "AMD" in out or "CRWD" in out, out


def test_a_named_ticker_is_left_to_the_per_ticker_packs(monkeypatch):
    """CONTROL — when the member names a symbol the existing machinery already
    grades it. Doing it twice would duplicate the grounding and waste the call."""
    _stub(monkeypatch)
    assert ai._ctx_list_verdict("is NVDA the best setup on the scan?", ["NVDA"]) == ""


def test_a_plain_scan_question_is_not_a_ranking_ask(monkeypatch):
    """CONTROL — "what's on the scanner" wants the LIST, not three graded
    verdicts. grade_ticker is not free; only a ranking ask should pay for it."""
    _stub(monkeypatch)
    assert ai._ctx_list_verdict("what is on the scanner today?", []) == ""


def test_a_ranking_ask_with_no_list_scope_does_not_fire(monkeypatch):
    """CONTROL — "which is best" about nothing in particular must not silently
    grade the scanner."""
    _stub(monkeypatch)
    assert ai._ctx_list_verdict("which is the best AI stock to own", []) == ""


def test_an_empty_scan_grades_nothing(monkeypatch):
    """CONTROL — no candidates, no invented names."""
    _stub(monkeypatch, cands={"candidates": {}})
    assert ai._ctx_list_verdict("which of today's candidates has the best setup?", []) == ""


def test_it_is_bounded_to_a_few_names(monkeypatch):
    """grade_ticker is a real computation per symbol. A 30-name scan must not
    fire 30 of them inside one answer."""
    big = {"candidates": {"pullback_ma": [{"ticker": f"S{i}"} for i in range(30)]}}
    calls = []
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_candidates", lambda: big)
    monkeypatch.setattr(ai, "_ctx_verdict",
                        lambda s: calls.append(s) or f"{s} verdict GO")
    ai._ctx_list_verdict("which of today's candidates has the best setup?", [])
    assert len(calls) <= 3, calls


def test_the_list_verdict_pack_is_wired_into_the_assembler():
    """lesson_built_tested_green_and_unreachable."""
    import io
    src = io.open(ai.__file__, encoding="utf-8").read()
    body = src.split("def _uct_context", 1)[1].split("\ndef ", 1)[0]
    assert "_ctx_list_verdict(" in body
