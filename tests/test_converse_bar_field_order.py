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


# ═══ 4. what was SAVED before the mend: counted for the owner, never changed ═══════════

def saved(user_id, *trees, kind="ast"):
    """A stored row as `user_definitions` serves one: one formula, or several by output key."""
    compute = {"kind": kind, "ast": copy.deepcopy(trees[0])} if len(trees) == 1 else \
        {"kind": kind, "trees": {f"line{i}": copy.deepcopy(t) for i, t in enumerate(trees)}}
    return {"user_id": user_id, "definition": {"compute": compute}}


def test_reading_which_calls_are_out_of_order_does_not_touch_the_formula(conv):
    tree = call("sma", copy.deepcopy(VENDOR_ORDER), num(3))
    before = copy.deepcopy(tree)
    assert conv.misordered_bar_fields(tree) == ["stoch"] and tree == before
    assert conv.misordered_bar_fields(ENGINE_ORDER) == []
    assert conv.reorder_bar_fields(tree) == ["stoch"] and tree == call("sma", ENGINE_ORDER, num(3))     # the mend's half does


def test_the_weekly_report_counts_saved_indicators_that_carry_it_and_changes_none():
    from api.services import indicator_telemetry as tel
    rows = [
        saved("m1", call("sma", VENDOR_ORDER, num(3)), call("sma", call("sma", VENDOR_ORDER, num(3)), num(3))),   # one indicator, two lines
        saved("m1", call("atr", C, H, L, num(14))),
        saved("m2", VENDOR_ORDER),
        saved("m3", VENDOR_ORDER),
        saved("m3", ENGINE_ORDER),                                   # right: not counted
        saved("m4", call("ema", C, num(20))),                        # nothing to do with it
        saved("m5", VENDOR_ORDER, kind="pine"),                      # a script is not a formula of this kind
        saved("boss", VENDOR_ORDER),                                 # a builder's own
    ]
    kept = copy.deepcopy(rows)
    got = tel.bar_field_order_block(rows, lambda uid: uid == "boss")
    assert got == {"read": True, "saved_indicators_looked_at": 8, "members": 3, "indicators": 4,
                   "by_function": {"atr": 1, "stoch": 3}, "builders_indicators": 1}
    assert rows == kept                                              # ⛔ a count, never a correction
    # one or two members: the numbers are withheld, and that some exist is still said
    few = tel.bar_field_order_block(rows[:3], lambda uid: False)
    assert few["members"] == tel.FEWER and few["indicators"] is None and few["by_function"] is None
    # none at all is a plain zero
    none = tel.bar_field_order_block([saved("m4", ENGINE_ORDER)], lambda uid: False)
    assert none["members"] == 0 and none["indicators"] == 0 and none["builders_indicators"] == 0


def test_a_store_that_cannot_be_read_is_said_and_is_never_a_zero(monkeypatch):
    from api.services import indicator_telemetry as tel, user_definitions

    def broken():
        raise RuntimeError("the store is locked")
    monkeypatch.setattr(user_definitions, "live_definitions", broken)
    assert tel._bar_field_order() == {"read": False}
    text = tel.weekly_report_text({**_empty_report(tel), "bar_field_order": {"read": False}})
    assert "Could not be read this time. This is not a zero." in text
    # CONTROL: a store that reads says its numbers
    monkeypatch.setattr(user_definitions, "live_definitions", lambda: [saved("m1", VENDOR_ORDER), saved("m2", VENDOR_ORDER), saved("m3", VENDOR_ORDER)])
    monkeypatch.setattr("api.services.auth_service.get_user_by_id", lambda uid: {"role": "member"})
    block = tel._bar_field_order()
    assert block["read"] is True and block["members"] == 3 and block["indicators"] == 3
    text = tel.weekly_report_text({**_empty_report(tel), "bar_field_order": block})
    assert "3 saved indicators of 3 members; stoch: 3" in text and "nothing is changed" in text
    few = tel.weekly_report_text({**_empty_report(tel), "bar_field_order": tel.bar_field_order_block([saved("m1", VENDOR_ORDER)], lambda u: False)})
    assert "fewer than 3 members have one" in few


def _empty_report(tel):
    """The smallest report `weekly_report_text` reads, so the new section's words can be read alone."""
    block = {"built": 0, "questions": 0, "asked_by_the_door": 0, "asked_by_the_assistant": 0, "questions_per_built": None,
             "built_from_memory": 0, "by_question": {}}
    failed = {"turns": 0, "members_turns": 0, "builders_turns": 0}
    return {"window_days": 7, "questions": {"this": block, "previous": block},
            "internal_error": {"this": failed, "previous": failed},
            "names": {"asked_for": [], "held_and_refused": [], "not_in_the_catalogue": {"members": 0, "builders_turns": 0}},
            "named_built": [], "built_from_an_acronym": [], "demand": {"ranked": []},
            "second_calls": {"repair_rate": None, "repair_gates": {}, "browser_refusals": {}}}

