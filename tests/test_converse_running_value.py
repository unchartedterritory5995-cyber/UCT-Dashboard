"""ONE RUNNING VALUE at the door: `accum(seed, update, warmup)` with `self`.

A capability census (177 indicator ideas, each written by hand and run through the parser, the
door and the engine) found twelve the ENGINE computes and the door refused, every one a value
that reads its own previous value: KAMA, McGinley Dynamic, VIDYA, a ratcheting ATR stop, a streak,
Connors RSI, a negative volume index, TD counts, Heikin Ashi's open. The table offers `accum`;
the boundary's name list had no `self`, so the model was shown a function it could not use.

Opened by the engine session's ruling, with its conditions, each held here:

  * ONE running value: `accum2`..`accum4` and `state1`..`state4` stay closed, refused by name.
    (⭐ 2026-11-18, later the same day: opened for the shapes that SETTLE. What this file still
    holds of them: values that never forget their start are refused, and a state name outside
    its own function is refused. The opened shapes: `tests/test_converse_running_values_linked.py`.)
  * `self` is the model's to write only inside an `accum` update; one `accum` never sits inside
    another; the warm-up is a literal within the lookback cap.
  * HONESTY BY SHAPE: the door itself says where the value starts, with the STRONGER sentence
    (counts and levels restart) unless the update is the one shape that provably settles. And
    the sentences are TRUE of the engine: a streak longer than the window reads the window, and
    a settled smoother equals the same filter carried from the first bar.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import random

import pytest

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
back = lambda node, n: {"type": "offset", "value": n, "args": [node]}  # noqa: E731
SELF = S("self")
ATR = call("atr", S("high"), S("low"), S("close"), num(14))
GATE = "unsupported:running-value"


def accum(seed, update, warmup):
    return call("accum", seed, update, num(warmup))


STREAK = accum(num(0), op("?:", op(">", S("close"), back(S("close"), 1)), op("+", SELF, num(1)), num(0)), 100)
STOP = accum(S("low"), call("max", SELF, op("-", S("close"), op("*", num(3), ATR))), 300)
ER = op("/", call("abs", op("-", S("close"), back(S("close"), 10))), call("sum", call("abs", op("-", S("close"), back(S("close"), 1))), num(10)))
KAMA = accum(S("close"), op("+", SELF, op("*", call("pow", op("+", op("*", ER, num(0.6022)), num(0.0645)), num(2)), op("-", S("close"), SELF))), 300)
MCGINLEY = accum(S("close"), op("+", SELF, op("/", op("-", S("close"), SELF), op("*", num(8.4), call("pow", op("/", S("close"), SELF), num(4))))), 300)


def smoother(k, warmup=300):
    return accum(S("close"), op("+", SELF, op("*", num(k), op("-", S("close"), SELF))), warmup)


def create(tree, key="v"):
    return {"op": "create", "name": "Running", "placement": "pane", "outputs": [{"key": key, "tree": tree}]}


def _ok(conv, tree):
    return conv.check_envelope(env(0, [create(tree)]), 0, empty_view(0))


def _refused(conv, tree):
    with pytest.raises(conv._Refused) as exc:
        _ok(conv, tree)
    return exc.value


# ── what is open ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tree", [STREAK, STOP, KAMA, MCGINLEY, smoother(0.1)], ids=["streak", "stop", "kama", "mcginley", "smoother"])
def test_one_running_value_is_accepted(conv, tree):
    assert _ok(conv, tree)


def test_a_running_value_inside_ordinary_maths_and_beside_other_outputs_is_accepted(conv):
    crsi = op("/", op("+", call("rsi", S("close"), num(3)), call("rsi", STREAK, num(2))), num(2))      # reads a running value
    patch = env(0, [{"op": "create", "name": "Two", "placement": "pane",
                     "outputs": [{"key": "a", "tree": crsi}, {"key": "b", "tree": STOP}]}])
    assert conv.check_envelope(patch, 0, empty_view(0))


# ── what stays closed ────────────────────────────────────────────────────────

@pytest.mark.parametrize("tree, where", [
    (SELF, "bare"),
    (op("+", S("close"), SELF), "in ordinary maths"),
    (accum(SELF, op("+", SELF, num(1)), 100), "in a seed"),
    (call("sma", SELF, num(20)), "inside another function"),
])
def test_self_outside_a_running_values_update_is_refused_by_name(conv, tree, where):
    refused = _refused(conv, tree)
    assert refused.gate == "schema:name" and "'self'" in refused.detail, (where, refused.gate, refused.detail)


@pytest.mark.parametrize("name, n_states", [("accum2", 2), ("accum3", 3), ("accum4", 4)])
def test_running_values_that_only_carry_themselves_never_forget_and_are_refused(conv, name, n_states):
    """Each value kept as it is (state1 stays state1): where it started is all it will ever be."""
    states = [S(f"state{i}") for i in range(1, n_states + 1)]
    tree = call(name, num(1), num(300), *([S("close")] * n_states), *states)
    refused = _refused(conv, tree)
    assert refused.gate == GATE
    assert f"this {name} never forgets where it started" in refused.detail
    assert "unsupported" in refused.detail                                # the way out for the model
    assert "never stop depending on where they started" in refused.reason  # a member's words, no function name
    assert name not in refused.reason


def test_a_state_name_the_model_writes_is_still_refused(conv):
    refused = _refused(conv, accum(S("close"), op("+", SELF, S("state1")), 100))
    assert refused.gate == "schema:name" and "'state1'" in refused.detail


def test_one_running_value_never_sits_inside_another(conv):
    inner = accum(num(0), op("+", SELF, num(1)), 50)
    for nested in (accum(S("close"), op("+", SELF, inner), 100), accum(inner, op("+", SELF, num(1)), 100)):
        refused = _refused(conv, nested)
        assert refused.gate == GATE and "inside another accum" in refused.detail
    # two running values SIDE BY SIDE are two values, each on its own
    assert _ok(conv, op("-", STOP, smoother(0.1)))


def test_the_warm_up_is_a_literal_within_the_lookback_cap(conv):
    assert _ok(conv, smoother(0.5, 960))
    assert _refused(conv, smoother(0.5, 961)).gate.startswith("budget:")
    not_literal = call("accum", S("close"), op("+", SELF, num(1)), op("+", num(100), num(1)))
    assert _refused(conv, not_literal).gate != GATE                        # refused by the gate that owns windows


# ── the door says where it starts ────────────────────────────────────────────

STRONG = "so its counts and levels restart"
WEAK = "its starting point no longer matters"


def notes_of(conv, ops):
    return conv.running_value_notes(env(0, ops))


def test_the_stronger_sentence_unless_the_update_provably_settles(conv):
    for tree, window in ((STREAK, 100), (STOP, 300), (KAMA, 300), (MCGINLEY, 300)):
        (note,) = notes_of(conv, [create(tree)])
        assert note["output"] == "v" and STRONG in note["text"] and f"from {window} bars back" in note["text"]
        assert "A chart computed from the symbol's first bar can differ." in note["text"]
        assert len(note["text"]) <= 300
    (settled,) = notes_of(conv, [create(smoother(0.1))])
    assert WEAK in settled["text"] and "starts 300 bars back" in settled["text"] and STRONG not in settled["text"]


@pytest.mark.parametrize("tree, why", [
    (smoother(0.01), "a literal gain too small to forget its start inside 300 bars (0.99 ** 300 is 5%)"),
    (smoother(0.1, 20), "a window too short for that gain (0.9 ** 20 is 12%)"),
    (accum(S("close"), op("+", SELF, op("*", num(1.5), op("-", S("close"), SELF))), 300), "a gain above 1"),
    (accum(S("close"), op("+", SELF, op("*", num(0.1), op("-", S("close"), num(3)))), 300), "not a step toward a target"),
    (accum(S("close"), op("+", SELF, op("*", num(0.1), op("-", op("+", S("close"), SELF), SELF))), 300), "the target reads self"),
    (accum(num(0), op("+", SELF, S("volume")), 300), "a running total"),
    (accum(S("close"), op("+", SELF, op("*", S("volume"), op("-", S("close"), SELF))), 300), "a gain that is a series"),
])
def test_everything_the_door_cannot_prove_settles_gets_the_stronger_sentence(conv, tree, why):
    (note,) = notes_of(conv, [create(tree)])
    assert STRONG in note["text"], why


def test_the_settled_shape_is_read_in_either_order(conv):
    k, diff = num(0.2), op("-", S("close"), SELF)
    for update in (op("+", SELF, op("*", k, diff)), op("+", SELF, op("*", diff, k)), op("+", op("*", k, diff), SELF)):
        (note,) = notes_of(conv, [create(accum(S("close"), update, 300))])
        assert WEAK in note["text"], update


def test_notes_follow_every_door_a_formula_enters_by_and_only_running_values(conv):
    ops = [create(STREAK, "a"), {"op": "add_output", "key": "b", "tree": STOP}, {"op": "set_output_tree", "output": "a", "tree": smoother(0.1)},
           {"op": "add_output", "key": "c", "tree": call("sma", S("close"), num(20))}]
    got = notes_of(conv, ops)
    assert [n["output"] for n in got] == ["a", "b", "a"]
    assert notes_of(conv, [create(call("sma", S("close"), num(20)))]) == []
    # an offered function the SYSTEM writes as a running value is not the model's accum: its own note covers it
    assert notes_of(conv, [create(call("supertrend", num(3), num(10)))]) == []
    # an output with two running values: one note, the shorter window, the stronger sentence if either needs it
    (both,) = notes_of(conv, [create(op("-", STOP, smoother(0.1, 200)))])
    assert STRONG in both["text"] and "from 200 bars back" in both["text"]


def test_the_doors_notes_come_first_are_not_repeated_and_respect_the_contracts_limit(conv):
    own = notes_of(conv, [create(STREAK)])[0]
    with_models = conv.with_running_value_notes({**env(0, [create(STREAK)]), "assumptions": [{"text": "I took 'in a row' to mean consecutive closes."}]})
    # (each of the door's own notes is marked as the door's: `tests/test_note_by.py`)
    marked = {**own, "by": "uct"}
    assert with_models["assumptions"][0] == marked and len(with_models["assumptions"]) == 2
    again = conv.with_running_value_notes({**env(0, [create(STREAK)]), "assumptions": [dict(own)]})
    assert again["assumptions"] == [own]                                    # already said: not said again
    full = {**env(0, [create(STREAK)]), "assumptions": [{"text": f"assumption {i}"} for i in range(conv.MAX_ASSUMPTIONS)]}
    capped = conv.with_running_value_notes(full)
    assert len(capped["assumptions"]) == conv.MAX_ASSUMPTIONS == 12 and capped["assumptions"][0] == marked
    untouched = env(0, [create(call("sma", S("close"), num(20)))])
    assert conv.with_running_value_notes(untouched) is untouched


# ── through the whole door ───────────────────────────────────────────────────

def test_a_running_value_is_built_in_one_call_and_carries_the_doors_note(conv, clean_env, model):
    client = model([emits(env(0, [create(STREAK, "streak")], reply="Counted the up-day streak."))])
    r = conv.converse("count how many days in a row the close has been up", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    (note,) = r["envelope"]["assumptions"]
    assert note["output"] == "streak" and STRONG in note["text"]
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))            # what the door returns still passes the door


def test_two_running_values_are_refused_and_one_repairs_it(conv, clean_env, model):
    two = env(0, [create(call("accum2", num(1), num(300), S("close"), S("close"), S("state1"), S("state2")))])
    client = model([emits(two), emits(env(0, [create(smoother(0.2))]))])
    r = conv.converse("a smoother of the close", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == GATE
    said = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "this accum2 never forgets where it started" in said
    model([emits(two), emits(two)])
    r = conv.converse("a two-pole smoother of the close", user_id="u2", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == GATE and "envelope" not in r
    assert "running value" in r["reason"] and "accum" not in r["reason"]


def test_the_instructions_say_how_and_what_is_closed(conv):
    text = conv.system_prompt()
    assert "A RUNNING VALUE reads its own previous value" in text
    assert "accum(0, close > offset 1 of close ? self + 1 : 0, 100)" in text
    assert "`self` exists ONLY inside an accum's update" in text
    assert "SEVERAL RUNNING VALUES THAT FEED EACH OTHER are accum2, accum3 or accum4" in text
    assert "NOT available" not in text[text.index("A RUNNING VALUE reads"):text.index("AN UP DAY is")]
    assert "use 300 unless the member asks" in text
    assert "built to its PUBLISHED formula or not at all" in text
    assert text.index("the window is the N bars BEFORE this one") < text.index("A RUNNING VALUE reads") < text.index("DO NOT FABRICATE CAPABILITIES")


# ── the sentences are true of the engine ─────────────────────────────────────

def _bars(n, seed=5):
    random.seed(seed)
    px, out_ = 100.0, []
    for i in range(n):
        px *= 1 + random.uniform(-0.02, 0.021)
        out_.append({"t": 1_700_000_000 + 86_400 * i, "o": px * 0.995, "h": px * 1.01, "l": px * 0.99, "c": px, "v": 1000 + i})
    return out_


def test_TRUE_a_count_older_than_the_window_is_forgotten():
    """The stronger sentence, measured: on 250 straight up days a 100-bar streak reads 100, not 249."""
    climb = [{"t": 1_700_000_000 + 86_400 * i, "o": 10 + i, "h": 11 + i, "l": 9 + i, "c": 10 + i, "v": 1000} for i in range(250)]
    streak = ast_interpret.interpret(STREAK, climb)
    assert streak[-1] == 100.0                                             # the window, not the 249 days it has been up
    assert streak[150] == 100.0
    # and nothing is shown until a whole window exists: it never shows a count it started mid-run
    assert streak[60] is None and next(i for i, v in enumerate(streak) if v is not None) >= 100
    # and a real count inside the window is exact
    bars = _bars(400)
    got = ast_interpret.interpret(STREAK, bars)
    for i in range(120, 400):
        want, j = 0, i
        while j > 0 and bars[j]["c"] > bars[j - 1]["c"] and want < 100:
            want, j = want + 1, j - 1
        assert got[i] == float(want), (i, got[i], want)


def test_TRUE_the_settled_shape_equals_the_same_filter_carried_from_the_first_bar():
    """The weaker sentence, measured: a 0.1-gain smoother restarted 300 bars back, against the
    same recursion run once from the first bar."""
    bars = _bars(900)
    got = ast_interpret.interpret(smoother(0.1), bars)
    full, carried = bars[0]["c"], []
    for b in bars:
        full = full + 0.1 * (b["c"] - full)
        carried.append(full)
    worst = max(abs(got[i] - carried[i]) / carried[i] for i in range(320, 900))
    assert worst < 1e-9, worst
    # CONTROL: a gain the door calls NOT settled really does differ inside the window
    slow = ast_interpret.interpret(smoother(0.01), bars)
    full, carried = bars[0]["c"], []
    for b in bars:
        full = full + 0.01 * (b["c"] - full)
        carried.append(full)
    assert max(abs(slow[i] - carried[i]) / carried[i] for i in range(320, 900)) > 1e-4
