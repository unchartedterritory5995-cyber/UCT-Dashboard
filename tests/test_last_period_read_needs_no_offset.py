"""LAST MONTH'S HIGH IS THE MONTHLY READ AS IT STANDS: an offset around it is one bar of the CHART, not one month.

Found by a value check of a live round, 2026-11-21. Asked for "last month's high and last month's low" on a
daily chart, the assistant wrapped the monthly read in an offset of 1. The monthly read already answers the last
CLOSED month on every bar of this month. The offset outside it counts bars of the chart, so the line was one
daily bar late: on the first trading day of every month it still showed the month BEFORE last, and was right on
every other day. A level a member trades against, wrong on the day the month turns.

The instructions now say so, and say where an offset goes when the member does want an earlier period (inside
the read, where it counts periods).

What is held here, with the engine's own interpreter and a plain calculation on a built market:
  * the monthly and the weekly read, as they stand, are the last closed period's value on every bar;
  * THE FINDING: with an offset of 1 outside, the value differs on exactly the first bar of each period, where
    it is the period before last;
  * an offset INSIDE the read is one period further back;
  * the door accepts the plain read as built;
  * the instruction's sentences.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import math

import pytest

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

HIGH = {"type": "series", "name": "high"}


def tf(code, node):
    return {"type": "tf", "value": code, "args": [node]}


def back(node, k=1):
    return {"type": "offset", "value": k, "args": [node]}


def market(first=dt.date(2024, 1, 2), last=dt.date(2026, 11, 20)):
    """A built daily market (weekdays; a fixed walk, no vendor data), long enough for many months and weeks."""
    bars, seed, px, day = [], 20261121, 80.0, first

    def rnd():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
    while day <= last:
        if day.weekday() < 5:
            o = px * (1 + (rnd() - 0.5) * 0.012)
            px = o * (1 + (rnd() - 0.49) * 0.035)
            bars.append({"t": day.isoformat(), "o": o, "h": max(o, px) * (1 + rnd() * 0.008), "l": min(o, px) * (1 - rnd() * 0.008),
                         "c": px, "v": float(round(2e7 * (0.5 + rnd())))})
        day += dt.timedelta(days=1)
    return bars


BARS = market()
N = len(BARS)
DAY = [dt.date.fromisoformat(b["t"]) for b in BARS]
PERIOD = {"M": [(d.year, d.month) for d in DAY], "W": [tuple(d.isocalendar()[:2]) for d in DAY]}


def run(tree):
    got = ast_interpret.interpret(tree, BARS, None, None, None, {"tf": "D"})
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in got]


def highs_by_period(code):
    keys = PERIOD[code]
    order = sorted(set(keys))
    high = {k: max(BARS[i]["h"] for i in range(N) if keys[i] == k) for k in order}
    index = {k: n for n, k in enumerate(order)}
    return keys, order, high, index


def by_hand(code, periods_back):
    """On each bar: the high of the period `periods_back` before this bar's own (1 = the last closed one)."""
    keys, order, high, index = highs_by_period(code)
    return [high[order[index[k] - periods_back]] if index[k] - periods_back >= 0 else None for k in keys]


def differ(got, want):
    return [i for i in range(N) if got[i] is not None and want[i] is not None and abs(got[i] - want[i]) > 1e-9 * max(1.0, abs(want[i]))]


@pytest.mark.parametrize("code", ["M", "W"])
def test_the_read_as_it_stands_is_the_last_closed_periods_value_on_every_bar(code):
    got, want = run(tf(code, HIGH)), by_hand(code, 1)
    assert differ(got, want) == []
    both = [i for i in range(N) if got[i] is not None and want[i] is not None]
    assert len(both) > N - 30                                              # every bar after the first period
    # and it is NOT this period's own high so far (a different number on most bars)
    assert len(differ(got, by_hand(code, 0))) > N // 2


@pytest.mark.parametrize("code", ["M", "W"])
def test_THE_FINDING_an_offset_outside_is_one_chart_bar_late_on_the_first_bar_of_each_period(code):
    keys = PERIOD[code]
    first_bars = [i for i in range(1, N) if keys[i] != keys[i - 1]]
    got, want = run(back(tf(code, HIGH))), by_hand(code, 1)
    wrong = differ(got, want)
    # it differs ONLY on first bars of a period, and on those it is the period before last
    assert wrong and set(wrong) <= set(first_bars)
    two_back = by_hand(code, 2)
    assert all(two_back[i] is not None and abs(got[i] - two_back[i]) < 1e-9 * max(1.0, abs(two_back[i])) for i in wrong)
    # nearly every period turn is hit (the rare miss is two periods with the same high)
    assert len(wrong) >= len(first_bars) - 3 - 2 and len(wrong) > (20 if code == "M" else 100)


@pytest.mark.parametrize("code", ["M", "W"])
def test_an_offset_INSIDE_the_read_is_one_period_further_back(code):
    got = run(tf(code, back(HIGH)))
    assert differ(got, by_hand(code, 2)) == []
    assert sum(1 for i in range(N) if got[i] is not None) > N - 60


def test_the_door_accepts_the_plain_read_as_built(conv, clean_env, model):
    ops = [{"op": "create", "name": "Last month", "placement": "price",
            "outputs": [{"key": "mHigh", "tree": tf("M", HIGH)}, {"key": "mLow", "tree": tf("M", {"type": "series", "name": "low"})}]}]
    client = model([emits(env(0, ops))])
    r = conv.converse("plot last month's high and last month's low", user_id="u1", view=empty_view(0), chart={"sym": "NVDA", "tf": "D"})
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert [o["tree"] for o in r["envelope"]["ops"][0]["outputs"]] == [tf("M", HIGH), tf("M", {"type": "series", "name": "low"})]


def test_the_instructions_say_the_read_needs_no_offset_and_where_one_goes(conv):
    prompt = conv.system_prompt()
    head = '"LAST WEEK\'S" OR "LAST MONTH\'S" VALUE'
    assert head in prompt
    text = prompt.split(head)[1][:1100]
    for piece in ("is the `tf` read as it stands",
                  "tf(high, M) already IS the last closed month's high on every bar of this month",
                  "Do NOT put an offset around it",
                  "an offset outside a `tf` read counts bars of the CHART",
                  "the month before last on the first bar of each month",
                  "put the offset INSIDE the read, where it counts periods: tf(offset 1 of high, M)"):
        assert piece in text, piece
    # the node list still says what `tf` is (unchanged), and this paragraph comes after it
    assert "LAST CLOSED period" in prompt and prompt.index("LAST CLOSED period") < prompt.index(head)
