"""SEVERAL RUNNING VALUES THAT FEED EACH OTHER, at the door: `accum2`..`accum4` with `state1`..

SEEN on production, 2026-11-18: a whole class of well-known indicators was declined because the
door offered ONE running value. Two-pole filters, Laguerre filters and Fisher-style transforms all
need two to four values replaced together, and the engine computes them. Opened by ruling for the
two shapes whose starting values PROVABLY stop mattering inside the window (the rule and its
measurements: `api/services/running_values.py`, `tests/test_running_values_coupled.py`):

  * a FILTER (every update a plain-number mix of the values), and
  * a CHAIN (each value keeps under 1 of itself, and reads earlier ones any way).

What stays refused, by name and with the way out: a ratchet, a count or a switch across several
values; values that never forget their start; a window too short to settle in; a coefficient that
is a SETTING; one running value inside another; a state name outside its own function.

AND THE SENTENCE IS TRUE OF THE ENGINE: each example is computed by the engine's own windowed
restart and compared, bar for bar, with the same formula carried from the first bar.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import math
import random

import pytest

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
back = lambda node, n: {"type": "offset", "value": n, "args": [node]}  # noqa: E731
neg = lambda node: op("u-", node)  # noqa: E731
S1, S2, S3, S4 = S("state1"), S("state2"), S("state3"), S("state4")
CLOSE = S("close")
GATE = "unsupported:running-value"
PERIOD = 10

# ── a two-pole smoother, its coefficients written as the instructions show ───
_A1 = call("exp", op("/", op("*", neg(num(1.414)), num(3.14159)), num(PERIOD)))
C2 = op("*", op("*", num(2), _A1), call("cos", op("/", op("*", num(1.414), num(3.14159)), num(PERIOD))))
C3 = neg(op("*", _A1, _A1))
C1 = op("-", op("-", num(1), C2), C3)
SMOOTHER = call("accum2", num(1), num(300), CLOSE, CLOSE,
                op("+", op("+", op("*", C1, op("/", op("+", CLOSE, back(CLOSE, 1)), num(2))), op("*", C2, S1)), op("*", C3, S2)),
                S1)


def laguerre(gamma=0.8, warmup=300):
    """Four stages; a stage that needs the one before it on THIS bar writes its update out again."""
    l0 = op("+", op("*", num(round(1 - gamma, 6)), CLOSE), op("*", num(gamma), S1))
    l1 = op("+", op("-", S1, op("*", num(gamma), l0)), op("*", num(gamma), S2))
    l2 = op("+", op("-", S2, op("*", num(gamma), l1)), op("*", num(gamma), S3))
    l3 = op("+", op("-", S3, op("*", num(gamma), l2)), op("*", num(gamma), S4))
    return call("accum4", num(4), num(warmup), CLOSE, CLOSE, CLOSE, CLOSE, l0, l1, l2, l3)


# ── a range position, smoothed, stretched with a log and smoothed again; the value fed back is CLAMPED.
# (A Fisher-style transform. NOT the Fisher Transform as published or as TradingView computes it: that
# SNAPS the fed-back value to 0.999 past 0.99, a choice on its own value, which this door refuses.)
_LO, _HI = call("lowest", S("low"), num(PERIOD)), call("highest", S("high"), num(PERIOD))
_X = op("/", op("-", op("/", op("+", S("high"), S("low")), num(2)), _LO), op("-", _HI, _LO))
_V = call("max", neg(num(0.999)), call("min", num(0.999), op("+", op("*", num(0.66), op("-", _X, num(0.5))), op("*", num(0.67), S1))))
FISHER = call("accum2", num(2), num(300), num(0), num(0), _V,
              op("+", op("*", num(0.5), call("ln", op("/", op("+", num(1), _V), op("-", num(1), _V)))), op("*", num(0.5), S2)))

SETTLING = [("a two-pole smoother", SMOOTHER, 2, 25), ("a four-stage Laguerre filter", laguerre(), 4, 82),
            ("a smoothed, stretched range position", FISHER, 2, 69)]


def create(tree, key="v", **extra):
    return {"op": "create", "name": "Running", "placement": "pane", "outputs": [{"key": key, "tree": tree}], **extra}


def _ok(conv, tree, **extra):
    return conv.check_envelope(env(0, [create(tree, **extra)]), 0, empty_view(0))


def _refused(conv, tree, **extra):
    with pytest.raises(conv._Refused) as caught:
        _ok(conv, tree, **extra)
    return caught.value


# ═══ 1. the shapes that settle are accepted, and say so themselves ═══════════

@pytest.mark.parametrize("what, tree, k, needs", SETTLING, ids=[s[0] for s in SETTLING])
def test_a_shape_that_settles_is_accepted_and_carries_the_doors_sentence(conv, what, tree, k, needs):
    answer = _ok(conv, tree)
    noted = conv.with_running_value_notes(dict(answer))
    (note,) = noted["assumptions"]
    assert note == {"output": "v", "by": "uct", "text": (
        f"This value is built from {k} linked running values that start 300 bars back on every bar. After {needs} "
        "bars their starting points no longer matter (to within 0.01% of where they started).")}
    assert conv.check_envelope(noted, 0, empty_view(0))                    # what the door returns still passes the door


def test_it_may_sit_inside_ordinary_maths_and_beside_other_outputs(conv):
    answer = env(0, [{"op": "create", "name": "Smooth", "placement": "price", "outputs": [
        {"key": "smooth", "tree": SMOOTHER},
        {"key": "gap", "tree": op("-", CLOSE, SMOOTHER)},
        {"key": "avg", "tree": call("ema", CLOSE, num(20))}]}])
    noted = conv.with_running_value_notes(dict(conv.check_envelope(answer, 0, empty_view(0))))
    assert [a["output"] for a in noted["assumptions"]] == ["smooth", "gap"]   # never the output with no running value


def test_the_sentence_goes_to_the_line_a_member_sees_before_the_hidden_working_lines(conv):
    """MEASURED on a four-stage oscillator written with hidden stages: all four notes the contract
    holds went to the hidden stages, and the one visible line had none."""
    def stage(k):
        tree = laguerre()
        tree["args"][0] = num(k)
        return tree
    outs = [{"key": f"stage{k}", "hidden": True, "tree": stage(k)} for k in (1, 2, 3, 4)]
    outs.append({"key": "line", "tree": op("-", stage(1), stage(4))})
    answer = conv.check_envelope(env(0, [{"op": "create", "name": "Stage spread", "placement": "pane", "primary": "line",
                                          "outputs": outs}]), 0, empty_view(0))
    notes = conv.running_value_notes(answer)
    assert len(notes) == conv.RUNNING_VALUE_NOTE_MAX == 4
    assert notes[0]["output"] == "line" and "4 linked running values" in notes[0]["text"]
    assert [n["output"] for n in notes[1:]] == ["stage1", "stage2", "stage3"]      # then the hidden ones, in their order
    # with nothing hidden the order is the patch's own
    for o in outs:
        o.pop("hidden", None)
    plain = conv.running_value_notes(env(0, [{"op": "create", "name": "x", "placement": "pane", "outputs": outs}]))
    assert [n["output"] for n in plain] == ["stage1", "stage2", "stage3", "stage4"]


def test_one_value_and_several_in_one_formula_get_the_stronger_sentence_when_the_one_does_not_settle(conv):
    streak = call("accum", num(0), op("?:", op(">", CLOSE, back(CLOSE, 1)), op("+", S("self"), num(1)), num(0)), num(100))
    noted = conv.with_running_value_notes(dict(_ok(conv, op("+", SMOOTHER, streak))))
    (note,) = noted["assumptions"]
    assert "so its counts and levels restart 100 bars back" in note["text"]


# ═══ 2. what stays refused, each by what it is ═══════════════════════════════

NEVER_SETTLES = [
    ("a stop that only rises, with a direction beside it",
     [call("max", S1, op("-", CLOSE, num(3))), op("?:", op(">", CLOSE, S1), num(1), neg(num(1)))]),
    ("a counter reset by another counter",
     [op("?:", op(">", S2, num(3)), num(0), op("+", S1, num(1))), op("?:", op(">", CLOSE, back(CLOSE, 1)), op("+", S2, num(1)), num(0))]),
    ("one value times the other", [op("*", op("*", num(0.5), S1), S2), op("*", num(0.5), S2)]),
    ("a coefficient that is a series", [op("+", S1, op("*", call("abs", op("-", CLOSE, back(CLOSE, 1))), op("-", CLOSE, S1))), S1]),
]


@pytest.mark.parametrize("what, updates", NEVER_SETTLES, ids=[n[0] for n in NEVER_SETTLES])
def test_a_ratchet_a_count_or_a_switch_across_several_values_is_refused_by_name(conv, what, updates):
    refused = _refused(conv, call("accum2", num(1), num(300), CLOSE, CLOSE, *updates))
    assert refused.gate == GATE and "this accum2 never settles" in refused.detail, refused.detail
    assert "ONLY as a filter" in refused.detail and "or as a chain" in refused.detail      # what IS available
    assert "disposition unsupported" in refused.detail and "ONE running value" in refused.detail   # the way out
    assert "a ratchet, a count or a switch" in refused.reason and "accum" not in refused.reason and "state" not in refused.reason


def test_a_window_too_short_to_settle_in_is_refused_with_the_number_it_needs(conv):
    short = laguerre(warmup=60)
    refused = _refused(conv, short)
    assert refused.gate == GATE
    assert "needs 82 bars for its starting values to stop mattering and its warmup is 60" in refused.detail
    assert "Set warmup to at least 82" in refused.detail
    assert "too few bars to settle" in refused.reason
    _ok(conv, laguerre(warmup=82))                                          # CONTROL: exactly enough is enough


def test_a_coefficient_that_is_a_setting_is_refused_with_what_to_write(conv):
    """The bound is read off the numbers. A setting would move it after the door had looked."""
    with_setting = call("accum2", num(1), num(300), CLOSE, CLOSE,
                        op("+", op("*", S("gamma"), S1), op("*", op("-", num(1), S("gamma")), CLOSE)), S1)
    inputs = [{"key": "gamma", "label": "Gamma", "default": 0.5, "min": 0.1, "max": 0.9}]
    refused = _refused(conv, with_setting, inputs=inputs)
    assert refused.gate == GATE and "multiplied or divided by a SETTING" in refused.detail, refused.detail
    assert "write them for the length the member asked for" in refused.detail
    assert "tied to a setting" in refused.reason
    # CONTROL: the same formula with the number written in is accepted ...
    _ok(conv, call("accum2", num(1), num(300), CLOSE, CLOSE, op("+", op("*", num(0.5), S1), op("*", num(0.5), CLOSE)), S1))
    # ... and a setting that no running value is multiplied by is an ordinary setting
    _ok(conv, call("accum2", num(1), num(300), CLOSE, CLOSE,
                   op("+", op("*", num(0.5), S1), op("*", num(0.5), call("ema", CLOSE, S("gamma")))), S1),
        inputs=[{"key": "gamma", "label": "Length", "default": 5, "min": 2, "max": 50}])


def test_one_running_value_never_sits_inside_another_whichever_kind(conv):
    inner = call("accum", CLOSE, op("+", S("self"), op("*", num(0.2), op("-", CLOSE, S("self")))), num(100))
    inside_several = call("accum2", num(1), num(300), CLOSE, CLOSE, op("+", op("*", num(0.5), S1), op("*", num(0.5), inner)), S1)
    several_inside_one = call("accum", CLOSE, op("+", S("self"), op("*", num(0.2), op("-", SMOOTHER, S("self")))), num(100))
    for tree in (inside_several, several_inside_one):
        refused = _refused(conv, tree)
        assert refused.gate == GATE and "sits inside another" in refused.detail
        assert "ONE accum2..accum4, not one inside another" in refused.detail
        assert refused.reason and "one running value sits inside another" in refused.reason


@pytest.mark.parametrize("tree, says", [
    (call("accum2", num(3), num(300), CLOSE, CLOSE, op("*", num(0.5), S1), S1), "not written as the engine reads it"),
    (call("accum2", num(1), num(300), CLOSE, CLOSE, op("*", num(0.5), S1)), "not written as the engine reads it"),
    (call("accum2", num(1), num(300), S1, CLOSE, op("*", num(0.5), S1), S1), "starting value 1 reads a running value"),
], ids=["value 3 of two", "an update missing", "a start that reads a state"])
def test_a_call_the_engine_would_not_read_is_refused_with_how_it_is_written(conv, tree, says):
    refused = _refused(conv, tree)
    assert refused.gate == GATE and says in refused.detail, refused.detail
    assert "accum2(which value to draw, warmup, the starting values, then the updates)" in refused.detail


@pytest.mark.parametrize("tree, name", [
    (op("+", SMOOTHER, S1), "state1"),                                                       # beside the function, not inside it
    (call("accum2", num(1), num(300), CLOSE, CLOSE, op("*", num(0.5), S3), S1), "state3"),   # a third value of two
    (call("accum", CLOSE, op("+", S("self"), op("*", num(0.2), op("-", S1, S("self")))), num(100)), "state1"),   # in a one-value update
])
def test_a_state_name_outside_its_own_updates_is_refused_by_name(conv, tree, name):
    refused = _refused(conv, tree)
    assert refused.gate == "schema:name" and f"'{name}'" in refused.detail, (refused.gate, refused.detail)


def test_the_whole_reach_is_still_held_to_the_lookback_cap(conv):
    slow = call("accum2", num(1), num(900), CLOSE, CLOSE,
                op("+", op("*", num(0.5), S1), op("*", num(0.5), call("sma", CLOSE, num(100)))), S1)
    refused = _refused(conv, slow)                                          # 900 + 100 bars of reach
    assert refused.gate.startswith("budget:"), refused.gate


def _view_holding(tree, key="smooth"):
    from tests.test_p2_truth_server import out as output_of, view as view_of
    return view_of(1, [output_of(key, tree, type_="series")])


def test_one_number_inside_linked_running_values_is_not_changed_on_its_own(conv):
    """The door never applies a patch, so it cannot check what a one-number edit would leave. The
    numbers of such a formula settle only as a set: the whole formula is sent again, and checked."""
    two_pole = call("accum2", num(1), num(300), CLOSE, CLOSE,
                    op("+", op("*", num(0.2), CLOSE), op("-", op("*", num(1.4), S1), op("*", num(0.6), S2))), S1)
    holding = _view_holding(op("-", CLOSE, op("*", num(2), two_pole)))
    # the path: root `-` -> 1 (`*`) -> 1 (accum2) -> 4 (update 1) -> 1 (`-`) -> 0 (`*`) -> 0 (the 1.4)
    for slot in ("smooth#1.1.4.1.0.0", "smooth#1.1.1", "smooth#1.1.0"):          # a coefficient, the warm-up, which value
        with pytest.raises(conv._Refused) as caught:
            conv.check_envelope(env(1, [{"op": "set_slot", "slot": slot, "value": 0.9}]), 1, holding)
        refused = caught.value
        assert refused.gate == GATE and f"set_slot {slot}" in refused.detail, refused.detail
        assert "send the whole formula again with set_output_tree on output 'smooth'" in refused.detail
        assert "changed on its own" in refused.reason and "accum" not in refused.reason
    # CONTROL: the multiple OUTSIDE the function is an ordinary edit ...
    conv.check_envelope(env(1, [{"op": "set_slot", "slot": "smooth#1.0", "value": 3}]), 1, holding)
    # ... a place this walk cannot follow is not its to refuse (a bars-back count; a path the view does not hold) ...
    shifted = _view_holding(op("-", back(CLOSE, 3), op("*", num(2), two_pole)))
    for slot in ("smooth#0.n", "smooth#0.0.7", "smooth#9", "nosuch#1.1.4", "smooth#root"):
        conv._refuse_edits_inside_linked(env(1, [{"op": "set_slot", "slot": slot, "value": 5}]), shifted)
    # ... a slot of another output is not looked at through this one ...
    other = _view_holding(call("ema", CLOSE, num(20)), key="avg")
    conv.check_envelope(env(1, [{"op": "set_slot", "slot": "avg#1", "value": 50}]), 1, other)
    # ... and the whole formula sent again IS checked: a version that still settles passes, one that does not is refused
    still = call("accum2", num(1), num(300), CLOSE, CLOSE,
                 op("+", op("*", num(0.3), CLOSE), op("-", op("*", num(1.2), S1), op("*", num(0.5), S2))), S1)
    conv.check_envelope(env(1, [{"op": "set_output_tree", "output": "smooth", "tree": still}]), 1, holding)
    never = call("accum2", num(1), num(300), CLOSE, CLOSE,
                 op("+", op("*", num(0.2), CLOSE), op("-", op("*", num(2.4), S1), op("*", num(0.6), S2))), S1)
    with pytest.raises(conv._Refused) as caught:
        conv.check_envelope(env(1, [{"op": "set_output_tree", "output": "smooth", "tree": never}]), 1, holding)
    assert caught.value.gate == GATE and "never forgets where it started" in caught.value.detail


# ═══ 3. through the conversation ═════════════════════════════════════════════

def test_it_is_built_in_one_call_and_carries_the_doors_note(conv, clean_env, model):
    client = model([emits(env(0, [create(SMOOTHER, "smooth")], reply="A two-pole smoother of the close."))])
    r = conv.converse("add a two pole smoother of the close, period 10", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, r.get("reason")
    (note,) = r["envelope"]["assumptions"]
    assert note["output"] == "smooth" and "2 linked running values" in note["text"] and "After 25 bars" in note["text"]


def test_asked_for_by_a_name_that_is_not_checked_yet_it_is_built_and_says_both_things(conv, clean_env, model):
    """Ruling: until a capture and a value check graduate it, a filter asked for by its well-known
    name is built with the name WITHHELD. The member reads that, and where the value starts."""
    model([emits(env(0, [{"op": "create", "name": "Two-pole smoother of the close", "placement": "price",
                          "outputs": [{"key": "smooth", "label": "Smoothed close", "tree": SMOOTHER}]}],
                     reply="A two-pole smoother of the close."))])
    r = conv.converse("add the super smoother, period 10", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1, r.get("reason")
    texts = [a["text"] for a in r["envelope"]["assumptions"]]
    assert len(texts) == 2
    assert any(t.startswith("Super Smoother is not in UCT's checked library yet") for t in texts)
    assert any("2 linked running values" in t for t in texts)


def test_a_shape_that_never_settles_is_sent_back_once_with_the_way_out(conv, clean_env, model):
    ratchet = env(0, [create(call("accum2", num(1), num(300), CLOSE, CLOSE, *NEVER_SETTLES[0][1]))])
    client = model([emits(ratchet), emits(env(0, [create(SMOOTHER)]))])
    r = conv.converse("a smoother", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == GATE
    said = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "this accum2 never settles" in said and "ONLY as a filter" in said
    model([emits(ratchet), emits(ratchet)])
    r = conv.converse("a trailing stop that flips with the trend", user_id="u2", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == GATE and "envelope" not in r
    assert "a ratchet, a count or a switch" in r["reason"] and "accum" not in r["reason"]


def test_the_instructions_say_how_show_both_shapes_and_what_stays_closed(conv):
    text = conv.system_prompt()
    assert "accumK(which, warmup, start1..startK, update1..updateK)" in text
    assert "`state1`..`stateK` are their PREVIOUS values" in text
    assert "writes that value's update out again in its place" in text
    assert "A FILTER: every update is a sum of plain-number multiples of the states" in text
    assert "A CHAIN: each update reads its OWN state only as a plain-number multiple under 1" in text
    assert "accum2(1, 300, close, close, c1 * (close + offset 1 of close) / 2 + c2 * state1 + c3 * state2, state1)" in text
    assert "accum2(2, 300, 0, 0, v, 0.5 * ln((1 + v) / (1 - v)) + 0.5 * state2)" in text
    assert "NEVER a setting" in text and "A ratchet, a count or a switch across several running values" in text
    assert "built to its PUBLISHED formula or not at all" in text
    assert text.index("A RUNNING VALUE reads") < text.index("SEVERAL RUNNING VALUES THAT FEED EACH OTHER") < text.index("AN UP DAY is")


def test_the_worked_examples_in_the_instructions_are_formulas_the_door_accepts(conv):
    """An example the door would refuse teaches the model to be refused."""
    _ok(conv, SMOOTHER)             # the two-pole smoother, coefficient for coefficient as the text writes it
    _ok(conv, FISHER)               # the stretched range position, `v` written out both times


# ═══ 4. TRUE OF THE ENGINE ═══════════════════════════════════════════════════

def _bars(n=900, seed=5):
    rng = random.Random(seed)
    out, price = [], 100.0
    for i in range(n):
        o = price
        price = max(5.0, price * (1 + rng.uniform(-0.03, 0.031)))
        hi, lo = max(o, price) * (1 + rng.uniform(0, 0.01)), min(o, price) * (1 - rng.uniform(0, 0.01))
        out.append({"t": 1_600_000_000 + i * 86_400, "o": o, "h": hi, "l": lo, "c": price, "v": 1_000_000 + rng.randint(0, 500_000)})
    return out


def _from_the_first_bar_smoother(bars):
    a1 = math.exp(-1.414 * 3.14159 / PERIOD)
    c2 = 2 * a1 * math.cos(1.414 * 3.14159 / PERIOD)
    c3 = -a1 * a1
    c1 = 1 - c2 - c3
    c = [b["c"] for b in bars]
    out = [c[0], c[1]]
    for i in range(2, len(c)):
        out.append(c1 * (c[i] + c[i - 1]) / 2 + c2 * out[i - 1] + c3 * out[i - 2])
    return out


def _from_the_first_bar_laguerre(bars, g=0.8):
    c = [b["c"] for b in bars]
    l0 = l1 = l2 = l3 = c[0]
    out = []
    for x in c:
        n0 = (1 - g) * x + g * l0
        n1 = -g * n0 + l0 + g * l1
        n2 = -g * n1 + l1 + g * l2
        n3 = -g * n2 + l2 + g * l3
        l0, l1, l2, l3 = n0, n1, n2, n3
        out.append(l3)
    return out


def _from_the_first_bar_fisher(bars):
    out, v, f = [], 0.0, 0.0
    for i in range(len(bars)):
        if i < PERIOD - 1:
            out.append(None)
            continue
        window = bars[i - PERIOD + 1:i + 1]
        lo, hi = min(b["l"] for b in window), max(b["h"] for b in window)
        x = ((bars[i]["h"] + bars[i]["l"]) / 2 - lo) / (hi - lo)
        v = max(-0.999, min(0.999, 0.66 * (x - 0.5) + 0.67 * v))
        f = 0.5 * math.log((1 + v) / (1 - v)) + 0.5 * f
        out.append(f)
    return out


# a term that reads no running value may hold a choice: the larger of the open and the close, smoothed twice
BODY_TOP = op("?:", op(">", CLOSE, S("open")), CLOSE, S("open"))
CHOICE = call("accum2", num(2), num(300), BODY_TOP, BODY_TOP,
              op("+", op("*", num(0.7), S1), op("*", num(0.3), BODY_TOP)),
              op("+", op("*", num(0.7), S2), op("*", num(0.3), op("+", op("*", num(0.7), S1), op("*", num(0.3), BODY_TOP)))))


def _from_the_first_bar_choice(bars):
    a = b = max(bars[0]["c"], bars[0]["o"])
    out = []
    for bar in bars:
        a = 0.7 * a + 0.3 * max(bar["c"], bar["o"])
        b = 0.7 * b + 0.3 * a
        out.append(b)
    return out


TRUE = [("a two-pole smoother", SMOOTHER, _from_the_first_bar_smoother, 100.0),
        ("a choice inside a term that reads no running value", CHOICE, _from_the_first_bar_choice, 100.0),
        ("a four-stage Laguerre filter", laguerre(), _from_the_first_bar_laguerre, 100.0),
        ("a smoothed, stretched range position", FISHER, _from_the_first_bar_fisher, 1.0)]


@pytest.mark.parametrize("what, tree, reference, scale", TRUE, ids=[t[0] for t in TRUE])
def test_TRUE_the_windowed_value_equals_the_same_formula_carried_from_the_first_bar(what, tree, reference, scale):
    """The door's sentence says the starting points no longer matter. Here is the engine's own
    windowed restart beside the same recurrence run once from the first bar, bar for bar."""
    bars = _bars()
    got = ast_interpret.interpret(tree, bars, {})
    want = reference(bars)
    live = [(i, g, w) for i, (g, w) in enumerate(zip(got, want))
            if g is not None and w is not None and isinstance(g, float) and math.isfinite(g) and i >= 400]
    assert len(live) > 400, what                                            # NON-VACUITY: it is not a column of holes
    worst = max(abs(g - w) for _i, g, w in live)
    assert worst <= 1e-4 * scale, (what, worst)
    # CONTROL: the comparison can fail. A window far too short to settle in does NOT match.
    import copy
    short = copy.deepcopy(tree)
    short["args"][1] = num(4)
    got_short = ast_interpret.interpret(short, bars, {})
    off = max(abs(g - w) for g, w in zip(got_short[400:], want[400:]) if g is not None and w is not None and math.isfinite(g))
    assert off > 1e-4 * scale, (what, off)


# ═══ 2026-11-18: the door refuses what the engine refuses ════════════════════

def test_a_window_of_a_running_value_is_refused_at_the_door_with_the_way_out(conv, clean_env, model):
    """⚰️ Found live: the second stage of an oscillator took the lowest and highest of the first
    stage's running value over ten bars. The door accepted it, the browser's engine refused it, and
    the request went round twice. Now the door refuses it, and the repair is told why and what to do."""
    from tests.test_running_values_coupled import _second_stage
    S1 = {"type": "series", "name": "state1"}
    bad = _second_stage({"type": "call", "name": "lowest", "args": [S1, {"type": "num", "value": 10}]})
    good = _second_stage({"type": "op", "name": "*", "args": [{"type": "num", "value": 2}, S1]})
    build = lambda tree: env(0, [{"op": "create", "name": "Two stage smoother", "placement": "pane",  # noqa: E731
                                  "outputs": [{"key": "line", "tree": tree}]}])
    client = model([emits(build(bad)), emits(build(good))])
    r = conv.converse("Smooth the close twice, the second time from the first", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 2, r
    told = str(client.calls[1]["messages"][-1]["content"])
    assert "the engine cannot compute this accum2" in told and "sits inside lowest(...)" in told
    assert "never inside a function that reads a window of bars" in told and "offer the part that can" in told
    # twice: the member is told what it needed, in their words
    model([emits(build(bad)), emits(build(bad))])
    r = conv.converse("Smooth the close twice, the second time from the first", user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == conv.RUNNING_VALUE_GATE
    assert "highest, lowest or average of a running value over a window" in r["reason"]


def test_the_instructions_say_a_running_value_has_one_bar_of_its_past():
    text = conv_module().system_prompt()
    assert "NEVER put a state inside a function that reads a window of bars (lowest, highest, an average, a sum" in text
    assert "A running value has one bar of its past, not a history" in text
    assert "through arithmetic and ONE-BAR functions only (max, min, abs, ln, exp, sqrt)" in text
    # the sentence that invited the answer is gone: earlier states are no longer read "any way at all" unqualified
    assert "and EARLIER states any way at all" not in text


def conv_module():
    from api.services import definition_conversation
    return definition_conversation

