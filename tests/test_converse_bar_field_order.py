"""THE BAR'S FIELDS IN THE ENGINE'S ORDER.

⚰️ Found 2026-11-18 in the answers on file. Every Stochastic built from the bar's fields was written
`stoch(close, high, low, 14)`: TradingView's order, where `ta.stoch` takes the source first. This
engine's functions take high, low, close and then the length. Both forms have four arguments, so no
check refused the wrong one; the read-back said "the 14-bar stochastic %K of the close, the high and
the low" as if that were the request; and the member got an oscillator that is not the Stochastic.

The door now puts the fields in the engine's order, but ONLY where the intent cannot be anything
else: the leading arguments are the bar's own fields, each exactly once. And the instructions state
the order.

Held here: which functions this covers is read from the engine's table; the mended formula IS the
textbook %K and the unmended one is not; every other way of writing the arguments is left alone.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import itertools

import pytest

from api.services import ast_interpret
from tests.test_house_indicators_values import _walk
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
H, L, C, V = S("high"), S("low"), S("close"), S("volume")
ENGINE_ORDER = call("stoch", H, L, C, num(14))
VENDOR_ORDER = call("stoch", C, H, L, num(14))


def build(*trees):
    return env(0, [{"op": "create", "name": "Stochastic", "placement": "pane",
                    "outputs": [{"key": f"line{i}", "tree": copy.deepcopy(t)} for i, t in enumerate(trees)]}])


def mended(conv, *trees):
    """(how many calls were reordered, the trees afterwards)."""
    envelope = build(*trees)
    n = conv._mend_bar_field_order(envelope)
    return n, [o["tree"] for o in envelope["ops"][0]["outputs"]]


# ═══ 1. which functions, read from the engine ════════════════════════════════

def test_the_functions_and_their_order_are_the_engines_own_table(conv):
    covered = conv.bar_field_functions()
    table = ast_interpret.TABLE["functions"]
    for name, order in covered.items():
        assert tuple(table[name]["argRoles"][:len(order)]) == order, name
    assert covered["stoch"] == ("high", "low", "close") == covered["atr"] == covered["adx"] == covered["cci"]
    assert covered["mfi"] == ("high", "low", "close", "volume") and covered["donchianUpper"] == ("high", "low")
    # a function that takes ONE series and a length has no order to get wrong, and is not covered
    assert "ema" not in covered and "rsi" not in covered and "highest" not in covered
    # every function of the table whose first arguments are bar fields IS covered (nothing typed, nothing missed)
    for name, spec in table.items():
        roles = list(spec.get("argRoles") or [])
        if len(roles) >= 2 and roles[0] in conv._BAR_FIELD_ROLES and roles[1] in conv._BAR_FIELD_ROLES:
            assert name in covered, name


# ═══ 2. the mend makes it the indicator that was asked for ═══════════════════

def test_the_mended_formula_is_the_textbook_stochastic_and_the_one_written_is_not(conv):
    bars = _walk(11, n=160)
    n, (tree,) = mended(conv, VENDOR_ORDER)
    assert n == 1 and tree == ENGINE_ORDER
    got, wrong = ast_interpret.interpret(tree, bars), ast_interpret.interpret(VENDOR_ORDER, bars)
    differ = 0
    for i in range(20, len(bars)):
        hi = max(b["h"] for b in bars[i - 13:i + 1])
        lo = min(b["l"] for b in bars[i - 13:i + 1])
        want = 100 * (bars[i]["c"] - lo) / (hi - lo)
        assert got[i] == pytest.approx(want, rel=1e-12), i
        differ += abs(wrong[i] - want) > 1e-6
    assert differ > 100                                   # CONTROL: the order it was written in is another number


def test_every_order_of_the_three_fields_becomes_the_engines(conv):
    for a, b, c in itertools.permutations((H, L, C)):
        n, (tree,) = mended(conv, call("stoch", a, b, c, num(14)))
        assert tree == ENGINE_ORDER
        assert n == (0 if (a, b, c) == (H, L, C) else 1)
    # the four of mfi, the two of a Donchian line, and a call nested inside other maths
    assert mended(conv, call("mfi", C, H, L, V, num(14)))[1] == [call("mfi", H, L, C, V, num(14))]
    assert mended(conv, call("donchianUpper", L, H, num(20)))[1] == [call("donchianUpper", H, L, num(20))]
    n, (tree, signal) = mended(conv, call("sma", call("sma", VENDOR_ORDER, num(3)), num(3)), op(">", VENDOR_ORDER, num(80)))
    assert n == 2 and tree == call("sma", call("sma", ENGINE_ORDER, num(3)), num(3)) and signal == op(">", ENGINE_ORDER, num(80))
    n, trees = mended(conv, VENDOR_ORDER, call("atr", C, H, L, num(14)))
    assert n == 2 and trees[1] == call("atr", H, L, C, num(14))


def test_anything_that_could_be_meant_is_left_exactly_as_written(conv):
    rsi = call("rsi", C, num(14))
    spy = {"type": "sym", "value": "SPY", "args": [C]}
    keep = [
        ENGINE_ORDER,                                                  # already right
        call("stoch", rsi, rsi, rsi, num(14)),                         # a Stochastic OF something: not bar fields
        call("stoch", C, C, L, num(14)),                               # a field twice: not a permutation
        call("stoch", C, H, S("open"), num(14)),                       # not the three fields it takes
        call("stoch", C, H, spy, num(14)),                             # another symbol's field
        call("stoch", C, H, S("myLevel"), num(14)),                    # a member's own setting
        call("stoch", C, call("highest", H, num(5)), L, num(14)),      # one argument is a formula
        call("stoch", L, H, {"type": "offset", "value": 1, "args": [C]}, num(14)),   # a field read one bar back is not the field
        call("ema", C, num(14)),                                       # one series and a length: nothing to reorder
        op("-", C, H),                                                 # an operator is not a function's arguments
    ]
    n, after = mended(conv, *keep)
    assert n == 0 and after == keep


# ═══ 3. the whole turn ═══════════════════════════════════════════════════════

def test_an_answer_in_the_vendors_order_builds_in_one_call_as_the_right_indicator(conv, clean_env, model):
    client = model([emits(build(call("sma", VENDOR_ORDER, num(3)), call("sma", call("sma", VENDOR_ORDER, num(3)), num(3))))])
    r = conv.converse("Add a slow stochastic with its signal line", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert conv.MEND_BAR_FIELDS in str(r["usage"]["mended"])
    k, d = (o["tree"] for o in r["envelope"]["ops"][0]["outputs"])
    assert k == call("sma", ENGINE_ORDER, num(3)) and d == call("sma", call("sma", ENGINE_ORDER, num(3)), num(3))
    # an answer already in the engine's order is not touched, and nothing is recorded
    client = model([emits(build(call("sma", ENGINE_ORDER, num(3))))])
    r = conv.converse("Add a slow stochastic", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and conv.MEND_BAR_FIELDS not in str(r["usage"]["mended"])


def test_the_instructions_state_the_order(conv):
    text = conv.system_prompt()
    assert "THE BAR'S FIELDS GO IN THIS ORDER: high, low, close (then volume for mfi), then the length" in text
    assert "stoch(high, low, close, 14) is the 14-bar stochastic %K" in text
    assert "This is NOT TradingView's order" in text
