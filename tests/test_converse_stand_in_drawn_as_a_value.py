"""A stand-in number is never drawn as a value: the highest or lowest of only some bars is no value when none qualify.

Found by a value check, 2026-11-20. To leave bars out of ``highest`` / ``lowest`` they are given a number that
cannot win (0, or a huge one). On a bar whose window holds no qualifying bar that number IS the answer. Compared
with something it is harmless; drawn, it is a price of 0 or a line at a million billion.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import math

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CLOSE = {"type": "series", "name": "close"}
LOW = {"type": "series", "name": "low"}
VOLUME = {"type": "series", "name": "volume"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
prev = lambda node: {"type": "offset", "value": 1, "args": [node]}  # noqa: E731
DOWN_DAY = op("<", CLOSE, prev(CLOSE))
BIG = num(1000000000000000)
NO_VALUE = op("/", num(0), num(0))
LOWEST_DOWN_LOW = call("lowest", op("?:", DOWN_DAY, LOW, BIG), num(4))
ANY_DOWN = op(">", call("sum", op("?:", DOWN_DAY, num(1), num(0)), num(4)), num(0))
AS_ASKED = op("?:", ANY_DOWN, LOWEST_DOWN_LOW, NO_VALUE)
create = lambda tree: env(0, [{"op": "create", "name": "Down-day low", "outputs": [{"key": "low4", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731


def test_the_drawn_stand_in_costs_the_repair_and_the_note_says_how_to_make_it_no_value(conv, clean_env, model):
    client = model([emits(create(LOWEST_DOWN_LOW)), emits(create(AS_ASKED))])
    r = conv.converse("the lowest low among the down days of the last 4 bars", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 2
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:stand-in-drawn]")
    assert "lowest" in note and "1e+15" in note and "sum(cond ? 1 : 0, N) > 0" in note and "0 / 0" in note


def test_twice_is_refused_and_never_reaches_the_browser(conv, clean_env, model):
    model([emits(create(LOWEST_DOWN_LOW)), emits(create(LOWEST_DOWN_LOW))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "envelope:stand-in-drawn"


def test_each_shape_of_the_mistake_is_seen(conv, clean_env, model):
    busy = op(">", VOLUME, call("sma", VOLUME, num(50)))
    shapes = [
        LOWEST_DOWN_LOW,
        call("highest", op("?:", busy, CLOSE, num(0)), num(30)),                     # 0 as the stand-in, drawn
        call("highest", op("?:", busy, num(0), CLOSE), num(30)),                     # the stand-in in the other branch
        op("-", CLOSE, LOWEST_DOWN_LOW),                                             # used in arithmetic
        prev(LOWEST_DOWN_LOW),                                                       # behind an offset
        call("sma", LOWEST_DOWN_LOW, num(5)),                                        # fed to another window
        call("lowest", op("?:", DOWN_DAY, LOW, op("u-", num(1))), num(4)),           # any literal, behind a minus too
    ]
    for tree in shapes:
        model([emits(create(tree)), emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is False and r["gate"] == "envelope:stand-in-drawn", tree


def test_CONTROL_what_is_not_the_mistake_passes_first_time(conv, clean_env, model):
    macd = op("-", call("ema", CLOSE, num(12)), call("ema", CLOSE, num(26)))
    fine = [
        AS_ASKED,                                                                    # no value when none qualify
        op("<", CLOSE, LOWEST_DOWN_LOW),                                             # only compared
        op("&&", op(">", CLOSE, prev(CLOSE)), op(">", VOLUME, prev(call("highest", op("?:", DOWN_DAY, VOLUME, num(0)), num(10))))),
        call("highest", op("?:", op(">", macd, num(0)), macd, num(0)), num(20)),     # a clamp: a real number on every bar
        call("lowest", op("?:", op("<", num(0), macd), num(0), macd), num(20)),      # the same clamp, written the other way
        call("highest", op("?:", DOWN_DAY, LOW, CLOSE), num(10)),                    # both branches real: nothing stands in
        call("sum", op("?:", DOWN_DAY, VOLUME, num(0)), num(10)),                    # a sum: 0 IS the answer when none qualify
        call("lowest", LOW, num(10)),
    ]
    for tree in fine:
        model([emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is True and r["attempts"] == 1, (tree, r.get("gate"), r.get("reason"))


def test_the_assistant_is_told_what_the_guard_enforces_and_the_two_neighbouring_conventions(conv):
    told = conv.CONVERSE_SYSTEM_PROMPT
    assert "STAND-IN, never an answer" in told
    assert "sum(cond ? 1 : 0, N) > 0 ? lowest(cond ? low : 1000000000000000, N) : 0 / 0" in told
    # an average of only some bars of the last N (it has no stand-in), and a count of bars since
    assert "sum(cond ? x : 0, N) / sum(cond ? 1 : 0, N)" in told
    assert "barssince(cond, 500), not 50" in told


def _bars():
    """Made-up daily bars with a stretch of rising closes longer than the window (no down day in it)."""
    out = []
    for i in range(60):
        c = 100.0 + i if 20 <= i < 32 else 100.0 + (20 if i >= 32 else 0) + (3 - i % 4 if i % 2 else i % 3)
        out.append({"t": f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000.0 + i})
    return out


def test_THE_FINDING_the_stand_in_is_the_answer_where_none_qualify_and_the_guarded_form_is_no_value():
    bars = _bars()
    closes = [b["c"] for b in bars]
    run = lambda tree: ast_interpret.interpret(tree, bars, {}, None, None, {"tf": "D"})  # noqa: E731
    drawn, guarded = run(LOWEST_DOWN_LOW), run(AS_ASKED)
    none_qualify = [i for i in range(5, len(bars)) if not any(closes[k] < closes[k - 1] for k in range(i - 3, i + 1))]
    some_qualify = [i for i in range(5, len(bars)) if i not in none_qualify]
    assert len(none_qualify) >= 5 and len(some_qualify) >= 20, "the fixture no longer has both kinds of bar"
    for i in none_qualify:
        assert drawn[i] == 1000000000000000.0, i                          # the stand-in, as a "low"
        assert guarded[i] is None or (isinstance(guarded[i], float) and math.isnan(guarded[i])), (i, guarded[i])
    for i in some_qualify:
        want = min(bars[k]["l"] for k in range(i - 3, i + 1) if closes[k] < closes[k - 1])
        assert drawn[i] == want and guarded[i] == want, i


def test_THE_FINDING_a_count_of_bars_since_stops_at_its_window():
    """`barssince(cond, N)` answers N when the condition was not true within N bars (the engine's own
    convention). With the event's own length as N the line stops there: 12 bars after the event it still reads 5."""
    bars = _bars()
    event = op("<", CLOSE, prev(CLOSE))
    run = lambda n: ast_interpret.interpret(call("barssince", event, num(n)), bars, {}, None, None, {"tf": "D"})  # noqa: E731
    short, long_ = run(5), run(500)
    i = 31                                                                # the 12th bar of the rising stretch
    closes = [b["c"] for b in bars]
    truly = next(k for k in range(0, i + 1) if closes[i - k] < closes[i - k - 1])
    assert truly > 5 and short[i] == 5 and long_[i] == truly
