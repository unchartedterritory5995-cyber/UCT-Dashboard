"""The regular session's own values can be built through Create Indicator.

Found by the exploratory round on production, 2026-11-17 (Indicators backlog 54): asked for "the
high and low of the first 30 minutes of the day", the assistant could only write a clock condition
over a fixed number of bars, right on one chart timeframe and wrong on every other. The engine now
holds `sessionOpen()`, `sessionHigh()`, `sessionLow()`, `openingRangeHigh(minutes)` and
`openingRangeLow(minutes)`.

  1. each passes the door on the first attempt, alone and inside ordinary maths;
  2. the door still refuses what it should (a computed number of minutes, a made-up sibling);
  3. the assistant is offered them (the function list is built from the table) and the
     instructions say when to use them and what never to build instead.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

num = lambda v: {"type": "num", "value": v}  # noqa: E731
ser = lambda name: {"type": "series", "name": name}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
create = lambda tree: env(0, [{"op": "create", "name": "X", "placement": "price",  # noqa: E731
                               "outputs": [{"key": "v", "tree": tree}]}])
EMPTY = lambda: empty_view(0)  # noqa: E731

BUILDS = [
    call("sessionOpen"),
    call("sessionHigh"),
    call("sessionLow"),
    call("openingRangeHigh", num(30)),
    call("openingRangeLow", num(15)),
    op(">", ser("close"), call("openingRangeHigh", num(30))),                    # a break of the range
    op("-", call("sessionHigh"), call("sessionLow")),                            # today's range so far
    op("/", op("-", ser("close"), call("sessionOpen")), call("sessionOpen")),    # change from the open
]


@pytest.mark.parametrize("tree", BUILDS, ids=["open", "high", "low", "range-high", "range-low", "break",
                                               "day-range", "from-open"])
def test_each_session_value_passes_the_door_on_the_first_attempt(conv, clean_env, model, tree):
    model([emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, r.get("gate")


REFUSED = [
    call("openingRangeHigh", call("sma", ser("close"), num(5))),     # the minutes are a literal, never a column
    call("openingRangeHigh"),                                        # and they are not optional
    call("sessionHigh", num(30)),                                    # the whole session takes nothing
    call("sessionClose"),                                            # a sibling nobody declared
    call("openingRangeMid", num(30)),
]


@pytest.mark.parametrize("tree", REFUSED, ids=["computed-minutes", "no-minutes", "extra-arg", "sessionClose",
                                                "openingRangeMid"])
def test_the_door_is_as_strict_as_it_was(conv, clean_env, model, tree):
    model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False, tree


def test_the_assistant_is_offered_them_and_told_when_to_use_them():
    from api.services import definition_conversation as dcv
    offered = json.dumps(dcv.composed_schema())
    for name in ("sessionOpen", "sessionHigh", "sessionLow", "openingRangeHigh", "openingRangeLow"):
        assert name in offered, name
    text = dcv.system_prompt()
    assert "THE REGULAR SESSION has names of its own" in text
    assert "`openingRangeHigh(minutes)` / `openingRangeLow(minutes)`" in text
    assert "NEVER build these from `hour` / `minute` and a count of bars" in text
    assert "on longer bars it is withheld and says so" in text
