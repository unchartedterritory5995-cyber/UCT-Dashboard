"""A DATE THE MEMBER WRITES OUT: the door resolves it; the assistant never works its number out and never asks for one.

Found by the live re-check of "a running value that starts on a date", 2026-11-22. The door gave the assistant a
number for "this year" (`calendar`) and none for "2 June 2026", so the assistant either
  * worked the number out itself: asked for a stop that starts on 2 June 2026 it wrote `time < 1780718400`, which is
    6 June. The line started four days late under a sentence that named 2 June; or
  * asked the member for "the exact start-of-day timestamp in seconds (New York)", which no trader can answer.

The root is the missing fact, so the fix is the fact (as it was for the calendar):
  * `dates_named` reads the dates in the member's words and the turn carries each as the number `time` holds
    (`uct_language_notes.dates`); a date with no year is the most recent such day and says so; a form that reads two
    ways ("6/2/2026") or names no day ("March 2026") is not resolved, and the assistant asks in plain words;
  * the instructions forbid working a date's number out and asking a member for a number;
  * a date number the turn did not supply (compared with `time`, or anchoring `avwap`) is refused, so the model gets
    its repair with the right number in it.

MEASURED before the guard was written, with the door's own functions, over the 200 answers recorded in the live
rounds that change something: it refuses the one answer that started four days late and no other. That answer is a
value case recorded WRONG (`date-start-01`).

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import definition_conversation as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tools.value_cases import grade as G

NY = ZoneInfo("America/New_York")
CHART = {"sym": "NVDA", "tf": "D"}
#: A pinned clock: a Sunday.
NOW = dt.datetime(2026, 11, 22, 12, 0, tzinfo=NY)
ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
THE_CASE = next(c for c in CASES if c["id"] == "date-start-01")
WORDS = THE_CASE["words"]
#: the answer the finding rests on (the assistant's own number for the date): the case's record while it is recorded
#: WRONG, its `found` specimen once the door gets it right
THE_ANSWER = G.specimen(THE_CASE)
#: what the assistant worked out live for "2 June 2026": 6 June
WRONG = 1780718400


def midnight(year, month, day):
    return int(dt.datetime(year, month, day, tzinfo=NY).timestamp())


JUNE_2 = midnight(2026, 6, 2)
TIME = {"type": "series", "name": "time"}
CLOSE = {"type": "series", "name": "close"}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def back(tree, n=1):
    return {"type": "offset", "value": n, "args": [tree]}


def created(tree):
    return env(0, [{"op": "create", "name": "From a date", "placement": "price", "outputs": [{"key": "v", "tree": tree}]}])


def from_the_date(number):
    """A value with nothing before the date (the shape of the instructions, cut to what matters here)."""
    return created(op("?:", op("<", TIME, num(number)), op("/", num(0), num(0)), CLOSE))


def refused_by(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:
        return exc
    return None


# ── the resolver ──

def test_the_number_of_the_finding_s_date():
    assert JUNE_2 == 1780372800                                          # 04:00Z: New York is on summer time
    assert dt.datetime.fromtimestamp(WRONG, NY).date() == dt.date(2026, 6, 6) and WRONG - JUNE_2 == 4 * 86400
    assert dc.dates_named(WORDS, NOW) == [{"words": "2 June 2026", "date": "2026-06-02", "epoch": 1780372800}]


@pytest.mark.parametrize("words", [
    "a stop from my entry on 2 June 2026", "starting June 2, 2026", "from June 2nd 2026", "since the 2nd of June 2026",
    "from 2 Jun 2026 on", "since Jun. 2, 2026", "since 2026-06-02", "since 2026-6-2", "FROM 2 JUNE 2026", "since 02 June, 2026",
])
def test_every_way_of_writing_one_date_is_the_same_number(words):
    got = dc.dates_named(words, NOW)
    assert [(d["date"], d["epoch"]) for d in got] == [("2026-06-02", JUNE_2)], (words, got)
    assert "year_assumed" not in got[0]


@pytest.mark.parametrize("words,date", [
    ("the highest high since 3 March", "2026-03-03"),                    # earlier this year
    ("count the up days since May 1", "2026-05-01"),
    ("since 25 December", "2025-12-25"),                                 # not yet come this year: last year's
    ("since 22 November", "2026-11-22"),                                 # today is such a day
    ("since 23 November", "2025-11-23"),                                 # tomorrow: last year's
    ("since 29 February", "2024-02-29"),                                 # the most recent year that has one
])
def test_a_date_with_no_year_is_the_most_recent_such_day_and_says_so(words, date):
    got = dc.dates_named(words, NOW)
    assert [(d["date"], d.get("year_assumed")) for d in got] == [(date, True)], (words, got)


@pytest.mark.parametrize("words", [
    "since 6/2/2026",                                                    # reads two ways
    "since 2/6/26", "since 06.02.2026",
    "since March 2026",                                                  # names no day
    "the June 20 day average", "a May 10 bar high", "March 5 week low",  # a length, not a day
    "it may 5x from here", "volume may 3 times the average",             # "may" the word
    "since 31 June 2026", "since 30 February 2025", "since 2026-13-01", "since 2026-02-30",    # no such day
    "the 14 day ATR", "Plot a 21 EMA", "a 52 week high", "2 times the 14 day ATR", "", "   ", None, 5,
])
def test_what_is_not_a_written_date_is_not_resolved(words):
    assert dc.dates_named(words, NOW) == [], words


def test_every_date_is_a_midnight_in_new_york_whichever_side_of_a_clock_change():
    for year, month, day in ((2026, 1, 15), (2026, 3, 8), (2026, 3, 9), (2026, 6, 2), (2026, 11, 1), (2026, 11, 2), (2024, 2, 29)):
        got = dc.dates_named(f"since {year}-{month:02d}-{day:02d}", NOW)[0]
        at = dt.datetime.fromtimestamp(got["epoch"], NY)
        assert (at.hour, at.minute, at.second) == (0, 0, 0) and at.date() == dt.date(year, month, day), got
    winter, summer = dc.dates_named("from 15 January 2026 to 2 June 2026", NOW)
    assert winter["epoch"] % 86400 == 5 * 3600 and summer["epoch"] % 86400 == 4 * 3600


def test_several_dates_come_in_the_order_written_once_each_and_capped():
    got = dc.dates_named("shade from 2 June 2026 to June 5, 2026, and again from 2026-06-02", NOW)
    assert [d["date"] for d in got] == ["2026-06-02", "2026-06-05"]
    # one stretch of words is one date: "3 March 14" is the 3rd of March, never also the 14th
    assert [d["date"] for d in dc.dates_named("since 3 March 14 day ATR above", NOW)] == ["2026-03-03"]
    # ... and here nothing but "one stretch, one date" stops the second reading ("March 14" is followed by no length word)
    assert [d["date"] for d in dc.dates_named("the high of 3 March 14 points above", NOW)] == ["2026-03-03"]
    many = ", ".join(f"{d} June 2026" for d in range(1, 12))
    assert len(dc.dates_named(many, NOW)) == dc.MAX_DATES == 6


def test_the_clock_is_read_only_for_a_date_with_no_year(monkeypatch):
    monkeypatch.setattr(dc, "_now", lambda: (_ for _ in ()).throw(AssertionError("the clock was read")))
    assert dc.dates_named("since 2 June 2026")[0]["epoch"] == JUNE_2
    assert dc.dates_named("Plot a 21 EMA") == []
    with pytest.raises(AssertionError, match="the clock was read"):
        dc.dates_named("since 2 June")


# ── what a turn may use ──

def test_the_date_numbers_a_turn_may_use():
    notes = {"dates": dc.dates_named(WORDS, NOW), "calendar": dc.calendar_notes(NOW)}
    turns = [{"role": "member", "text": "start it on 3 March 2026"}, {"role": "assistant", "text": "since 9 March 2026"}]
    view = {"definitions": [{"outputs": [{"formula": "time < 1764565200 ? 0 / 0 : close"}]}]}
    got = dc.supplied_date_numbers("move it to 1700000000 please", notes, view, turns)
    assert got[JUNE_2] == "2026-06-02"
    assert got[midnight(2026, 1, 1)] == "start of this year" and midnight(2026, 11, 16) in got
    assert midnight(2026, 3, 3) in got and midnight(2026, 3, 9) not in got      # the member's earlier words, never the assistant's
    assert 1700000000 in got and 1764565200 in got                              # typed by the member; already in the indicator
    assert WRONG not in got
    assert dc.supplied_date_numbers(None, None, None, None) == {}


# ── the guard ──

@pytest.mark.parametrize("tree,how", [
    (op("<", TIME, num(WRONG)), "`time` is compared with"),
    (op(">=", num(WRONG), TIME), "`time` is compared with"),                               # either side
    (op("<", back(TIME), num(WRONG)), "`time` is compared with"),                          # the bar before's time
    (op("?:", op("==", TIME, num(WRONG)), CLOSE, num(0)), "`time` is compared with"),      # inside a formula
    (op("<", TIME, num(WRONG * 1000)), "`time` is compared with"),                         # milliseconds are a date number too
    (call("avwap", num(WRONG)), "`avwap` is anchored at"),
])
def test_a_date_number_the_turn_did_not_supply_is_refused(tree, how):
    supplied = dc.supplied_date_numbers(WORDS, {"dates": dc.dates_named(WORDS, NOW)}, None, None)
    exc = refused_by(dc.check_date_numbers, created(tree), supplied)
    assert exc is not None and exc.gate == "envelope:reference", tree
    told = exc.for_model()
    for piece in (how, "a date number this turn did not give you", "A date's number is never worked out",
                  "2026-06-02 is 1780372800", "ask for it in plain words (the day, the month and the year), and never ask for a number"):
        assert piece in told, (piece, told)


@pytest.mark.parametrize("tree", [
    op("<", TIME, num(JUNE_2)),                                                            # the door's own number
    op("<", back(TIME), num(JUNE_2)),
    call("avwap", num(JUNE_2)),
    op("<", TIME, op("+", num(JUNE_2), num(86400))),                                       # whole days added as arithmetic
    op(">", {"type": "series", "name": "volume"}, num(1_000_000_000)),                     # a large number that is not a date
    op(">", CLOSE, num(WRONG)),
    op(">", op("-", TIME, back(TIME)), num(86400)),                                        # a span of time, not a date
    op("<", TIME, num(100)),
    call("sma", CLOSE, num(20)),
])
def test_CONTROL_the_door_s_number_and_a_number_that_is_not_a_date_are_left_alone(tree):
    supplied = dc.supplied_date_numbers(WORDS, {"dates": dc.dates_named(WORDS, NOW)}, None, None)
    assert refused_by(dc.check_date_numbers, created(tree), supplied) is None, tree


def test_the_calendar_s_numbers_and_the_indicator_s_own_pass():
    start = midnight(2026, 1, 1)
    assert refused_by(dc.check_date_numbers, created(call("avwap", num(start))),
                      dc.supplied_date_numbers("YTD anchored vwap", {"calendar": dc.calendar_notes(NOW)}, None, None)) is None
    # an edit re-sends the indicator's formulas: the number already in it is the member's own
    view = {"definitions": [{"outputs": [{"tree": op("<", TIME, num(WRONG))}]}]}
    assert refused_by(dc.check_date_numbers, from_the_date(WRONG), dc.supplied_date_numbers("make the line thicker", {}, view, None)) is None
    # CONTROL: with nothing supplied, both are refused
    assert refused_by(dc.check_date_numbers, created(call("avwap", num(start))), {}) is not None
    assert refused_by(dc.check_date_numbers, from_the_date(WRONG), {}) is not None


# ── at the door ──

def test_the_turn_carries_the_date_when_the_words_write_one_and_only_then(conv, clean_env, model, monkeypatch):
    monkeypatch.setattr(conv, "_now", lambda: (_ for _ in ()).throw(AssertionError("the clock was read")))
    client = model([emits(from_the_date(JUNE_2))])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    sent = client.calls[0]["messages"][0]["content"]
    assert '"dates"' in sent and '"date": "2026-06-02"' in sent and f'"epoch": {JUNE_2}' in sent and str(WRONG) not in sent
    # a request that writes no date is the turn it always was
    client = model([emits(created(call("ema", CLOSE, num(21))))])
    r = conv.converse("Plot a 21 EMA", user_id="u2", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and '"dates"' not in client.calls[0]["messages"][0]["content"]


def test_THE_FINDING_the_recorded_answer_is_refused_and_the_repair_carries_the_right_number(conv, clean_env, model):
    recorded = {**env(0, copy.deepcopy(THE_ANSWER["answer"]["ops"])), "reply": THE_ANSWER["answer"]["reply"]}
    assert str(WRONG) in json.dumps(recorded) and str(JUNE_2) not in json.dumps(recorded)
    repaired = json.loads(json.dumps(recorded).replace(str(WRONG), str(JUNE_2)))
    client = model([emits(recorded), emits(repaired)])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2, (r.get("gate"), r.get("reason"))
    built = json.dumps(r["envelope"]["ops"])
    assert str(JUNE_2) in built and str(WRONG) not in built
    said = json.dumps(client.calls[1]["messages"])
    assert "a date number this turn did not give you" in said and "2026-06-02 is 1780372800" in said


def test_an_answer_that_works_the_date_out_twice_changes_nothing(conv, clean_env, model):
    client = model([emits(from_the_date(WRONG)), emits(from_the_date(WRONG + 86400))])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "envelope:reference" and len(client.calls) == 2
    assert not (r.get("envelope") or {}).get("ops")


@pytest.mark.parametrize("words,date", [
    ("Plot the highest high since 3 March 2026", (2026, 3, 3)),
    ("Count the up closes since 1 September 2026, where an up close is a close above the prior close", (2026, 9, 1)),
])
def test_the_two_requests_that_were_answered_with_a_question_for_seconds_carry_their_number(conv, clean_env, model, words, date):
    number = midnight(*date)
    client = model([emits(from_the_date(number))])
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert f'"epoch": {number}' in client.calls[0]["messages"][0]["content"]


def test_the_instructions_forbid_working_a_date_out_and_asking_for_a_number(conv):
    prompt = conv.CONVERSE_SYSTEM_PROMPT
    for piece in ("A DATE THE MEMBER WRITES OUT", "`uct_language_notes.dates` gives each one as the number `time` holds",
                  "NEVER work a date's number out yourself", "NEVER ask the member for a number, a timestamp or seconds",
                  "When `year_assumed` is true the member gave no year", "ask for it in plain words: the day, the month and the year",
                  "With D that date's number from `uct_language_notes.dates`, write"):
        assert piece in " ".join(prompt.split()), piece
    assert "With D the date as the number `time` holds" not in prompt          # the sentence that had the assistant ask for seconds


# ── measured: nothing right is refused ──

def test_no_recorded_right_answer_is_refused_by_the_date_guard():
    on = dt.datetime(2026, 11, 21, 12, 0, tzinfo=NY)                            # the day the answers were recorded
    right = [c for c in CASES if c["lane"] == "formula" and c.get("recorded_verdict") != "wrong"]
    assert len(right) >= 100
    for case in right:
        notes = {}
        if dc.names_a_calendar_start(case["words"]):
            notes["calendar"] = dc.calendar_notes(on)
        if dc.dates_named(case["words"], on):
            notes["dates"] = dc.dates_named(case["words"], on)
        supplied = dc.supplied_date_numbers(case["words"], notes, None, None)
        assert refused_by(dc.check_date_numbers, case["answer"], supplied) is None, case["id"]
    # CONTROL (the loop above is not vacuous): the recorded WRONG one is refused with everything its own turn would
    # have been given, and the SAME answer on the door's number passes
    supplied = dc.supplied_date_numbers(WORDS, {"dates": dc.dates_named(WORDS, on)}, None, None)
    assert refused_by(dc.check_date_numbers, THE_ANSWER["answer"], supplied) is not None
    on_the_right_day = json.loads(json.dumps(THE_ANSWER["answer"]).replace(str(WRONG), str(JUNE_2)))
    assert refused_by(dc.check_date_numbers, on_the_right_day, supplied) is None
    assert "6 June 2026" in THE_ANSWER["defect"]
