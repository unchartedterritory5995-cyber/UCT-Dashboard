"""A RUNNING VALUE THAT STARTS ON A DATE STARTS FRESH ON ITS FIRST BAR, and has no value before it.

Found by a value check of a live round, 2026-11-21. Asked for "a trailing stop that starts on 2 June 2026 at 2
times the 14 day ATR below the close, and after that only ever moves up", the assistant built one running value
whose update was ``max(self, level)`` from the date on and the plain level before it. On the start bar `self` is
the value of the bar BEFORE the date, so the stop did not start at 2 ATRs under that day's close: it started at
the higher of that and the day before's level, and stayed there until the level rose past it. A stop a member
places an order against, too high from its first day. It also drew the unstarted level on every bar before the
date, which the member did not ask for.

The instructions now give the shape: no value before the date; on the first bar on or after it the starting
value itself; `self` only on the bars after.

What is held here, with the engine's own interpreter and a plain calculation on a built market:
  * the shape, for a stop that only rises, a highest high and a count, equals the plain calculation on every bar
    from the date and has no value before it, whether the date is a trading day or a Saturday;
  * THE FINDING: the form that reads `self` on the start bar is the higher of the two levels there, and so
    differs from the plain calculation whenever the level fell into the start bar;
  * the door accepts the shape as built;
  * the instruction's sentences.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import math
from zoneinfo import ZoneInfo

import pytest

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

WARMUP = 900


def series(name):
    return {"type": "series", "name": name}


def num(v):
    return {"type": "num", "value": v}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def back(node, k=1):
    return {"type": "offset", "value": k, "args": [node]}


NO_VALUE = op("/", num(0), num(0))
ATR = call("atr", series("high"), series("low"), series("close"), num(14))
LEVEL = op("-", series("close"), op("*", num(2), ATR))
UP_CLOSE = op("?:", op(">", series("close"), back(series("close"))), num(1), num(0))


def market(first=dt.date(2021, 1, 4), last=dt.date(2026, 11, 20)):
    """A built daily market (weekdays; a fixed walk, no vendor data), longer than the warmup."""
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
DAY = [b["t"] for b in BARS]
HIGH = [b["h"] for b in BARS]
CLOSE = [b["c"] for b in BARS]


def run(tree):
    got = ast_interpret.interpret(tree, BARS, None, None, None, {"tf": "D"})
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in got]


ATR_BY_ENGINE = run(ATR)                     # the engine's own ATR: what is under test is the START, not the ATR
LEVEL_BY_HAND = [None if a is None else c - 2 * a for a, c in zip(ATR_BY_ENGINE, CLOSE)]


def seconds_of(day):
    """The date as the number `time` holds: 00:00 in New York on that day."""
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=ZoneInfo("America/New_York")).timestamp())


def before(day):
    return op("<", series("time"), num(seconds_of(day)))


def bar_before_was_before(day):
    return op("<", back(series("time")), num(seconds_of(day)))


def starts_on(day, start, update):
    """THE SHAPE of the instructions: no value before the date, the start itself on its first bar, `self` after."""
    return op("?:", before(day), NO_VALUE, call("accum", start, op("?:", bar_before_was_before(day), start, update), num(WARMUP)))


SHAPES = {
    "stop": lambda day: starts_on(day, LEVEL, call("max", series("self"), LEVEL)),
    "high": lambda day: starts_on(day, series("high"), call("max", series("self"), series("high"))),
    "count": lambda day: starts_on(day, UP_CLOSE, op("+", series("self"), UP_CLOSE)),
}


def by_hand(kind, day):
    """A plain loop from the first bar on or after the date; nothing before it."""
    out, value = [], None
    for i in range(N):
        if DAY[i] < day or LEVEL_BY_HAND[i] is None:
            out.append(None)
            continue
        if kind == "stop":
            value = LEVEL_BY_HAND[i] if value is None else max(value, LEVEL_BY_HAND[i])
        elif kind == "high":
            value = HIGH[i] if value is None else max(value, HIGH[i])
        else:
            up = 1.0 if i > 0 and CLOSE[i] > CLOSE[i - 1] else 0.0
            value = up if value is None else value + up
        out.append(float(value))
    return out


def differ(got, want):
    return [i for i in range(N) if got[i] is not None and want[i] is not None and abs(got[i] - want[i]) > 1e-9 * max(1.0, abs(want[i]))]


def first_bar_on_or_after(day):
    return next(i for i in range(N) if DAY[i] >= day)


def a_start_the_level_fell_into(after="2026-03-01"):
    """A trading day whose level is LOWER than the day before's: where reading `self` on the start bar shows."""
    i = next(k for k in range(first_bar_on_or_after(after), N) if LEVEL_BY_HAND[k] < LEVEL_BY_HAND[k - 1] - 0.05)
    return DAY[i]


