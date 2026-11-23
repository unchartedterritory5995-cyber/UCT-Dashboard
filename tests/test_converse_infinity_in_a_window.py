"""A division by zero written to mean "infinity" inside a look-back window is refused at the door.

Found by a value check, 2026-11-20. For the lowest of only some bars in a window, a formula of the shape
``lowest(close > offset 1 of close ? volume : 1 / 0, 10)`` gives the other bars "infinity". Here a division
by zero is no value, and ``lowest`` skips a bar with no value and reads further back for one, so that
formula answers the lowest volume of the last 10 bars THAT QUALIFY: a different number from the qualifying
bars among the last 10 wherever they are sparse.

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
VOLUME = {"type": "series", "name": "volume"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
prev = lambda node: {"type": "offset", "value": 1, "args": [node]}  # noqa: E731
UP_DAY = op(">", CLOSE, prev(CLOSE))
INFINITY = op("/", num(1), num(0))
NO_VALUE = op("/", num(0), num(0))
BIG = num(1000000000000000)
only_up = lambda other: op("?:", UP_DAY, VOLUME, other)  # noqa: E731
AS_WRITTEN = op("<", VOLUME, prev(call("lowest", only_up(INFINITY), num(10))))
AS_ASKED = op("<", VOLUME, prev(call("lowest", only_up(BIG), num(10))))
create = lambda tree: env(0, [{"op": "create", "name": "Quiet volume", "outputs": [{"key": "quiet", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731


def test_the_infinity_form_costs_the_repair_and_the_note_says_what_a_window_does(conv, clean_env, model):
    client = model([emits(create(AS_WRITTEN)), emits(create(AS_ASKED))])
    r = conv.converse("volume below the lowest up day volume of the last 10 days", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 2
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:infinity-in-a-window]")
    assert "lowest" in note and "NO VALUE" in note and "looks further BACK" in note and "1000000000000000" in note


def test_twice_is_refused_and_never_reaches_the_browser(conv, clean_env, model):
    model([emits(create(AS_WRITTEN)), emits(create(AS_WRITTEN))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "envelope:infinity-in-a-window"


def test_each_shape_of_the_mistake_is_seen(conv, clean_env, model):
    neg = lambda v: op("u-", num(v))  # noqa: E731
    shapes = [
        AS_WRITTEN,
        call("highest", op("?:", UP_DAY, VOLUME, op("/", neg(1), num(0))), num(10)),         # minus infinity, for highest
        call("lowest", op("?:", UP_DAY, VOLUME, op("/", num(1000000), num(0))), num(10)),    # any nonzero number over zero
        call("sma", op("?:", UP_DAY, VOLUME, INFINITY), num(20)),                            # an average skips it too
        call("sum", op("+", op("?:", UP_DAY, VOLUME, INFINITY), num(0)), num(20)),           # nested inside arithmetic
        call("lowest", op("?:", UP_DAY, VOLUME, op("/", num(1), neg(0))), num(10)),          # a literal zero behind a minus
    ]
    for tree in shapes:
        model([emits(create(tree)), emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is False and r["gate"] == "envelope:infinity-in-a-window", tree


def test_CONTROL_what_is_not_the_mistake_passes_first_time(conv, clean_env, model):
    fine = [
        AS_ASKED,                                                         # a number that cannot win
        op("<", VOLUME, prev(call("lowest", only_up(NO_VALUE), num(10)))),    # "the last 10 up days": a real request
        op(">", VOLUME, prev(call("highest", op("?:", UP_DAY, num(0), VOLUME), num(10)))),   # 0 for the bars to leave out
        op("?:", UP_DAY, VOLUME, INFINITY),                               # no window reads it: a blank, as drawn
        op("/", CLOSE, call("lowest", CLOSE, num(10))),                   # a real division
        # a window of its own inside another: the inner one is judged on its own, and reads no infinity
        op("<", VOLUME, call("highest", call("lowest", only_up(BIG), num(5)), num(10))),
        call("ema", op("?:", UP_DAY, VOLUME, INFINITY), num(10)),         # not a look-back window (it carries its value)
    ]
    for tree in fine:
        model([emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is True and r["attempts"] == 1, (tree, r.get("gate"), r.get("reason"))


def test_the_guard_covers_exactly_the_windows_the_engine_says_look_back(conv):
    """Read from the engine's own table, so a window that changes how it treats a bar with no value moves the
    guard with it."""
    windows = conv._windows_that_look_back()
    assert {"lowest", "highest", "sma", "sum"} <= windows
    assert windows == {n for n, p in ast_interpret.WINDOW_NA.items() if p in (ast_interpret.NA_SKIP, ast_interpret.NA_FINITE)}
    assert "dev" not in windows                                           # a clean N-bar window: nothing to look back past


def test_THE_FINDING_the_two_forms_are_different_numbers_and_the_engine_says_so():
    """The engine's own interpreter, on made-up bars where up days are far apart: the form as written answers
    from up days OUTSIDE the last 10 bars; the form as asked does not."""
    bars = []
    for i in range(80):
        up = i % 7 == 0                                                   # one up day in seven
        c = 100.0 + (i // 7) * 1.0 + (0.5 if up else -0.01 * (i % 7))
        bars.append({"t": f"2026-01-{1 + i % 28:02d}", "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000.0 + i * 10 + (5000 if up else 0)})
    for i, b in enumerate(bars):
        b["t"] = f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}"
    low = lambda other: ast_interpret.interpret(call("lowest", only_up(other), num(10)), bars, {}, None, None, {"tf": "D"})  # noqa: E731
    written, asked = low(INFINITY), low(BIG)
    closes = [b["c"] for b in bars]
    vols = [b["v"] for b in bars]
    ups = [i for i in range(1, len(bars)) if closes[i] > closes[i - 1]]
    differ = 0
    for i in range(70, 80):
        in_window = [vols[k] for k in range(i - 9, i + 1) if k in ups]
        last_ten = [vols[k] for k in ups if k <= i][-10:]
        assert asked[i] == (min(in_window) if in_window else 1000000000000000.0), i
        assert written[i] == min(last_ten), i
        differ += written[i] != asked[i]
    assert differ == 10, "the two forms agreed on these bars: the fixture no longer shows the finding"
    assert not any(isinstance(x, float) and math.isinf(x) for x in written)


def test_the_assistant_is_told_the_convention_the_guard_enforces(conv):
    """The guard catches the mistake after a call was paid for; the instruction is what makes the first answer
    right. Both name the same way through, so they cannot drift apart unnoticed."""
    told = conv.CONVERSE_SYSTEM_PROMPT
    assert "look further back" in told and "there is no infinity here" in told
    assert "lowest(close > offset 1 of close ? volume : 1000000000000000, 10)" in told
    # and when no value IS right, the assistant is told to say so
    assert "the last N bars that qualify" in told and "reaches back past other bars" in told
