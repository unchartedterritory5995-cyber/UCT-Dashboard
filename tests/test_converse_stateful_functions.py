"""SuperTrend and Parabolic SAR can be built through Create Indicator.

Found by the exploratory round on production, 2026-11-17. The vocabulary offers `supertrend`,
`supertrendDirection`, `sar` and `sarDirection`, and the door writes each as bounded recurrences
whose update reads its own previous value through a name the table declares (`self`,
`state1`..`state4`). The door's boundary gate checks every `series` name against the names the
MODEL may write, so it refused its own expansion: "SuperTrend 10, 3" cost two model calls and
ended in "couldn't produce a valid change", every time, although the assistant had called the
function correctly.

  1. each of the four functions passes the door on the first attempt;
  2. a running value's own name in the MODEL's text is still refused (bare, or in ordinary maths);
  3. so is a recurrence the model spells out itself: the gate reads what the model wrote, never
     the door's own expansion of an offered function, and it loosened nowhere;
  4. the instructions name the two as functions, with each direction's own sign, and say what to
     do with a ratcheting stop that is neither.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

num = lambda v: {"type": "num", "value": v}  # noqa: E731
ser = lambda name: {"type": "series", "name": name}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
create = lambda tree: env(0, [{"op": "create", "name": "X", "outputs": [{"key": "st", "tree": tree}]}])  # noqa: E731
EMPTY = lambda: empty_view(0)  # noqa: E731

FUNCTIONS = [
    call("supertrend", num(3), num(10)),
    call("supertrendDirection", num(3), num(10)),
    call("sar", num(0.02), num(0.2)),
    call("sarDirection", num(0.02), num(0.2)),
]


# ─── 1. the functions the vocabulary offers pass the door ────────────────────────

@pytest.mark.parametrize("tree", FUNCTIONS, ids=[t["name"] for t in FUNCTIONS])
def test_each_stateful_function_passes_the_door_on_the_first_attempt(conv, clean_env, model, tree):
    client = model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True, (r.get("gate"), r.get("reason"))
    assert r["attempts"] == 1 and len(client.calls) == 1            # no repair turn was paid for
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == tree     # stored as the call, not its expansion


def test_they_combine_with_ordinary_maths(conv, clean_env, model):
    # "close above SuperTrend": a yes/no built on the function
    tree = op(">", ser("close"), call("supertrend", num(3), num(10)))
    model([emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, r.get("gate")


# ─── 2. the name itself is still not the model's to write ────────────────────────

@pytest.mark.parametrize("tree", [
    ser("self"),                                                    # bare
    ser("state1"),
    op("+", ser("close"), ser("self")),                             # in ordinary maths
    call("sma", ser("self"), num(10)),                              # inside a function that binds nothing
], ids=["bare-self", "bare-state1", "in-maths", "in-sma"])
def test_a_running_values_own_name_outside_its_update_is_refused_by_name(conv, clean_env, model, tree):
    model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False and r["gate"] == "schema:name", r


# ─── 3. the gate reads what the MODEL wrote, and is as strict as it ever was ─────

# ⭐ 2026-11-18 -- ONE RUNNING VALUE IS THE MODEL'S TO WRITE NOW (the engine session's ruling;
# `tests/test_converse_running_value.py` holds it): `accum(seed, update, warmup)` with `self`
# inside its update. This block used to refuse that too. What it still refuses is unchanged.
STILL_REFUSED = [
    (call("accum", ser("self"), ser("close"), num(50)), "schema:name"),        # the name in a seed
    # two running values that never forget where they started (a running total of each other):
    # refused by its own gate with the way out (the shapes that settle are open, 2026-11-18)
    (call("accum2", num(1), num(50), ser("close"), ser("close"),
          op("+", ser("state1"), ser("state2")), ser("state2")), "unsupported:running-value"),
    # an offered function handed the name as an argument (it asks for numbers)
    (call("supertrend", ser("self"), num(10)), "resolve:expansion"),
]


@pytest.mark.parametrize("tree, gate", STILL_REFUSED, ids=["accum-seed", "accum2", "as-argument"])
def test_what_the_MODEL_may_not_write_of_a_recurrence_is_still_refused(conv, clean_env, model, tree, gate):
    """A `self` outside an `accum` update, a `state1` anywhere, and `accum2`..`accum4` are refused
    by name, whatever they sit inside."""
    model([emits(create(tree)), emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is False, tree
    assert r["gate"] == gate, (r["gate"], tree)


NOW_OPEN = [
    call("accum", num(0), op("+", ser("self"), ser("close")), num(50)),          # the construct the expansion writes
    op(">", ser("close"), call("accum", num(0), ser("self"), num(9))),          # buried in ordinary maths
]


@pytest.mark.parametrize("tree", NOW_OPEN, ids=["accum-update", "buried"])
def test_ONE_running_value_the_model_writes_out_itself_is_accepted(conv, clean_env, model, tree):
    """These two were refused at `schema:name` until 2026-11-18. The door now reads a `self` inside
    an `accum` update as that value's previous value, and says where the value starts."""
    model([emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, r
    assert any("bars back on every bar" in a["text"] for a in r["envelope"]["assumptions"])


def test_the_boundary_reads_the_models_text_with_offered_calls_made_plain():
    from api.services import definition_conversation as dcv
    declared = lambda name: name in ("sma", "accum")  # noqa: E731
    tree = op(">", ser("close"), call("supertrend", num(3), num(10)))
    before = copy.deepcopy(tree)
    out = dcv._offered_calls_as_plain(tree, declared)
    # the offered call becomes a plain node over the SAME arguments, so they are still checked
    assert out == op(">", ser("close"), op("+", num(3), num(10)))
    assert tree == before                                           # the caller's tree is not changed
    # an argument is kept exactly, a bad one included: the gate then refuses it by name
    assert dcv._offered_calls_as_plain(call("supertrend", ser("self"), num(10)), declared) == op("+", ser("self"), num(10))
    # a function the TABLE declares is left alone, and so is everything inside it
    kept = call("accum", num(0), op("+", ser("self"), ser("close")), num(50))
    assert dcv._offered_calls_as_plain(kept, declared) == kept
    # a name the table declares is never treated as an expansion, even if it is also offered as one
    assert dcv._offered_calls_as_plain(call("supertrend", num(3), num(10)), lambda _n: True) == call("supertrend", num(3), num(10))
    # nested offered calls, innermost too
    nested = call("kcUpper", call("supertrend", num(3), num(10)), num(20), num(2))
    assert dcv._offered_calls_as_plain(nested, declared) == op("+", op("+", num(3), num(10)), num(20), num(2))


def test_the_names_the_expansions_bind_are_the_tables_own():
    from api.services import ast_table
    from api.services import call_expansions
    single, multi = ast_table.recurrences(), ast_table.multi_states()
    assert single["accum"]["binds"] == call_expansions.ACCUM_SELF == "self"
    assert list(multi["accum4"]["binds"]) == ["state1", "state2", "state3", "state4"]
    # and none of them is a name the model is offered
    from api.services import definition_concierge as dc
    offered = set(dc.tool_schema(None)["names"]["series"])
    assert not (offered & set(ast_table.recurrence_bindings()))


# ─── 4. the instructions ─────────────────────────────────────────────────────────

def test_the_instructions_name_the_two_as_functions_with_each_directions_own_sign():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    for name in ("supertrend(factor, atrPeriod)", "supertrendDirection", "sar(step, maxStep)", "sarDirection"):
        assert f"`{name}`" in text, name
    assert "supertrend(3, 10)" in text                               # "SuperTrend 10, 3": period 10, factor 3
    # the two directions do NOT share a sign, and the instructions say each one's
    assert "-1 while the trend is UP, 1 while it is DOWN" in text
    assert "1 while the dots are under price, -1 while they are above" in text
    assert "A window is always a literal whole number" in text
    # (2026-11-18) a stop that only moves one way is a running value; only one that FLIPS sides is
    # declined. This line used to hold the sentence that said any ratchet "cannot be written".
    assert "A stop that FLIPS to the other side when price crosses it" in text and "set disposition unsupported" in text
    assert "only ever moves ONE way" in text and "is a RUNNING VALUE" in text


def test_the_signs_the_instructions_state_are_the_ones_the_expansions_compute():
    """The sentence above is a claim about `call_expansions`: read the trees and check it."""
    from api.services import call_expansions as ce
    st = ce.supertrend_trees(num(3), num(10))
    # the line is the LOWER band exactly when direction is -1: -1 is the uptrend
    value = st["value"]
    pick = value["args"][2]                                          # (unknown ? na : (direction == -1 ? lower : upper))
    assert pick["name"] == "?:" and pick["args"][0]["name"] == "=="
    minus_one = pick["args"][0]["args"][1]
    assert minus_one in (num(-1), op("u-", num(1)), {"type": "num", "value": -1})
    # Parabolic SAR seeds its trend 1 on a rising close and puts the dot at the LOW: 1 is under price
    sar = ce.sar_trees(num(0.02), num(0.2))
    assert sar is not None and set(sar) >= {"value", "direction"}


# ─── 5. a period in weeks is time; "yesterday's" is a daily value ─────────────────
#
# The same exploratory round: "Mansfield relative strength versus SPY over 52 weeks" was built
# over 52 bars of the chart (52 DAYS on a daily chart), with a note asking the member to switch
# to a weekly chart; and "yesterday's high and low" was built as the previous bar, which is the
# previous five minutes on an intraday chart. Both were disclosed, and both were not what was asked.

def test_the_instructions_say_a_period_in_weeks_is_time_and_yesterday_is_daily():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "is that much TIME, never that many bars of the chart" in text
    assert "52 bars INSIDE a `tf` W read" in text
    assert "a 52-week high is the highest of 252 daily bars" in text
    assert "Do not build it in the chart's own bars and ask the member to switch charts" in text
    assert "DAILY values: set_calculation_timeframe D" in text
    assert "`high[1]` alone is only the previous BAR" in text



# Two more from the same round (Indicators backlog 55 and 56).
#
# A request for an oscillator together with moving averages of price was built as ONE indicator on
# the price chart, so a 0-to-100 line was drawn on the price scale. And a signal comparing today
# with the highest value of "the last 10 days" was built over a window that included today, which
# compares today with nine earlier days.

def test_the_instructions_say_an_indicator_draws_in_one_place():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "An indicator draws in ONE place" in text
    assert "never put them in one placement" in text
    assert "build the part named first, where it belongs" in text
    assert "the rest is a second indicator the member can ask for next" in text


def test_the_instructions_say_the_last_n_bars_are_the_n_before_this_one():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "the window is the N bars BEFORE this one" in text
    assert "wrap it in an offset of 1" in text
    assert "A window that includes this bar compares it with itself" in text
    assert "includes this bar (close >= highest(close, N))" in text


def test_the_tree_those_instructions_describe_passes_the_door(conv, model, clean_env):
    """`volume > offset 1 of highest(volume, 10)` is a tree the door accepts on the first attempt."""
    tree = op(">", ser("volume"), {"type": "offset", "value": 1, "args": [call("highest", ser("volume"), num(10))]})
    model([emits(create(tree))])
    r = conv.converse("x", user_id="u1", view=EMPTY())
    assert r["ok"] is True and r["attempts"] == 1, r.get("gate")


# Seen on production after the fix, 2026-11-17: one SuperTrend reply in three told the member it
# is computed "as a bounded recurrence". The word came from the description the assistant is
# handed with the function list. What a member needs is the consequence, in plain words.

def test_what_the_assistant_is_told_about_supertrend_is_in_a_members_words():
    import json
    from api.services import definition_conversation as dcv
    said = json.dumps(dcv.composed_schema()) + dcv.system_prompt()
    assert "recurrence" not in said.lower()
    assert "never call them identical to TradingView" in said
    assert "where the trend has not flipped for a long time" in said
    assert "never describe how it is computed" in said
