"""A reading is never compared with itself: a rank against today's value is built with percentrank.

Found by a value check, 2026-11-20. Asked where today's value ranks among the last N bars, the model counted
``x > x`` inside a window (once plainly, once as ``barsAgo(x, 0, N) > x``). Inside a window each series is read
at its own bar, so that is never true and the rank read 1 on every bar.

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
back = lambda node, n: {"type": "offset", "value": n, "args": [node]}  # noqa: E731
count_of = lambda cond, n: call("sum", op("?:", cond, num(1), num(0)), num(n))  # noqa: E731
AS_BUILT_FIRST = op("+", num(1), count_of(op(">", VOLUME, VOLUME), 20))
AS_BUILT_SECOND = op("+", num(1), count_of(op(">", call("barsAgo", VOLUME, num(0), num(20)), VOLUME), 20))
AS_ASKED = op("-", num(20), op("/", op("*", call("percentrank", VOLUME, num(19)), num(19)), num(100)))
create = lambda tree: env(0, [{"op": "create", "name": "Volume rank", "outputs": [{"key": "rank", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731


def test_the_mistake_costs_the_repair_and_the_note_says_how_to_rank_against_today(conv, clean_env, model):
    client = model([emits(create(AS_BUILT_SECOND)), emits(create(AS_ASKED))])
    r = conv.converse("the rank of today's volume among the last 20 bars, 1 for the highest", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 2
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:reference]")
    assert "ITSELF" in note and "percentrank(x, N - 1) * (N - 1) / 100" in note and "`a > b`" in note


def test_twice_is_refused_and_never_reaches_the_browser(conv, clean_env, model):
    model([emits(create(AS_BUILT_FIRST)), emits(create(AS_BUILT_SECOND))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "envelope:reference"


def test_each_shape_of_the_mistake_is_seen(conv, clean_env, model):
    sma20 = call("sma", CLOSE, num(20))
    shapes = [
        AS_BUILT_FIRST,                                                               # x > x, plainly
        AS_BUILT_SECOND,                                                              # 0 bars back is this bar
        count_of(op("<", VOLUME, back(VOLUME, 0)), 20),                               # an offset of 0, the other way round
        count_of(op(">=", CLOSE, CLOSE), 50),                                         # "at or above": always true
        count_of(op("<=", call("barsAgo", CLOSE, num(0), num(50)), back(CLOSE, 0)), 50),
        op(">", sma20, call("sma", CLOSE, num(20))),                                  # any reading, not only a series
        op("?:", op(">", CLOSE, CLOSE), CLOSE, VOLUME),                               # outside a window too
    ]
    for tree in shapes:
        model([emits(create(tree)), emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is False and r["gate"] == "envelope:reference", tree


def test_CONTROL_what_is_not_the_mistake_passes_first_time(conv, clean_env, model):
    fine = [
        AS_ASKED,
        count_of(op(">", VOLUME, back(VOLUME, 1)), 20),                               # against the bar before: two readings
        count_of(op(">", call("barsAgo", VOLUME, num(1), num(20)), VOLUME), 20),      # 1 bar back is another bar
        op(">", CLOSE, call("sma", CLOSE, num(20))),
        op(">", call("sma", CLOSE, num(10)), call("sma", CLOSE, num(20))),            # the same function, another length
        op("?:", op("==", CLOSE, CLOSE), CLOSE, VOLUME),                              # "is this a number": left alone
        op("?:", op("!=", VOLUME, VOLUME), CLOSE, VOLUME),
    ]
    for tree in fine:
        model([emits(create(tree))])
        r = conv.converse("x", user_id="u1", view=EMPTY())
        assert r["ok"] is True and r["attempts"] == 1, (tree, r.get("gate"), r.get("reason"))


def test_the_assistant_is_told_how_to_rank_and_what_a_windowed_running_total_is(conv):
    told = conv.CONVERSE_SYSTEM_PROMPT
    assert "volume > volume compares each bar with itself and is never true" in told
    assert "20 - percentrank(volume, 19) * 19 / 100" in told
    # a total that never forgets is not what a windowed running value gives, and is not named as one
    assert "A TOTAL THAT NEVER FORGETS" in told and "CHANGE across the last W bars" in told


def _bars():
    bars, price = [], 100.0
    for i in range(260):
        price *= 1 + 0.013 * math.sin(i * 0.9) + 0.004 * math.cos(i * 0.37)
        volume = 1000 + 900 * abs(math.sin(i * 1.7)) + 400 * abs(math.cos(i * 0.31)) + (i % 7) * 13
        bars.append({"t": 1700000000 + 86400 * i, "o": price, "h": price * 1.01, "l": price * 0.99, "c": price, "v": volume})
    return bars


def test_THE_FINDING_the_self_comparison_reads_1_on_every_bar_and_percentrank_is_the_rank():
    """By value, on bars where the rank moves: both built forms read 1 everywhere; the told form is the rank."""
    bars = _bars()
    v = [b["v"] for b in bars]
    want = {i: 1 + sum(1 for k in range(i - 19, i + 1) if v[k] > v[i]) for i in range(19, len(bars))}
    assert len(set(want.values())) > 10                                               # (the rank really moves here)
    value = lambda tree: ast_interpret.interpret(tree, bars, {}, None, None, {"tf": "D"})  # noqa: E731
    for wrong in (AS_BUILT_FIRST, AS_BUILT_SECOND):
        got = value(wrong)
        assert all(got[i] == 1 for i in want), "the mistake reads 1 on every bar"
    got = value(AS_ASKED)
    seen = [i for i in want if got[i] is not None and not math.isnan(got[i])]
    assert len(seen) >= len(want) - 1
    assert all(abs(got[i] - want[i]) < 1e-9 for i in seen)


def test_THE_FINDING_a_windowed_running_total_is_the_change_of_the_total_not_the_total():
    bars = _bars()
    c, v = [b["c"] for b in bars], [b["v"] for b in bars]
    signed = [0.0] + [v[i] if c[i] > c[i - 1] else -v[i] if c[i] < c[i - 1] else 0.0 for i in range(1, len(bars))]
    total = [sum(signed[:i + 1]) for i in range(len(bars))]
    step = op("?:", op(">", CLOSE, back(CLOSE, 1)), op("+", {"type": "series", "name": "self"}, VOLUME),
              op("?:", op("<", CLOSE, back(CLOSE, 1)), op("-", {"type": "series", "name": "self"}, VOLUME), {"type": "series", "name": "self"}))
    got = ast_interpret.interpret(call("accum", num(0), step, num(100)), bars, {}, None, None, {"tf": "D"})
    seen = [i for i in range(100, len(bars)) if got[i] is not None and not math.isnan(got[i])]
    assert len(seen) > 100
    assert all(abs(got[i] - (total[i] - total[i - 100])) < 1e-6 for i in seen)        # the CHANGE across the window
    assert sum(1 for i in seen if abs(got[i] - total[i]) > 1e-6) > len(seen) * 0.9    # and not the total itself
