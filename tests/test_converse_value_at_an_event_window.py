"""`valuewhen(cond, value, 1)` reads only this bar, and is refused at the door by name.

Found by a value check, 2026-11-21. Asked for the year to date change, the assistant read "the prior year's
last close" through a `valuewhen` window of ONE bar. The window is how far back the call looks for the most
recent bar where the condition was true; with 1 that is this bar or nothing. The line had a value only where
the condition was true and was blank on every bar after the event it was meant to remember, under a reply
describing a held level.

The door now refuses a literal window below 2 and tells the assistant why (one repair turn; a second miss
never reaches the browser). Written honestly the same formula is ``cond ? value : 0 / 0``, which passes, so
no request is lost.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import math

from api.services import ast_interpret, ast_table
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
SURGE = op(">", VOLUME, op("*", num(2), call("sma", VOLUME, num(50))))
NO_VALUE = op("/", num(0), num(0))
held = lambda window: call("valuewhen", SURGE, CLOSE, window)  # noqa: E731
AS_WRITTEN = held(num(1))
AS_ASKED = held(num(500))
create = lambda tree: env(0, [{"op": "create", "name": "Surge close", "outputs": [{"key": "level", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731
WORDS = "hold the close of the last bar with volume over twice its 50 day average"


def test_a_window_of_one_costs_the_repair_and_the_note_says_what_the_window_is(conv, clean_env, model):
    client = model([emits(create(AS_WRITTEN)), emits(create(AS_ASKED))])
    r = conv.converse(WORDS, user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 2
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == AS_ASKED          # what reached the browser is the repaired one
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:event-window]")
    for piece in ("`valuewhen` is given a window of 1 bar", "looks BACK", "reads only the bar itself", "NO VALUE on every bar after it",
                  "reaches back past that event", "cond ? value : 0 / 0"):
        assert piece in note, piece


def test_twice_is_refused_and_never_reaches_the_browser(conv, clean_env, model):
    model([emits(create(AS_WRITTEN)), emits(create(AS_WRITTEN))])
    r = conv.converse(WORDS, user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "envelope:event-window"
    assert "envelope" not in r or not r.get("envelope")


def test_each_place_the_mistake_can_sit_is_seen(conv, clean_env, model):
    shapes = [
        AS_WRITTEN,
        op("/", op("-", CLOSE, AS_WRITTEN), AS_WRITTEN),                              # inside arithmetic, twice (the finding's own shape)
        op(">", CLOSE, held(num(1))),                                                  # inside a comparison
        call("sma", held(num(1)), num(10)),                                            # inside another window
        held(num(0)),                                                                  # no bars at all
        op("?:", SURGE, CLOSE, held(num(1))),                                          # in one arm of a choice
    ]
    for tree in shapes:
        model([emits(create(tree)), emits(create(tree))])
        r = conv.converse(WORDS, user_id="u1", view=EMPTY())
        assert r["ok"] is False and r["gate"] == "envelope:event-window", tree
    # and in a colour state's condition, not only an output
    coloured = env(0, [{"op": "create", "name": "x", "outputs": [{"key": "c", "tree": CLOSE}]},
                       {"op": "set_color_states", "output": "c", "states": [{"when": op(">", CLOSE, held(num(1))), "color": "#22c55e"}]}])
    model([emits(coloured), emits(coloured)])
    r = conv.converse(WORDS, user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] in ("envelope:event-window", "envelope:schema"), r.get("gate")


def test_CONTROL_what_is_not_the_mistake_passes_first_time(conv, clean_env, model):
    fine = [
        AS_ASKED,                                                         # a window that reaches back
        held(num(2)),                                                     # the smallest window that can look back at all
        held(num(252)),
        op("?:", SURGE, CLOSE, NO_VALUE),                                 # the honest spelling of "only on those bars"
        call("barssince", SURGE, num(500)),                               # another call: not this guard's
        call("sma", CLOSE, num(1)),                                       # a 1-bar window of an ordinary average is the bar itself, and says so
    ]
    for tree in fine:
        model([emits(create(tree))])
        r = conv.converse(WORDS, user_id="u1", view=EMPTY())
        assert r["ok"] is True and r["attempts"] == 1, (tree, r.get("gate"), r.get("reason"))


def test_the_guard_names_the_tables_own_call_and_its_last_argument_is_the_window(conv):
    spec = ast_table.TABLE[ast_table.FUNCTIONS_SECTION][conv._VALUE_AT_AN_EVENT]
    assert list(spec["argRoles"]) == ["condition", "source", "period"] and spec["lookback"] == "arg2"
    assert "the most recent of the last {2} bars" in spec["sentence"]
    assert conv._SMALLEST_WINDOW_THAT_LOOKS_BACK == 2


def _bars(n=400):
    """Made-up daily bars with a volume surge every 40 bars."""
    out = []
    for i in range(n):
        c = 100 + 10 * math.sin(i / 9.0) + i * 0.05
        out.append({"t": 1_700_000_000 + i * 86400, "o": c - 0.3, "h": c + 1.0, "l": c - 1.0, "c": c, "v": 5_000_000.0 if i % 40 == 39 else 1_000_000.0})
    return out


def test_THE_FINDING_a_window_of_one_is_a_blank_between_events_and_the_engine_says_so():
    bars = _bars()
    run = lambda tree: ast_interpret.interpret(tree, bars)  # noqa: E731
    known = lambda v: v is not None and not (isinstance(v, float) and math.isnan(v))  # noqa: E731
    surge = [bool(x) and known(x) for x in run(SURGE)]
    events = [i for i, s in enumerate(surge) if s]
    assert len(events) >= 8 and events[1] - events[0] == 40
    one, asked, honest = run(AS_WRITTEN), run(AS_ASKED), run(op("?:", SURGE, CLOSE, NO_VALUE))
    # a window of 1: a value on the event bars and nowhere else, which is exactly the honest "choice" spelling
    assert [i for i, v in enumerate(one) if known(v)] == events
    assert all((known(a) and known(b) and a == b) or (not known(a) and not known(b)) for a, b in zip(one, honest))
    # as asked: the level is HELD from each event to the next
    first = events[0]
    assert all(known(v) for v in asked[first:])
    for i in range(first, len(bars)):
        last_event = max(e for e in events if e <= i)
        assert asked[i] == bars[last_event]["c"], i
    # so between events the two differ on every bar: one is blank, the other holds the level
    between = [i for i in range(first, len(bars)) if i not in events]
    assert len(between) > 300 and all(not known(one[i]) and known(asked[i]) for i in between)
