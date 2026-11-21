"""A total that never forgets is `cum`, and the door says where it starts.

Found by a value check, 2026-11-20. Asked for a running total with no window (on-balance volume), the assistant
built a windowed running value (`accum` over 300 bars) and named it as the total. By value that is the total's
CHANGE across 300 bars, a different line. The table has had the real thing all along: `cum(x)`, the running
total over every bar of the loaded history (the Pine lane's `ta.cum` is this same call). The assistant was never
told to use it.

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
SELF = {"type": "series", "name": "self"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
prev = lambda node: {"type": "offset", "value": 1, "args": [node]}  # noqa: E731
SIGNED_VOLUME = op("?:", op(">", CLOSE, prev(CLOSE)), VOLUME, op("?:", op("<", CLOSE, prev(CLOSE)), op("-", num(0), VOLUME), num(0)))
THE_TOTAL = call("cum", SIGNED_VOLUME)
THE_WINDOWED_ONE = call("accum", num(0), op("?:", op(">", CLOSE, prev(CLOSE)), op("+", SELF, VOLUME),
                                                  op("?:", op("<", CLOSE, prev(CLOSE)), op("-", SELF, VOLUME), SELF)), num(100))
create = lambda tree, key="obv": env(0, [{"op": "create", "name": "Net volume", "outputs": [{"key": key, "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731


def test_the_assistant_is_told_that_a_total_that_never_forgets_is_cum_and_never_an_accum(conv):
    told = conv.CONVERSE_SYSTEM_PROMPT
    assert "A TOTAL THAT NEVER FORGETS" in told
    assert "is cum(x): the running total of x over every bar of the loaded history" in told
    assert "cum(close > offset 1 of close ? volume : close < offset 1 of close ? 0 - volume : 0)" in told
    assert "It is NEVER an accum" in told and "CHANGE across the last W bars" in told
    # and it is no longer told to build the windowed one under another name
    assert "Net volume, last 300 bars" not in told


def test_the_total_is_built_in_one_call_and_the_door_says_where_it_starts(conv, clean_env, model):
    model([emits(create(THE_TOTAL))])
    r = conv.converse("a running total that adds volume on up closes and subtracts it on down closes", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, (r.get("gate"), r.get("reason"))
    notes = [a for a in r["envelope"]["assumptions"] if a.get("output") == "obv"]
    assert [a["text"] for a in notes] == [conv.RUNNING_TOTAL_NOTE]
    # marked as the door's own, ahead of anything the model said (`tests/test_note_by.py` holds the mark itself)
    marked = conv.with_running_value_notes({**create(THE_TOTAL), "assumptions": [{"text": "I took up closes as closes above the prior close."}]})
    assert marked["assumptions"][0] == {"output": "obv", "text": conv.RUNNING_TOTAL_NOTE, "by": conv.NOTE_BY} and len(marked["assumptions"]) == 2
    assert conv.check_envelope(r["envelope"], 0, EMPTY())                             # what the door returns still passes the door
    assert "first bar of the loaded history" in conv.RUNNING_TOTAL_NOTE and "bar-to-bar changes do not" in conv.RUNNING_TOTAL_NOTE


def test_the_note_follows_every_way_a_formula_enters_and_only_a_running_total(conv):
    one = {"output": "obv", "text": conv.RUNNING_TOTAL_NOTE}
    assert conv.running_total_notes(create(THE_TOTAL)) == [one]
    assert conv.running_total_notes(create(op("-", THE_TOTAL, call("sma", THE_TOTAL, num(21))))) == [one]   # inside other maths: once
    assert conv.running_total_notes(env(1, [{"op": "add_output", "key": "obv", "tree": THE_TOTAL}])) == [one]
    assert conv.running_total_notes(env(1, [{"op": "set_output_tree", "output": "obv", "tree": THE_TOTAL}])) == [one]
    # CONTROL: a windowed sum, a windowed running value and a plain average are not totals over the history
    for tree in (call("sum", SIGNED_VOLUME, num(300)), THE_WINDOWED_ONE, call("sma", CLOSE, num(20))):
        assert conv.running_total_notes(create(tree)) == [], tree
    # the windowed running value keeps ITS OWN note (the restart), and does not get this one
    (restart,) = conv.running_value_notes(create(THE_WINDOWED_ONE))
    assert "recomputed from 100 bars back" in restart["text"]
    # a total gets this note and not the restart note
    assert conv.running_value_notes(create(THE_TOTAL)) == [one]


def _bars():
    bars, price = [], 100.0
    for i in range(320):
        price *= 1 + 0.012 * math.sin(i * 0.83) + 0.005 * math.cos(i * 0.29)
        volume = 1000 + 800 * abs(math.sin(i * 1.3)) + (i % 5) * 37
        bars.append({"t": 1700000000 + 86400 * i, "o": price, "h": price * 1.01, "l": price * 0.99, "c": price, "v": volume})
    return bars


def test_THE_FINDING_cum_is_the_total_from_the_first_bar_and_the_windowed_value_is_not():
    bars = _bars()
    c, v = [b["c"] for b in bars], [b["v"] for b in bars]
    signed = [0.0] + [v[i] if c[i] > c[i - 1] else -v[i] if c[i] < c[i - 1] else 0.0 for i in range(1, len(bars))]
    total = [sum(signed[:i + 1]) for i in range(len(bars))]
    value = lambda tree, bs=bars: ast_interpret.interpret(tree, bs, {}, None, None, {"tf": "D"})  # noqa: E731
    got = value(THE_TOTAL)
    assert all(abs(got[i] - total[i]) < 1e-6 for i in range(len(bars)))               # every bar, from the first
    windowed = value(THE_WINDOWED_ONE)
    seen = [i for i in range(100, len(bars)) if windowed[i] is not None and not math.isnan(windowed[i])]
    assert len(seen) > 150 and sum(1 for i in seen if abs(windowed[i] - total[i]) > 1e-6) > len(seen) * 0.9
    # what the door's note says, by value: start the history later and the LEVEL moves, the changes do not
    later = value(THE_TOTAL, bars[60:])
    assert abs(later[100] - got[160]) > 1.0
    assert all(abs((later[i] - later[i - 1]) - (got[i + 60] - got[i + 59])) < 1e-6 for i in range(2, len(later)))
