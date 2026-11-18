"""CLARIFY FIRST: the questions the door asks itself.

Owner direction, 2026-11-18: "always clarify". When a choice that changes the MATHS is not settled
by the member's words, ask ONE short question with the options before building; never guess.

The questions are data (`api/data/clarify_questions.json`). The door asks the first one a request
leaves open, with no model call, so it is the same question every time and costs nothing. The
member's answer is read as the words they first wrote plus the answer, so the next open question
is asked, or the build goes ahead with everything they said.

Held here, for EVERY question in the registry (so a later change cannot silently stop one):
  * a request that leaves it open is asked it, and nothing is built or assumed;
  * every choice it offers is a phrase the door reads back as that choice (it SETTLES the question);
  * a request that already settles it is not asked.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731

#: question id -> (requests that leave it open AND are asked it first, requests that settle it)
CASES = {
    "average_kind": (
        ["add a 50 day moving average", "Plot the Moving Average", "add a 50 MA", "add the 200 dma", "add a moving average"],
        ["add a 50 day EMA", "50 day simple moving average", "Add the Kaufman Adaptive Moving Average", "Add RSI 14"]),
    "average_length": (
        ["Add an EMA", "add a simple moving average", "Add the Hull Moving Average", "show the exponential moving average"],
        ["Add a 50 day EMA", "20 and 50 day simple moving averages", "Add the McGinley Dynamic", "Add RSI 14",
         "a ribbon of EMAs", "show two simple moving averages"]),          # several averages: not this question's to ask
    "cross_meaning": (
        ["alert me when price crosses above the 50 day EMA", "mark where price crossed the 200 day SMA",
         "show price crossing below VWAP"],
        ["when price closes above the 50 day EMA", "when price trades through the 50 day EMA",
         "EMA 9 crosses above EMA 21", "price crosses above the 50 day EMA on a closing basis",
         "mark where the high crosses the 20 day SMA"]),
    # letters that could mean two indicators: asked which (tests/test_ambiguous_acronyms.py has the rest)
    "acronym_dmi": (
        ["Add DMI", "add the dmi in a lower pane", "show me Dmi"],
        ["Add the Directional Movement Index", "Add the Dynamic Momentum Index", "Add ADX", "add a 14 day RSI",
         "DMI, the Directional Movement Index"]),
    "acronym_adl": (
        ["Add ADL", "plot the adl"],
        ["Add the Accumulation Distribution Line", "add obv", "a paddle shaped line"]),
    "acronym_ad": (
        ["Add AD", "show AD in a lower pane"],
        ["Add the Accumulation Distribution Line", "an ad for my chart", "add ADX", "Add ADL"]),      # capitals only; ADL is its own
    # slice F: what relative strength is measured against, and how far back a breakout looks
    "benchmark": (
        ["Show relative strength", "Plot the RS line", "show NVDA's relative strength", "mark when it outperforms the market",
         "show its strength versus the market"],
        ["Show relative strength versus SPY", "relative strength vs QQQ", "price relative to XLK",
         "relative strength vs its sector",                      # a comparison the choices cannot answer: the assistant's
         "Add the Relative Strength Index", "add a 14 day RSI", "relative volume"]),
    # the slow Stochastic (what members write) and the fast one (TradingView's default) are different lines
    "stochastic_kind": (
        ["Add the Stochastic", "Add the Stochastic Oscillator", "add stochastics", "show a stochastic in a lower pane"],
        ["Add a slow stochastic", "add the fast stochastic", "Add the full stochastic", "Add the Stochastic Oscillator 14 3 3",
         "stochastic 14, 3, 3",                                      # numbers settle it
         "Add the Stochastic RSI", "Add the Stochastic Momentum Index", "show the stochastic of the RSI",   # other things
         "Add RSI 14"]),
    "breakout_window": (
        ["Mark breakouts", "mark new highs", "Mark breakouts on high volume", "flag new lows", "show when it breaks out"],
        ["Mark 20 day breakouts", "mark new 52-week highs", "new all-time highs", "flag when it breaks out of its base",
         "breakout from a squeeze", "mark when price breaks out above the 50 day EMA", "opening range breakout",
         "Add a 50 day EMA"]),
}


def understood(conv, words):
    return conv.understand_turn(words, CHART)


# ── the registry itself ──────────────────────────────────────────────────────

def test_the_registry_is_data_and_every_question_fits_the_contract(conv):
    registry = conv.clarify_registry()
    assert list(registry) == ["average_kind", "average_length", "cross_meaning",
                              "acronym_dmi", "acronym_adl", "acronym_ad",
                              "benchmark", "breakout_window", "stochastic_kind"]     # the order asked
    assert set(registry) == set(CASES), "a question with no cases here, or cases with no question"
    limits = json.loads(conv._raw_schema_text())["x-uct-limits"]
    for qid, q in registry.items():
        asked = conv.clarify_question(qid)
        assert asked == {"id": qid, "text": q["text"], "choices": q["choices"]}
        assert len(asked["text"]) <= limits["maxTextLength"] and asked["text"].endswith("?")
        assert 2 <= len(asked["choices"]) <= 6 and len(set(asked["choices"])) == len(asked["choices"])
        assert all(0 < len(c) <= 80 for c in asked["choices"])
        assert q["open_when"]                                                  # said in words, for a reader
        # the question, as the door sends it, passes the door
        sent = {"contract": conv.PATCH_CONTRACT, "baseRevision": 0, "ops": [], "disposition": "clarify", "questions": [asked]}
        assert conv.check_envelope(sent, 0, empty_view(0))
    assert conv.AVERAGE_QUESTION == conv.clarify_question("average_kind")


# ── every question: asked when open ──────────────────────────────────────────

@pytest.mark.parametrize("qid, words", [(q, w) for q, (leave_open, _s) in CASES.items() for w in leave_open])
def test_a_request_that_leaves_it_open_is_asked_and_nothing_is_built(conv, clean_env, model, qid, words):
    client = model([])                                                          # any model call would fail the turn
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "clarify" and r["turn"] == "question", r
    assert r["asked"] == qid and r["asked_by"] == "door"
    assert client.calls == [] and r["attempts"] == 0 and r["cost_usd"] == 0.0
    assert r["envelope"]["questions"] == [conv.clarify_question(qid)]           # ONE question
    assert r["envelope"]["ops"] == [] and "assumptions" not in r["envelope"]


@pytest.mark.parametrize("qid, words", [(q, w) for q, (_o, settled) in CASES.items() for w in settled])
def test_a_request_that_settles_it_is_not_asked_it(conv, qid, words):
    assert qid not in conv.open_questions(understood(conv, words)), words


# ── every question: every choice settles it ──────────────────────────────────

@pytest.mark.parametrize("qid", sorted(CASES))
def test_every_choice_reads_back_as_an_answer(conv, qid):
    """The member taps a choice and it arrives as their next message. With the words they first
    wrote, it must settle the question, whichever choice it was and whichever request asked."""
    question = conv.clarify_question(qid)
    for words in CASES[qid][0]:
        said = [{"role": "member", "text": words}, {"role": "assistant", "text": question["text"]}]
        for choice in question["choices"]:
            combined = conv.with_pending_answers(choice, said, CHART)
            assert combined == f"{words.rstrip('.')}. {choice}", (words, choice, combined)
            assert qid not in conv.open_questions(understood(conv, combined)), (words, choice)


def test_a_typed_answer_settles_it_too(conv):
    for qid, words, typed in (("average_kind", "add a 50 day moving average", "ema"),
                              ("average_kind", "add a 50 day moving average", "simple please"),
                              ("average_kind", "add a 50 day moving average", "exponential"),
                              ("average_kind", "add a 50 day moving average", "the hull one"),
                              ("average_length", "Add an EMA", "21"),
                              ("average_length", "Add an EMA", "make it 8 bars"),
                              ("cross_meaning", "alert me when price crosses above the 50 day EMA", "on the close"),
                              ("benchmark", "Show relative strength", "spy"),
                              ("benchmark", "Show relative strength", "the nasdaq"),
                              ("benchmark", "Show relative strength", "against XLK please"),     # any listed symbol
                              ("stochastic_kind", "Add the Stochastic", "slow"),
                              ("stochastic_kind", "Add the Stochastic Oscillator", "the fast one"),
                              ("stochastic_kind", "Add the Stochastic", "14 3 3"),
                              ("breakout_window", "Mark breakouts", "30"),
                              ("breakout_window", "Mark breakouts", "over 100 bars")):
        said = [{"role": "member", "text": words}, {"role": "assistant", "text": conv.clarify_question(qid)["text"]}]
        combined = conv.with_pending_answers(typed, said, CHART)
        assert typed in combined and combined != typed, (qid, typed)
        assert qid not in conv.open_questions(understood(conv, combined))
    # the longest word wins: "volume weighted" is not "weighted"
    said = [{"role": "member", "text": "add a 50 day moving average"}, {"role": "assistant", "text": "Which kind of moving average?"}]
    assert conv.with_pending_answers("volume weighted", said, CHART).endswith("(Volume-weighted (VWMA))")
    assert conv.with_pending_answers("weighted", said, CHART).endswith("(Weighted (WMA))")
    assert conv.with_pending_answers("Hull (HMA)", said, CHART).endswith(". Hull (HMA)")             # a tapped choice is not doubled
    # a library average as the answer settles the kind AND brings its own numbers: no length question after it
    said = [{"role": "member", "text": "add a moving average"}, {"role": "assistant", "text": "Which kind of moving average?"}]
    assert conv.open_questions(understood(conv, conv.with_pending_answers("Kaufman adaptive (KAMA)", said, CHART))) == []


# ── one at a time, and the whole conversation ────────────────────────────────

def test_two_open_questions_are_asked_one_at_a_time_and_then_it_builds(conv, clean_env, model):
    """"Add a moving average" leaves the kind and the length open. The door asks the kind; the
    answer leaves the length; the door asks that; the second answer leaves nothing, and the
    assistant is called ONCE, with everything the member said."""
    client = model([])
    said = []
    r = conv.converse("Add a moving average", user_id="u1", view=empty_view(0), chart=CHART, snippets=said)
    assert r["asked"] == "average_kind" and len(r["envelope"]["questions"]) == 1
    said += [{"role": "member", "text": "Add a moving average"}, {"role": "assistant", "text": r["envelope"]["questions"][0]["text"]}]

    r = conv.converse("Exponential (EMA)", user_id="u1", view=empty_view(0), chart=CHART, snippets=said)
    assert r["disposition"] == "clarify" and r["asked"] == "average_length" and client.calls == []
    said += [{"role": "member", "text": "Exponential (EMA)"}, {"role": "assistant", "text": r["envelope"]["questions"][0]["text"]}]

    patch = env(0, [{"op": "create", "name": "50 EMA", "placement": "price",
                     "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(50))}]}])
    client = model([emits(patch)])
    r = conv.converse("50", user_id="u1", view=empty_view(0), chart=CHART, snippets=said)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "Add a moving average. Exponential (EMA). 50" in sent               # everything they said, in order


def test_a_message_that_does_not_answer_is_a_new_request_and_nothing_is_asked_twice(conv, clean_env, model):
    said = [{"role": "member", "text": "Add a moving average"}, {"role": "assistant", "text": "Which kind of moving average?"}]
    assert conv.with_pending_answers("never mind, add RSI 14", said, CHART) == "never mind, add RSI 14"
    assert conv.with_pending_answers("make it blue", said, CHART) == "make it blue"
    client = model([emits(env(0, [{"op": "create", "name": "RSI", "placement": "pane",
                                   "outputs": [{"key": "rsi", "tree": call("rsi", S("close"), num(14))}]}]))])
    r = conv.converse("never mind, add RSI 14", user_id="u1", view=empty_view(0), chart=CHART, snippets=said)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1     # built, not asked again


def test_when_there_is_no_pending_question_the_message_stands_alone(conv):
    assert conv.with_pending_answers("50", [], CHART) == "50"
    talk = [{"role": "member", "text": "Add an EMA"}, {"role": "assistant", "text": "Here is an idea."}]
    assert conv.with_pending_answers("50", talk, CHART) == "50"                  # the last line was no registry question
    only = [{"role": "assistant", "text": "How many bars should the average use?"}]
    assert conv.with_pending_answers("50", only, CHART) == "50"                  # no request before the question
    long = [{"role": "member", "text": "Add an EMA " + "x" * conv.MAX_MESSAGE_CHARS},
            {"role": "assistant", "text": "How many bars should the average use?"}]
    assert conv.with_pending_answers("50", long, CHART) == "50"                  # never over what one turn may carry


# ── where the door does NOT ask ──────────────────────────────────────────────

def test_a_question_from_the_member_is_answered_not_met_with_a_question(conv, clean_env, model):
    client = model([emits(env(0, [], disposition="answer", reply="It weights recent bars more."))])
    r = conv.converse("What does an EMA do?", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1
    assert conv.door_question(understood(conv, "What does an EMA do?"), empty_view(0)) is None


def test_beside_an_indicator_on_the_chart_the_door_does_not_ask(conv, clean_env, model):
    on_chart = view(1, [out("ma", call("ema", S("close"), num(20)), type_="value")], name="20 EMA")
    assert conv.door_question(understood(conv, "add an EMA beside it"), on_chart) is None
    assert conv.door_question(understood(conv, "add an EMA beside it"), empty_view(0)) == "average_length"


def test_a_convention_the_product_holds_is_never_a_question(conv):
    for words in ("Add RSI", "Add MACD", "Add Bollinger Bands", "Add ATR", "Add the McGinley Dynamic", "Add the Ultimate Oscillator",
                  "Add the Stochastic RSI", "Highlight Mondays"):
        assert conv.open_questions(understood(conv, words)) == [], words
