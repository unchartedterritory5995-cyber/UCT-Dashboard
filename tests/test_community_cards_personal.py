"""Task 8: `build_card` refuses to publish a personal AI answer as a community card.

The `ai` branch signature is `build_card(kind, ref, *, user_id, load_trade)` (NOT the
single-dict signature the brief's illustrative snippet used). `load_trade` is a stub
here because the `ai` path never calls it.
"""
import pytest

from api.services import community_cards as C


def _unused_load_trade(user_id, trade_id):
    raise AssertionError("load_trade should never be called on the 'ai' card path")


def test_ai_card_rejects_personal():
    # Matches this module's existing refusal convention: every other guard clause
    # in build_card (bad ticker, off-origin url, missing q/a, unknown kind, ...)
    # raises ValueError, which the router turns into an HTTP 400. The personal
    # guard must never publish personal position/P&L content, so it follows suit.
    with pytest.raises(ValueError):
        C.build_card(
            "ai",
            {"q": "am i overexposed", "a": "Your NVDA entry $100...", "personal": True},
            user_id="u1", load_trade=_unused_load_trade,
        )


def test_ai_card_builds_normally_when_not_personal():
    # Companion assertion: a non-personal ai card (flag absent) is unaffected.
    card = C.build_card(
        "ai",
        {"q": "am i overexposed", "a": "Diversify across sectors."},
        user_id="u1", load_trade=_unused_load_trade,
    )
    assert card["kind"] == "ai"
    assert card["q"] == "am i overexposed"
    assert card["a"] == "Diversify across sectors."


def test_ai_card_rejects_personal_even_when_falsy_missing_qa():
    # personal=True should refuse before the q/a presence check even runs, so a
    # crafted request can't dodge the guard by omitting other fields.
    with pytest.raises(ValueError):
        C.build_card(
            "ai",
            {"personal": True},
            user_id="u1", load_trade=_unused_load_trade,
        )