#: a trading day, a Saturday (the value starts on the Monday), and a day the level fell into
STARTS = ["2026-06-02", "2026-05-30", a_start_the_level_fell_into()]


def test_the_market_is_longer_than_the_warmup_and_the_saturday_is_one():
    assert N > WARMUP + 400
    assert dt.date.fromisoformat("2026-05-30").weekday() == 5 and "2026-05-30" not in DAY
    assert all(first_bar_on_or_after(d) > WARMUP + 100 for d in STARTS)


@pytest.mark.parametrize("day", STARTS)
@pytest.mark.parametrize("kind", ["stop", "high", "count"])
def test_the_shape_equals_a_plain_calculation_from_the_date_and_is_blank_before_it(kind, day):
    got, want = run(SHAPES[kind](day)), by_hand(kind, day)
    first = first_bar_on_or_after(day)
    assert differ(got, want) == []
    assert all(got[i] is None for i in range(first))                     # no value before the date
    assert all(got[i] is not None for i in range(first, N))              # a value on every bar from it
    assert N - first > 100


@pytest.mark.parametrize("kind,start_value", [("stop", LEVEL_BY_HAND), ("high", HIGH)])
def test_on_its_first_bar_it_is_the_starting_value_itself(kind, start_value):
    day = a_start_the_level_fell_into()
    first = first_bar_on_or_after(day)
    assert run(SHAPES[kind](day))[first] == pytest.approx(start_value[first], rel=1e-12)


def test_a_count_starts_at_its_first_number_not_above_it():
    day = "2026-06-02"
    first = first_bar_on_or_after(day)
    got = run(SHAPES["count"](day))
    assert got[first] in (0.0, 1.0)
    assert got[first] == (1.0 if CLOSE[first] > CLOSE[first - 1] else 0.0)


def test_THE_FINDING_reading_self_on_the_start_bar_carries_the_level_of_the_bar_before():
    day = a_start_the_level_fell_into()
    first = first_bar_on_or_after(day)
    # what the assistant built: the plain level before the date, max(self, level) from the date on
    as_built = call("accum", LEVEL, op("?:", before(day), LEVEL, call("max", series("self"), LEVEL)), num(WARMUP))
    got, want = run(as_built), by_hand("stop", day)
    wrong = differ(got, want)
    assert wrong and wrong[0] == first
    assert got[first] == pytest.approx(max(LEVEL_BY_HAND[first - 1], LEVEL_BY_HAND[first]), rel=1e-12)
    assert got[first] > want[first]                                       # the stop starts too high
    assert all(got[i] > want[i] for i in wrong)                           # and never too low
    assert wrong == list(range(first, first + len(wrong)))                # from the start bar until the level passes it
    # and it has a value on bars before the date, which nobody asked for
    assert sum(1 for i in range(first) if got[i] is not None) > 100


def test_the_door_accepts_the_shape_as_built(conv, clean_env, model):
    tree = SHAPES["stop"]("2026-06-02")
    ops = [{"op": "create", "name": "Stop from 2 June", "placement": "price", "outputs": [{"key": "stop", "tree": tree}]}]
    client = model([emits(env(0, ops))])
    r = conv.converse("plot a trailing stop that starts on 2 June 2026 at 2 times the 14 day ATR below the close and only ever moves up",
                      user_id="u1", view=empty_view(0), chart={"sym": "NVDA", "tf": "D"})
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert [o["tree"] for o in r["envelope"]["ops"][0]["outputs"]] == [tree]


def test_the_instructions_give_the_shape_and_forbid_self_on_the_first_bar(conv):
    prompt = conv.system_prompt()
    head = "A RUNNING VALUE THAT STARTS ON A DATE"
    assert head in prompt
    text = prompt.split(head)[1][:1500]
    for piece in ("has NO value before that date and STARTS FRESH on the first bar on or after it",
                  "on that bar it is its starting value itself, and only the bars after it read `self`",
                  "time < D ? 0 / 0 : accum(start, offset 1 of time < D ? start : update, 900)",
                  "time < D ? 0 / 0 : accum(close - 2 * atr(high, low, close, 14), offset 1 of time < D ? close - 2 * "
                  "atr(high, low, close, 14) : max(self, close - 2 * atr(high, low, close, 14)), 900)",
                  "NEVER let the first bar read `self`",
                  "carries the level of the bar BEFORE the date into the value",
                  "Do not draw the unstarted level before the date",
                  "Say in `assumptions` the date it starts on"):
        assert piece in text, piece
    # it follows the paragraph that says what a running value is
    assert prompt.index("A RUNNING VALUE reads its own previous value") < prompt.index(head)
