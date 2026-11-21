"""A VALUE THAT RESTARTS WITH THE CALENDAR is built from the bar's own calendar, never from a date.

Found in a live round, 2026-11-21. Asked for the year to date percent change, the assistant wrote today's
year into the formula as a date and read the prior year's close through a window of ONE bar: the line was
blank on every bar of this year and 0 on every bar before it, under a sentence saying it was the year to
date change. Asked for the highest high so far "this calendar year", it asked the member for a date.

The calendar instruction had been written for an ANCHOR (an anchored VWAP from the start of this year: a
date is right there, and the door supplies it). A value that RESTARTS on every year, month or week needs
no date: the table has the bar's own calendar (`year`, `month`, `monthfirst`, `weekfirst`). Built from
those it is right on every year of the chart and does not go stale when the year turns.

What is held here:
  * the two formulas the instructions now give, VALUE-CHECKED on a built market of several years against a
    plain calculation, with the defect's formula held beside them so the difference is a number;
  * the quarter's restart the instructions give, the same way;
  * the door accepts them as built;
  * the instruction's own sentences, and that the dated paragraph still stands for an anchor;
  * "this calendar year" now names a calendar start (CONTROL: an anchored VWAP still gets the door's date).

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import math
from zoneinfo import ZoneInfo

import pytest

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

NY = ZoneInfo("America/New_York")
CHART = {"sym": "NVDA", "tf": "D"}


def S(name):
    return {"type": "series", "name": name}


def OP(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def OFF(tree, k=1):
    return {"type": "offset", "value": k, "args": [tree]}


#: The restarts, as the instructions give them.
NEW_YEAR = OP("!=", S("year"), OFF(S("year")))
NEW_QUARTER = OP("&&", S("monthfirst"), OP("||", OP("||", OP("||", OP("==", S("month"), num(1)), OP("==", S("month"), num(4))),
                                                       OP("==", S("month"), num(7))), OP("==", S("month"), num(10))))
PRIOR_YEARS_CLOSE = call("valuewhen", NEW_YEAR, OFF(S("close")), num(300))
#: "The year to date percent change", and "this year's running high": the two formulas of the instructions.
YEAR_TO_DATE = OP("*", OP("/", OP("-", S("close"), PRIOR_YEARS_CLOSE), PRIOR_YEARS_CLOSE), num(100))
YEARS_HIGH = call("accum", S("high"), OP("?:", NEW_YEAR, S("high"), call("max", S("self"), S("high"))), num(300))
QUARTERS_HIGH = call("accum", S("high"), OP("?:", NEW_QUARTER, S("high"), call("max", S("self"), S("high"))), num(100))


def the_defect(this_year):
    """What was built: the year written in as a date, and the prior close read through a window of ONE bar."""
    start = int(dt.datetime(this_year, 1, 1, tzinfo=NY).timestamp())
    prior = call("valuewhen", OP("<", S("time"), num(start)), S("close"), num(1))
    return OP("*", OP("/", OP("-", S("close"), prior), prior), num(100))


def market(first=dt.date(2019, 1, 2), last=dt.date(2026, 11, 20)):
    """A built daily market of several calendar years (weekdays; a fixed walk, no vendor data)."""
    bars, seed, px, day = [], 20261121, 50.0, first

    def rnd():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
    while day <= last:
        if day.weekday() < 5:
            o = px * (1 + (rnd() - 0.5) * 0.01)
            px = o * (1 + (rnd() - 0.49) * 0.03)
            bars.append({"t": day.isoformat(), "o": o, "h": max(o, px) * (1 + rnd() * 0.006), "l": min(o, px) * (1 - rnd() * 0.006),
                         "c": px, "v": float(round(3e7 * (0.5 + rnd())))})
        day += dt.timedelta(days=1)
    return bars


BARS = market()
N = len(BARS)
T = [b["t"] for b in BARS]
H = [b["h"] for b in BARS]
C = [b["c"] for b in BARS]


def run(tree):
    got = ast_interpret.interpret(tree, BARS, None, None, None, {"tf": "D"})
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in got]


def held_to(got, want):
    """(bars compared, bars that differ, bars where only the plain calculation has a value)."""
    both = [i for i in range(N) if got[i] is not None and want[i] is not None]
    differ = [i for i in both if abs(got[i] - want[i]) > 1e-9 * max(1.0, abs(want[i]))]
    return len(both), len(differ), sum(1 for i in range(N) if want[i] is not None and got[i] is None)


def by_hand_year_to_date():
    out, base = [], None
    for i in range(N):
        if i > 0 and T[i][:4] != T[i - 1][:4]:
            base = C[i - 1]
        out.append(None if base is None else (C[i] / base - 1) * 100)
    return out


def by_hand_running_high(restarts):
    out, top = [], None
    for i in range(N):
        top = H[i] if (i == 0 or restarts(i)) else max(top, H[i])
        out.append(top)
    return out


def test_the_built_market_spans_several_years_and_can_tell_the_rules_apart():
    years = sorted({t[:4] for t in T})
    assert len(years) >= 7 and N > 1800
    ytd = by_hand_year_to_date()
    # a year to date change is a different number from the close's change over a fixed 252 bars, on most bars
    fixed = [None if i < 252 else (C[i] / C[i - 252] - 1) * 100 for i in range(N)]
    apart = sum(1 for i in range(N) if ytd[i] is not None and fixed[i] is not None and abs(ytd[i] - fixed[i]) > 1e-6)
    assert apart > 1000
    # and the year's running high is not the 252-bar high
    high = by_hand_running_high(lambda i: T[i][:4] != T[i - 1][:4])
    assert sum(1 for i in range(252, N) if abs(high[i] - max(H[i - 251:i + 1])) > 1e-9) > 300


def test_the_year_to_date_change_from_the_bars_own_calendar_is_right_on_every_year():
    compared, differ, missing = held_to(run(YEAR_TO_DATE), by_hand_year_to_date())
    assert differ == 0 and compared > 1500
    assert missing == 0                                   # a value on every bar the plain calculation has one
    # this year's bars have a value, every one of them
    got = run(YEAR_TO_DATE)
    this_year = [i for i in range(N) if T[i][:4] == T[-1][:4]]
    assert len(this_year) > 200 and all(got[i] is not None for i in this_year)


def test_THE_DEFECT_a_date_and_a_window_of_one_is_blank_on_this_year_and_zero_before():
    got, want = run(the_defect(int(T[-1][:4]))), by_hand_year_to_date()
    this_year = [i for i in range(N) if T[i][:4] == T[-1][:4]]
    assert all(got[i] is None for i in this_year[1:])                      # blank on every bar of this year but its first
    before = [i for i in range(N) if T[i][:4] < T[-1][:4]]
    assert all(got[i] == 0.0 for i in before)                              # and 0 on every bar before it
    compared, differ, _missing = held_to(got, want)
    assert compared > 1000 and differ >= compared - 1                      # it agrees with the request nowhere it can be compared


def test_this_years_running_high_from_the_bars_own_calendar_is_right():
    got = run(YEARS_HIGH)
    compared, differ, _missing = held_to(got, by_hand_running_high(lambda i: T[i][:4] != T[i - 1][:4]))
    assert differ == 0 and compared == N - 300                             # every bar once the running value has its history
    assert got[-1] == max(H[i] for i in range(N) if T[i][:4] == T[-1][:4])


def test_the_quarters_restart_the_instructions_give_is_the_calendar_quarter():
    quarter = lambda t: (t[:4], (int(t[5:7]) - 1) // 3)  # noqa: E731
    compared, differ, _missing = held_to(run(QUARTERS_HIGH), by_hand_running_high(lambda i: quarter(T[i]) != quarter(T[i - 1])))
    assert differ == 0 and compared == N - 100


def test_the_door_accepts_both_as_built(conv, clean_env, model):
    for key, tree, placement in (("ytd", YEAR_TO_DATE, "pane"), ("yearHigh", YEARS_HIGH, "price")):
        client = model([emits(env(0, [{"op": "create", "name": key, "placement": placement, "outputs": [{"key": key, "tree": tree}]}]))])
        r = conv.converse("Plot the year to date percent change" if key == "ytd" else "Plot this year's high so far",
                          user_id=f"u-{key}", view=empty_view(0), chart=CHART)
        assert r["ok"] is True and len(client.calls) == 1, (key, r.get("gate"), r.get("reason"))
        built = r["envelope"]["ops"][0]["outputs"][0]["tree"]
        assert built == tree, key                                          # nothing after the model call rewrote it


def test_the_instructions_say_a_restart_is_the_bars_own_calendar_and_a_date_is_for_an_anchor(conv):
    prompt = conv.system_prompt()
    assert "A VALUE THAT RESTARTS WITH THE CALENDAR" in prompt
    restart = prompt.split("A VALUE THAT RESTARTS WITH THE CALENDAR")[1].split("A DATE THE MEMBER NAMES BY THE CALENDAR")[0]
    assert "is built from the bar's OWN calendar and NEVER from a date" in restart
    for piece in ("`year != offset 1 of year` for a year", "`monthfirst` for a month", "`weekfirst` for a week",
                  "valuewhen(year != offset 1 of year, offset 1 of close, 300)",
                  "accum(high, year != offset 1 of year ? high : max(self, high), 300)",
                  "is a WINDOW in bars and must reach back past the event", "never 1, which is blank on every bar but the event's own",
                  "These need no date, so never ask for one", "are for an ANCHOR only"):
        assert piece in restart, piece
    # the restart paragraph comes FIRST, and the dated one still stands whole (`test_calendar_anchor` holds its sentences)
    assert prompt.index("A VALUE THAT RESTARTS WITH THE CALENDAR") < prompt.index("A DATE THE MEMBER NAMES BY THE CALENDAR")
    assert "as the number `avwap(...)` takes" in prompt
    # no year is written into either paragraph
    assert str(dt.date.today().year) not in restart


@pytest.mark.parametrize("words", [
    "Plot the highest high so far this calendar year", "the low of the current calendar month", "since the start of the calendar year",
    "anchor a vwap at the start of this calendar quarter",
])
def test_this_CALENDAR_year_names_a_calendar_start(conv, words):
    assert conv.names_a_calendar_start(words), words


@pytest.mark.parametrize("words", ["a calendar year of returns", "the calendar spread", "Plot a 21 EMA", "an economic calendar"])
def test_the_word_calendar_alone_does_not(conv, words):
    assert not conv.names_a_calendar_start(words), words


def test_CONTROL_an_anchor_still_gets_the_doors_date(conv, clean_env, model, monkeypatch):
    now = dt.datetime(2026, 11, 18, 15, 0, tzinfo=NY)
    monkeypatch.setattr(conv, "_now", lambda: now)
    start = int(dt.datetime(2026, 1, 1, tzinfo=NY).timestamp())
    client = model([emits(env(0, [{"op": "create", "name": "Anchored VWAP", "placement": "price",
                                    "outputs": [{"key": "avwap", "tree": call("avwap", num(start))}]}]))])
    r = conv.converse("Add an anchored VWAP from the start of this calendar year", user_id="u-anchor", view=empty_view(0), chart=CHART)
    assert r["ok"] is True, r
    sent = client.calls[0]["messages"][0]["content"]
    assert '"calendar"' in sent and f'"epoch": {start}' in sent
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == call("avwap", num(start))
