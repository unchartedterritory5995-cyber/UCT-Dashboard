"""A DATE NAMED BY THE CALENDAR: the door knows today's date; the assistant never guesses it.

The defect: a line anchored to "the start of this year" was anchored to the first day of an EARLIER
year and read back as the current one. The assistant is not told the date, so it used the last
year it knew. Every bar of that line was a different number from the one asked for, under a
confident sentence.

The root is the missing fact, so the fix is the fact: when the member's words name a calendar start,
the turn carries today's date and the exact start of this year, quarter, month and week
(`definition_conversation.calendar_notes`), and the instructions forbid working any of them out.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import json
from zoneinfo import ZoneInfo

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

NY = ZoneInfo("America/New_York")
CHART = {"sym": "NVDA", "tf": "D"}
#: A pinned clock.
NOW = dt.datetime(2026, 11, 18, 15, 0, tzinfo=NY)
#: The anchor of the defect: the first day of the year BEFORE the pinned one, New York.
WRONG_ANCHOR = 1735707600


def midnight(year, month, day):
    return int(dt.datetime(year, month, day, tzinfo=NY).timestamp())


def test_the_calendar_of_a_pinned_day(conv):
    got = conv.calendar_notes(NOW)
    assert got == {
        "today": "2026-11-18", "timezone": "America/New_York",
        "start_of_this_year": {"date": "2026-01-01", "epoch": midnight(2026, 1, 1)},
        "start_of_this_quarter": {"date": "2026-10-01", "epoch": midnight(2026, 10, 1)},
        "start_of_this_month": {"date": "2026-11-01", "epoch": midnight(2026, 11, 1)},
        "start_of_this_week": {"date": "2026-11-16", "epoch": midnight(2026, 11, 16)},     # a Monday
    }
    # the value test: the start of the year is 2026's, and the defect's anchor is a year off
    assert got["start_of_this_year"]["epoch"] == 1767243600
    assert dt.datetime.fromtimestamp(WRONG_ANCHOR, NY).date() == dt.date(2025, 1, 1)
    assert got["start_of_this_year"]["epoch"] - WRONG_ANCHOR == 365 * 86400
    # each start is a midnight in New York, whichever side of a clock change it falls on
    for key in ("start_of_this_year", "start_of_this_quarter", "start_of_this_month", "start_of_this_week"):
        at = dt.datetime.fromtimestamp(got[key]["epoch"], NY)
        assert (at.hour, at.minute, at.second) == (0, 0, 0) and at.date().isoformat() == got[key]["date"], key


@pytest.mark.parametrize("now,year,quarter,month,week", [
    (dt.datetime(2027, 1, 1, 0, 30, tzinfo=NY), "2027-01-01", "2027-01-01", "2027-01-01", "2026-12-28"),   # the week began last year
    (dt.datetime(2026, 12, 31, 23, 59, tzinfo=NY), "2026-01-01", "2026-10-01", "2026-12-01", "2026-12-28"),
    (dt.datetime(2026, 3, 8, 12, 0, tzinfo=NY), "2026-01-01", "2026-01-01", "2026-03-01", "2026-03-02"),   # the day the clocks change
    (dt.datetime(2026, 7, 6, 9, 30, tzinfo=NY), "2026-01-01", "2026-07-01", "2026-07-01", "2026-07-06"),   # a Monday is its own week's start
])
def test_the_starts_at_the_edges_of_a_year_a_quarter_and_a_week(conv, now, year, quarter, month, week):
    got = conv.calendar_notes(now)
    assert [got[k]["date"] for k in ("start_of_this_year", "start_of_this_quarter", "start_of_this_month", "start_of_this_week")] \
        == [year, quarter, month, week]


@pytest.mark.parametrize("words", [
    "Add an anchored VWAP from the start of this year", "YTD anchored vwap", "year to date VWAP", "vwap since the start of the month",
    "anchor a vwap at the start of the quarter", "weekly anchored vwap", "the high of this week", "this quarter's range",
])
def test_words_that_name_a_calendar_start(conv, words):
    assert conv.names_a_calendar_start(words), words


@pytest.mark.parametrize("words", [
    "Plot a 21 EMA", "Mark days with the highest volume in a year", "the year high", "a 52 week high", "monthly returns",
    "the weekly 10 week average", "", None,
])
def test_words_that_do_not(conv, words):
    assert not conv.names_a_calendar_start(words), words


def anchored(epoch):
    return env(0, [{"op": "create", "name": "Anchored VWAP", "placement": "price",
                    "outputs": [{"key": "avwap", "tree": call("avwap", num(epoch))}]}])


def test_the_turn_carries_the_calendar_when_the_words_name_one_and_only_then(conv, clean_env, model, monkeypatch):
    monkeypatch.setattr(conv, "_now", lambda: NOW)
    client = model([emits(anchored(midnight(2026, 1, 1)))])
    r = conv.converse("Add an anchored VWAP from the start of this year", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True, r
    sent = client.calls[0]["messages"][0]["content"]
    assert '"calendar"' in sent and '"today": "2026-11-18"' in sent
    assert f'"epoch": {midnight(2026, 1, 1)}' in sent and str(WRONG_ANCHOR) not in sent
    # a request that names no calendar start is the turn it always was: no date, no clock read
    monkeypatch.setattr(conv, "_now", lambda: (_ for _ in ()).throw(AssertionError("the clock was read")))
    client = model([emits(env(0, [{"op": "create", "name": "EMA 21", "placement": "price",
                                    "outputs": [{"key": "e", "tree": call("ema", {"type": "series", "name": "close"}, num(21))}]}]))])
    r = conv.converse("Plot a 21 EMA", user_id="u2", view=empty_view(0), chart=CHART)
    assert r["ok"] is True, r
    assert '"calendar"' not in client.calls[0]["messages"][0]["content"]


def test_the_instructions_forbid_working_the_date_out(conv):
    prompt = conv.system_prompt()
    assert "you do NOT know today's date, so never work out the year, quarter, month or week yourself" in prompt
    assert "`uct_language_notes.calendar` gives today's date and the exact start of each" in prompt
    assert "ask which date" in prompt
    # and the door's own date is never a constant in the cached instructions
    assert str(dt.date.today().year) + "-" not in prompt.split("A DATE THE MEMBER NAMES BY THE CALENDAR")[1][:600]
    assert json.dumps(conv.calendar_notes(NOW))                              # it is plain data
