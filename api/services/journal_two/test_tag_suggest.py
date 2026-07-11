"""Deterministic AI-suggested tags (Journal 2.0 P6-4).

Pure heuristics — no LLM, no DB. no-stop → `no_stop`; a caller-supplied revenge
flag → `revenge` + `revenge-driven`; already-applied tags are never
re-suggested; tags outside the account taxonomy are dropped; a clean trade
yields empty lists.
"""
from __future__ import annotations

from api.services.journal_two.tag_suggest import (
    STANDARD_EMOTIONS,
    STANDARD_MISTAKES,
    suggest_for_trade,
)


def _trade(**over):
    """A clean, fully-stopped closed trade (real R, stop below entry)."""
    base = {
        "symbol": "NVDA",
        "entryPrice": 100.0,
        "originalStop": 95.0,
        "rMultiple": 1.5,
        "mistakeTags": [],
        "emotionTags": [],
    }
    base.update(over)
    return base


def test_no_stop_when_stop_equals_entry():
    out = suggest_for_trade(
        _trade(originalStop=100.0, rMultiple=None),
        revenge_flag=False,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out["mistakes"] == ["no_stop"]
    assert out["emotions"] == []
    assert out["reasons"]["no_stop"] == "No stop was logged on this trade."


def test_no_stop_when_r_multiple_is_none():
    # rMultiple None alone (even with a distinct stop value) → no_stop.
    out = suggest_for_trade(
        _trade(rMultiple=None),
        revenge_flag=False,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out["mistakes"] == ["no_stop"]


def test_revenge_flag_suggests_mistake_and_emotion():
    out = suggest_for_trade(
        _trade(),
        revenge_flag=True,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out["mistakes"] == ["revenge"]
    assert out["emotions"] == ["revenge-driven"]
    assert out["reasons"]["revenge"] == "Re-entered NVDA shortly after a loss on it."
    assert out["reasons"]["revenge-driven"] == "Re-entered NVDA shortly after a loss on it."


def test_already_applied_tag_is_not_re_suggested():
    out = suggest_for_trade(
        _trade(originalStop=100.0, rMultiple=None,
               mistakeTags=["no_stop", "revenge"],
               emotionTags=["revenge-driven"]),
        revenge_flag=True,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out["mistakes"] == []   # both no_stop + revenge already applied
    assert out["emotions"] == []   # revenge-driven already applied
    assert out["reasons"] == {}


def test_tag_not_in_taxonomy_is_dropped():
    # Taxonomy offers neither no_stop nor revenge → nothing survives.
    out = suggest_for_trade(
        _trade(originalStop=100.0, rMultiple=None),
        revenge_flag=True,
        available_mistakes=["overtrading", "FOMO"],
        available_emotions=["calm"],
    )
    assert out["mistakes"] == []
    assert out["emotions"] == []


def test_clean_trade_yields_empty():
    out = suggest_for_trade(
        _trade(),
        revenge_flag=False,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out == {"mistakes": [], "emotions": [], "reasons": {}}


def test_defensive_on_missing_fields():
    # An empty trade dict + no signals must not raise.
    out = suggest_for_trade({}, False, STANDARD_MISTAKES, STANDARD_EMOTIONS)
    assert out == {"mistakes": [], "emotions": [], "reasons": {}}


def test_both_heuristics_fire_together():
    out = suggest_for_trade(
        _trade(originalStop=100.0, rMultiple=None),
        revenge_flag=True,
        available_mistakes=STANDARD_MISTAKES,
        available_emotions=STANDARD_EMOTIONS,
    )
    assert out["mistakes"] == ["no_stop", "revenge"]
    assert out["emotions"] == ["revenge-driven"]
