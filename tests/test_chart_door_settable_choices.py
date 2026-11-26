"""A choice the member asks to PICK is a setting, and a one-word column alias is no note (2026-11-25).

Found by the Deepvue parity probe (pp23, live, admin measurement): "Plot a moving average where I can pick the type
from a list (SMA, EMA, WMA, HMA) and the length, and choose its colour" got two wrong things and no model call:

  * the door asked "How many bars should the average use?", so the type dropdown and length setting the member
    asked for were never built (Deepvue's agent built both);
  * the window said "'type' is in UCT's screener data, which a chart formula can't read": the plain word "type"
    matched the Screener's Type column (security_type), and was false.

Held here: the words that hand a choice to the member close the door's question for it, and only for it (a bare
average still asks); a one-word column alias is no note at the CHART door, while a column named whole still is,
and the Screener's own door (the default lexicon) is unchanged. No paid calls.
"""
from __future__ import annotations

import pytest

from api.services import definition_concierge as dc
from tests.test_p2_truth_server import conv  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
PP23 = ("Plot a moving average where I can pick the type from a list (SMA, EMA, WMA, HMA) and the length, "
        "and choose its colour")


def opens(conv, words):
    return conv.open_questions(conv.understand_turn(words, CHART))


def notes(conv, words, lexicon="chart"):
    lex = conv.CHART_LEXICON if lexicon == "chart" else None
    return [(n["phrase"], n["name"]) for n in dc.plan(words, lexicon=lex).get("unavailable") or []]


# ------------------------------------------------------------------ a choice to pick is a setting

@pytest.mark.parametrize("words", [
    PP23,
    "Add a moving average and let me choose the length and type in the settings",
    "Plot an EMA with an adjustable length",
    "an EMA where I can change the period",
    "Add a moving average with a dropdown for the type and a length input",
])
def test_a_choice_the_member_asks_to_pick_is_no_door_question(conv, words):
    assert not {"average_kind", "average_length"} & set(opens(conv, words)), words


def test_the_member_who_picks_only_the_type_is_still_asked_the_length(conv):
    # handing over ONE choice settles that choice and nothing else
    got = opens(conv, "Add a moving average and let me pick the type from a list")
    assert "average_kind" not in got and "average_length" in got, got


def test_the_member_who_picks_only_the_length_is_still_asked_the_kind(conv):
    got = opens(conv, "Add a moving average where I can adjust the length")
    assert "average_length" not in got and "average_kind" in got, got


@pytest.mark.parametrize("words,qid", [
    ("add a moving average", "average_kind"),
    ("Add an EMA", "average_length"),
    ("add a simple moving average and color it blue", "average_length"),
    ("Add an EMA and let me choose its colour", "average_length"),       # choosing a COLOUR is no length
])
def test_a_request_that_hands_over_nothing_is_still_asked(conv, words, qid):
    assert qid in opens(conv, words), words


# ------------------------------------------------------------------ a one-word column alias is no note on a chart

@pytest.mark.parametrize("words", [
    PP23,
    "Let me pick the moving average type in the settings",
    "Mark the bars where this setup triggers: close above the 20 day high",
    "Show the reversal bars where the low is below the prior low and the close is above the prior close",
    "Mark bars where the close is unchanged from the prior close",
    "Mark a doji when the open and close are within 0.1 percent",
    "Plot the 50 day average for the sector ETF XLK",
    "Mark days with heavy churn: volume above twice average with a range under 1 percent",
])
def test_a_one_word_column_alias_is_no_note_at_the_chart_door(conv, words):
    assert notes(conv, words) == [], words


def test_a_column_named_whole_is_still_noted_at_the_chart_door(conv):
    got = notes(conv, "Plot the enterprise value as a line")
    assert ("enterprise value", "enterprise_value") in [(p.lower(), n) for p, n in got], got


def test_the_screener_door_still_notes_the_one_word_alias(conv):
    # the default lexicon (the Screener's door) asked for nothing: unchanged
    assert ("type", "security_type") in notes(conv, "show me stocks where the type is ETF", lexicon="default")


@pytest.mark.parametrize("phrase,plain", [("type", True), ("doji", True), ("enterprise value", False),
                                          ("iv_rank", False), ("rs_rating_3m", False), ("", False)])
def test_one_plain_word(phrase, plain):
    assert dc._one_plain_word(phrase) is plain
