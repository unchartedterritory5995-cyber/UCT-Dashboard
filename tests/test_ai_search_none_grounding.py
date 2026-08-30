"""A desk pack must never hand the model the word "None" (2026-08-29).

Measured on a live box while diagnosing a fast-lane score drop:

    Breadth (UCT): score None, phase , adv/dec None/None, 52wk NH/NL None/None

`_ctx_breadth` guarded with `if not b: return ""` — which asks "is the dict
EMPTY", when the invariant is "does it hold usable VALUES". A dict of Nones
sails straight through (lesson_a_guard_that_tests_the_adjacent_thing: None, not
zero).

This is worse than injecting nothing. Silence lets the model say it doesn't
have breadth; "score None" reads as a data feed the model should interpret, and
it fills the gap. In the exam that question scored c1 g2 o2 s1 with a safety
break — a fabricated answer our own prompt asked for.
"""
import pytest

import api.routers.ai_search as ai


def _stub_breadth(monkeypatch, payload):
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_breadth", lambda: payload)


def test_an_all_none_payload_grounds_nothing(monkeypatch):
    """Fails while the guard tests emptiness instead of usability."""
    _stub_breadth(monkeypatch, {"breadth_score": None, "market_phase": None,
                                "advancing": None, "declining": None,
                                "new_highs": None, "new_lows": None})
    assert ai._ctx_breadth() == ""


def test_no_desk_pack_ever_emits_the_literal_none(monkeypatch):
    """The rail that generalises it: whatever we do render, the word "None"
    must never reach the prompt."""
    _stub_breadth(monkeypatch, {"breadth_score": 55, "market_phase": None,
                                "advancing": None, "declining": None,
                                "new_highs": None, "new_lows": None})
    out = ai._ctx_breadth()
    assert "None" not in out, out


def test_partial_data_still_grounds_what_it_has(monkeypatch):
    """CONTROL — the fix must not become "all or nothing". A real breadth score
    with missing adv/dec is still worth handing over."""
    _stub_breadth(monkeypatch, {"breadth_score": 55, "market_phase": None,
                                "advancing": None, "declining": None,
                                "new_highs": None, "new_lows": None})
    out = ai._ctx_breadth()
    assert "55" in out, out


def test_full_data_renders_every_field(monkeypatch):
    """CONTROL — proves the skip logic did not quietly drop live fields."""
    _stub_breadth(monkeypatch, {"breadth_score": 55, "market_phase": "bull_trend",
                                "advancing": 3000, "declining": 1200,
                                "new_highs": 140, "new_lows": 20})
    out = ai._ctx_breadth()
    for token in ("55", "bull_trend", "3000", "1200", "140", "20"):
        assert token in out, (token, out)


def test_zero_is_a_value_not_a_gap(monkeypatch):
    """CONTROL — the whole lesson. Zero advancing issues is a REAL and
    dramatic reading; dropping it as falsy would hide the most extreme tape
    the desk can see."""
    _stub_breadth(monkeypatch, {"breadth_score": 0, "market_phase": "bear",
                                "advancing": 0, "declining": 4000,
                                "new_highs": 0, "new_lows": 900})
    out = ai._ctx_breadth()
    assert "0" in out and "4000" in out and "900" in out, out
    assert "None" not in out
