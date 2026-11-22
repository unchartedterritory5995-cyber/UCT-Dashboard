"""ON A CHART BELOW A DAY A LENGTH IN DAYS IS DAYS: built on daily bars, or the member is ASKED, by name, with what can be drawn.

Found by the value cases' 5 minute chart, 2026-11-22. Asked on a 5 minute chart for "a line at today's low so far
plus 60 percent of the 14 day ATR", the assistant built the ATR of fourteen 5 MINUTE bars and said so in a note. By
value it was not what was asked on any of 3,120 bars. A member reads the chart, not the note.

The ruling: right by value, or told plainly why with the nearest thing that can be built. So:
  * the DOOR works out what N bars of the chart really span and hands it over (`uct_language_notes.day_lengths`:
    "50 five-minute bars, about 4 hours"). The assistant never does that arithmetic;
  * the instructions say a length in days below a day is days: when every part of the indicator is a daily line it is
    built on daily bars (a calculation timeframe of a day); when it is not (each bar is compared with the daily
    measure, today's own values are added to it, or another symbol is read) the assistant asks ONE question that says
    why and offers what CAN be drawn, each choice named for what it draws in time;
  * the door refuses a change that takes the member's number of days as that many BARS, so the model gets its repair;
  * and it holds the question's wording: a choice that offers the bars version must carry the door's own span and may
    never call it by its number of days.

MEASURED before it shipped, with the door's own function, over the 200 answers recorded in the live rounds AS IF asked
on a 5 minute chart: 61 requests give a length in days that their answer takes as a window of bars, with no false
trigger among them; 31 are lines only and can be built on daily bars; 30 cannot and end at the question.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
FIVE = {"sym": "NVDA", "tf": "5"}
DAILY = {"sym": "NVDA", "tf": "D"}
WORDS = "Plot a line at today's low so far plus 60 percent of the 14 day ATR, and put a dot on each bar that closes above that line"
MARKER_WORDS = "Show when the close crosses above its 50 day simple moving average"
HIGH, LOW, CLOSE = ({"type": "series", "name": n} for n in ("high", "low", "close"))


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def created(*trees, calc=None):
    ops = [{"op": "create", "name": "x", "placement": "price", "outputs": [{"key": f"o{k}", "tree": t} for k, t in enumerate(trees)]}]
    if calc:
        ops.append({"op": "set_calculation_timeframe", "timeframe": calc})
    return env(0, ops)


def asked(text, *choices):
    return env(0, questions=[{"id": "which", "text": text, "choices": list(choices)}], reply="I can't build that yet.")


ATR_14 = call("atr", HIGH, LOW, CLOSE, num(14))
#: what the assistant built live: the ATR of fourteen bars of the chart
STAND_IN = created(op("+", call("sessionLow"), op("*", num(0.6), ATR_14)))
SPAN_14 = "14 five-minute bars, about 1 hour 10 minutes"            # what the door says 14 bars of a 5 minute chart span
SPAN_50 = "50 five-minute bars, about 4 hours"
ATR_CHOICES = ("The 14 day ATR as a line, on daily bars", "The same line with the ATR of 14 five-minute bars (about 1 hour 10 minutes)")
REFUSED_BY_NAME = asked("I can't yet add today's own low to a daily measure like the 14 day ATR on a 5 minute chart. Which would you like?", *ATR_CHOICES)
WHY_50 = "I can't yet compare each 5 minute bar with a daily measure like the 50 day average. Which would you like?"
LINE_CHOICE = "The 50 day average as a line, on daily bars"
BARS_CHOICE = "Crosses of the average of 50 five-minute bars (about 4 hours)"


def refused_by(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:
        return exc
    return None


# ── the words ──

@pytest.mark.parametrize("words,lengths", [
    ("the 14 day ATR", [14]), ("a 20-day average", [20]), ("the 50day line", [50]), ("the last 3 sessions", [3]),
    ("the 10 day and the 20 day average", [10, 20]), ("the 14 day ATR and again the 14 day ATR", [14]),
    ("the close 2 days ago", []), ("3 days back", []), ("5 days earlier", []),          # a look-back, not a length
    ("a 1 day change", []),                                                             # one day is the day itself
    ("the 14 bar ATR", []), ("14 week average", []), ("today's low", []), ("the 2.5 day thing", []), ("", []), (None, []),
    # a number the member ALSO gives in bars is theirs in bars (that is how an offered choice is picked)
    (BARS_CHOICE, []), ("the 50 day average, as the average of 50 five-minute bars", []), ("the 50 day average and a 20 bar one", [50]),
])
def test_a_length_in_days_is_read_from_the_words(words, lengths):
    assert dc.day_lengths(words) == lengths, words


@pytest.mark.parametrize("words,chart,minutes,below", [
    ("the 50 day average", FIVE, 5, True), ("the 50 day average", {"sym": "X", "tf": "60"}, 60, True),
    ("the 50 day average", DAILY, None, False), ("the 50 day average", {"sym": "X", "tf": "W"}, None, False), ("the 50 day average", None, None, False),
    ("On a 15 minute chart, the 50 day average", DAILY, 15, True), ("on my 5-min chart", DAILY, 5, True), ("on the hourly chart", DAILY, 60, True),
    ("on a 2 hour chart", DAILY, 120, True), ("On a 15 minute chart", FIVE, 5, True),                 # the chart itself wins
    ("an intraday 50 day average", DAILY, None, True),                                               # below a day, minutes unknown
    ("the 5 day minimum", DAILY, None, False), ("a 5 minimum", DAILY, None, False),
])
def test_a_chart_below_a_day_is_the_chart_itself_or_the_one_the_words_name(words, chart, minutes, below):
    assert dc.chart_minutes(words, chart) == minutes and dc.below_a_day(words, chart) is below, (words, chart)


# ── what N bars of the chart really span: the door's arithmetic, never the assistant's ──

@pytest.mark.parametrize("bars,minutes,said", [
    (50, 5, "50 five-minute bars, about 4 hours"), (21, 5, "21 five-minute bars, about 1 hour 45 minutes"),
    (14, 5, "14 five-minute bars, about 1 hour 10 minutes"), (9, 5, "9 five-minute bars, about 45 minutes"),
    (50, 1, "50 one-minute bars, about 50 minutes"), (5, 60, "5 hourly bars, about 5 hours"),
    (78, 5, "78 five-minute bars, about 1 trading day"),                       # exactly one regular session
    (250, 5, "250 five-minute bars, about 3 trading days"), (200, 5, "200 five-minute bars, about 2.5 trading days"),
    (50, 15, "50 fifteen-minute bars, about 2 trading days"), (20, 60, "20 hourly bars, about 3 trading days"),
    (50, 7, "50 7-minute bars, about 6 hours"),                                # a timeframe with no name of its own
    (50, None, "50 bars of this chart"),                                       # only known to be below a day: no span is invented
])
def test_what_that_many_bars_of_the_chart_really_span(bars, minutes, said):
    assert dc.span_on_this_chart(bars, minutes) == said


def test_a_span_is_the_bars_times_the_minutes_by_hand():
    assert dc.SESSION_MINUTES == 390
    for minutes in (1, 5, 15, 30, 60):
        for bars in (9, 10, 14, 20, 21, 50, 100, 200, 250):
            said = dc.span_on_this_chart(bars, minutes)
            total = bars * minutes
            rest = said.split("about ")[1]
            if total >= dc.SESSION_MINUTES:
                assert abs(float(rest.split(" trading")[0]) - total / dc.SESSION_MINUTES) <= 0.25, (bars, minutes, said)
            else:
                hours = int(rest.split(" hour")[0]) if "hour" in rest else 0
                mins = int(rest.split(" minutes")[0].split()[-1]) if "minutes" in rest else 0
                assert abs(hours * 60 + mins - total) <= 15, (bars, minutes, said)


def test_the_notes_carry_each_length_in_days_with_its_span_and_only_below_a_day():
    assert dc.day_length_notes(MARKER_WORDS, FIVE) == [{"days": 50, "on_this_chart": SPAN_50}]
    assert dc.day_length_notes("On a 15 minute chart, the 20 day high and the 14 day ATR", DAILY) == [
        {"days": 20, "on_this_chart": "20 fifteen-minute bars, about 5 hours"}, {"days": 14, "on_this_chart": "14 fifteen-minute bars, about 3 hours 30 minutes"}]
    assert dc.day_length_notes("an intraday 50 day average", DAILY) == [{"days": 50, "on_this_chart": "50 bars of this chart"}]
    assert dc.day_length_notes("the 50 day average", DAILY) == []                 # on a daily chart 50 bars ARE 50 days
    assert dc.day_length_notes("the 50 bar average", FIVE) == []                  # no length in days was given


# ── the guard: a change ──

def test_THE_FINDING_days_built_as_bars_of_a_chart_below_a_day_are_refused():
    exc = refused_by(dc.check_day_lengths, STAND_IN, WORDS, FIVE)
    assert exc is not None and exc.gate == "envelope:reference"
    told = exc.for_model()
    for piece in ("`atr(..., 14)` is 14 five-minute bars, about 1 hour 10 minutes, and the member asked for 14 DAYS",
                  "If EVERY part of the indicator is a daily line on the chart's own symbol, keep the formula and add set_calculation_timeframe D",
                  "do NOT build it on the chart's bars under a note", "disposition clarify, `ops: []`, and ONE question",
                  "two `choices` that each name what they draw in time",
                  'the bars version written as "14 five-minute bars, about 1 hour 10 minutes" and never as 14 days'):
        assert piece in told, piece
    # the words name the chart, whatever chart the request came from (the live rounds were sent from a daily one)
    assert refused_by(dc.check_day_lengths, STAND_IN, "On a 5 minute chart, " + WORDS, DAILY) is not None
    # deep inside a formula too
    deep = created(op("?:", op(">", CLOSE, op("+", LOW, call("sma", op("-", HIGH, LOW), num(14)))), num(1), num(0)))
    assert refused_by(dc.check_day_lengths, deep, WORDS, FIVE) is not None


@pytest.mark.parametrize("answer,words,chart,why", [
    (created(op("+", CLOSE, ATR_14), calc="D"), WORDS, FIVE, "the whole indicator is on daily bars"),
    (created(op("+", CLOSE, ATR_14), calc="W"), WORDS, FIVE, "or on a higher timeframe still"),
    (STAND_IN, WORDS, DAILY, "on a daily chart 14 bars ARE 14 days"),
    (created(call("atr", HIGH, LOW, CLOSE, num(20))), WORDS, FIVE, "another number is not the member's days"),
    (STAND_IN, "a line at today's low so far plus 60 percent of the 14 bar ATR", FIVE, "the member asked for bars"),
    (STAND_IN, ATR_CHOICES[1], FIVE, "the member picked the offer that says bars"),
    (STAND_IN, WORDS + " " + ATR_CHOICES[1], FIVE, "and the pick stands when the first request rides along with it"),
    (created(op("+", CLOSE, num(14))), WORDS, FIVE, "the number is not a window of a call"),
    (env(0, disposition="unsupported", reply="I can't combine them yet."), WORDS, FIVE, "a plain refusal changes nothing"),
])
def test_CONTROL_what_is_built_on_days_or_was_asked_in_bars_is_left_alone(answer, words, chart, why):
    assert refused_by(dc.check_day_lengths, answer, words, chart) is None, why


def test_a_calculation_timeframe_BELOW_a_day_does_not_excuse_it():
    assert refused_by(dc.check_day_lengths, created(op("+", CLOSE, ATR_14), calc="60"), WORDS, FIVE) is not None


# ── the guard: the question's own wording ──

@pytest.mark.parametrize("choices", [
    (LINE_CHOICE, BARS_CHOICE),
    (LINE_CHOICE, "Nothing for now: on a daily chart this builds exactly as asked"),                 # no bars version offered
    (LINE_CHOICE, "Crosses of the average of 50 five-minute bars, about 4 hours"),
])
def test_a_question_whose_bars_choice_says_what_it_spans_passes(choices):
    assert refused_by(dc.check_day_lengths, asked(WHY_50, *choices), MARKER_WORDS, FIVE) is None


@pytest.mark.parametrize("choice,why", [
    ("Crosses of a 50 bar average of this chart", "it does not say what 50 bars span"),
    ("Crosses of the 50 day average on this chart's bars", "it calls the bars version 50 day"),
    ("Crosses of the average of 50 five-minute bars (about 4 hours), the 50 day idea", "it still calls it 50 day"),
    ("Crosses of the average of 50 five-minute bars (about 50 days)", "a span the door did not give"),
    ("Crosses of the average of 50 fifteen-minute bars (about 4 hours)", "another chart's bars"),
])
def test_a_question_that_misnames_the_bars_version_is_sent_back(choice, why):
    exc = refused_by(dc.check_day_lengths, asked(WHY_50, LINE_CHOICE, choice), MARKER_WORDS, FIVE)
    assert exc is not None, why
    told = exc.for_model()
    assert SPAN_50 in told and "never call it by its number of days" in told


def test_a_question_about_something_else_is_never_judged():
    other = env(0, questions=[{"id": "kind", "text": "Which average?", "choices": ["Simple, of 50 bars", "Exponential, of 50 bars"]}], reply="Which?")
    assert refused_by(dc.check_day_lengths, other, "a 50 bar average", FIVE) is None         # no length in days in the words
    assert refused_by(dc.check_day_lengths, other, MARKER_WORDS, DAILY) is None              # not below a day


# ── at the door ──

def test_the_stand_in_is_sent_back_and_the_question_with_its_offers_is_the_answer(conv, clean_env, model):
    client = model([emits(STAND_IN), emits(REFUSED_BY_NAME)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=FIVE)
    assert len(client.calls) == 2 and r.get("attempts") == 2, (r.get("gate"), r.get("reason"))
    assert r["disposition"] == "clarify" and not (r.get("envelope") or {}).get("ops")
    shown = json.dumps(r)
    assert "I can't yet add today's own low to a daily measure like the 14 day ATR on a 5 minute chart" in shown
    for choice in ATR_CHOICES:
        assert choice in shown, choice
    assert "is 14 five-minute bars, about 1 hour 10 minutes" in json.dumps(client.calls[1]["messages"])      # what the model was told in between
    # and the turn carried the door's own span from the start: the assistant never works it out
    first = client.calls[0]["messages"][0]["content"]
    assert '"day_lengths"' in first and '"days": 14' in first and SPAN_14 in first


def test_the_question_given_at_once_costs_one_call_and_builds_nothing(conv, clean_env, model):
    client = model([emits(REFUSED_BY_NAME)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=FIVE)
    assert len(client.calls) == 1 and r["disposition"] == "clarify" and not (r.get("envelope") or {}).get("ops")


def test_a_misnamed_question_is_sent_back_at_the_door_and_the_right_one_is_the_answer(conv, clean_env, model):
    wrong = asked(WHY_50, LINE_CHOICE, "Crosses of a 50 bar average of this chart")
    client = model([emits(wrong), emits(asked(WHY_50, LINE_CHOICE, BARS_CHOICE))])
    r = conv.converse(MARKER_WORDS, user_id="u1", view=empty_view(0), chart=FIVE)
    assert len(client.calls) == 2 and r["disposition"] == "clarify" and BARS_CHOICE in json.dumps(r)


def test_picking_the_bars_choice_builds_the_bars_version_in_one_call(conv, clean_env, model):
    client = model([emits(created(op(">", CLOSE, call("sma", CLOSE, num(50)))))])
    r = conv.converse(BARS_CHOICE, user_id="u1", view=empty_view(0), chart=FIVE)
    assert r["ok"] is True and len(client.calls) == 1, (r.get("gate"), r.get("reason"))


def test_an_indicator_that_is_daily_in_every_part_is_built_on_daily_bars_in_one_call(conv, clean_env, model):
    rng = call("sma", op("-", HIGH, LOW), num(20))
    client = model([emits(created(op("+", CLOSE, rng), op("-", CLOSE, rng), calc="D"))])
    r = conv.converse("Plot yesterday's close plus the average daily range of the last 20 days, and yesterday's close minus that range",
                      user_id="u1", view=empty_view(0), chart=FIVE)
    assert r["ok"] is True and len(client.calls) == 1, (r.get("gate"), r.get("reason"))


def test_the_same_request_on_a_daily_chart_is_built_as_it_always_was_and_carries_no_spans(conv, clean_env, model):
    client = model([emits(STAND_IN)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=DAILY)
    assert r["ok"] is True and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert '"day_lengths"' not in client.calls[0]["messages"][0]["content"]


def test_the_stand_in_twice_changes_nothing(conv, clean_env, model):
    client = model([emits(STAND_IN), emits(STAND_IN)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=FIVE)
    assert r["ok"] is False and r["gate"] == "envelope:reference" and len(client.calls) == 2


def test_the_instructions_say_days_are_days_and_how_to_ask(conv):
    prompt = " ".join(conv.CONVERSE_SYSTEM_PROMPT.split())
    for piece in ("ON A CHART BELOW A DAY A LENGTH IN DAYS IS DAYS", "never that many bars of the chart",
                  "`uct_language_notes.day_lengths` lists each one with what that many bars of THIS chart really span (`on_this_chart`)",
                  "When EVERY part of the indicator is a daily LINE on the chart's own symbol, build it and add set_calculation_timeframe D",
                  "the words compare each bar of this chart with the daily measure",
                  "or read another symbol (which takes no calculation timeframe at all)",
                  "Do NOT build it on the chart's bars under a note", "the member reads the chart",
                  "ask ONE question: one plain sentence of why, then two `choices` that each name what they draw IN TIME",
                  "Write the bars version with the `on_this_chart` words exactly as given, and never call it by its number of days",
                  BARS_CHOICE, "The ratio with an average of 21 five-minute bars (about 1 hour 45 minutes)",
                  "Nothing for now: on a daily chart this builds exactly as asked",
                  "Build only what the member picks, named for what it is"):
        assert piece in prompt, piece
    # the two spans the instructions quote are the door's own arithmetic, not typed twice
    assert dc.span_on_this_chart(50, 5) == SPAN_50 and "50 five-minute bars (about 4 hours)" in prompt
    assert dc.span_on_this_chart(21, 5) == "21 five-minute bars, about 1 hour 45 minutes"


# ── measured: nothing right is refused ──

def test_no_recorded_right_answer_is_refused_with_the_words_and_chart_it_was_asked_on():
    right = [c for c in CASES if c["lane"] == "formula" and c.get("recorded_verdict") != "wrong"]
    assert len(right) >= 100
    for case in right:
        answer = {**case["answer"], "disposition": "change"}
        assert refused_by(dc.check_day_lengths, answer, case["words"], DAILY) is None, case["id"]
    # the answer built RIGHT on daily bars for a 5 minute chart passes on a 5 minute chart too
    on_days = next(c for c in CASES if c["id"] == "intraday-03")
    assert refused_by(dc.check_day_lengths, {**on_days["answer"], "disposition": "change"}, on_days["words"], FIVE) is None
