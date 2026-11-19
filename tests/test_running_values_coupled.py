"""SEVERAL RUNNING VALUES THAT FEED EACH OTHER: which shapes settle, and after how many bars
(`api/services/running_values.py`; rulings of 2026-11-18).

The claims are checked two ways. By the shape rules themselves (what is LINEAR, what is a CASCADE,
what is PATH-DEPENDENT). And BY RUNNING THE RECURRENCE: each settling example is simulated from
different starting values over random inputs, and what is left of the start after `needs` steps is
measured against the tolerance. A bound that only the rule believes in would fail the second.
"""
from __future__ import annotations

import math
import random

import pytest

from api.services import running_values as rv

S = lambda n: {"type": "series", "name": n}  # noqa: E731
num = lambda v: {"type": "num", "value": v}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
X = S("close")
S1, S2, S3, S4 = (S(n) for n in rv.STATES)
SETTLED = 1e-4


def accum(k, updates, seeds=None, output=1, warmup=300):
    return call(f"accum{k}", num(output), num(warmup), *(seeds or [num(0)] * k), *updates)


# ── the examples ─────────────────────────────────────────────────────────────

def super_smoother():
    """A two-pole low-pass filter (period 10): the second value carries the first one's last bar."""
    y = op("+", op("+", op("*", num(0.2533), X), op("*", num(1.158), S1)), op("*", num(-0.4113), S2))
    return accum(2, [y, S1], seeds=[X, X])


def laguerre(gamma=0.8):
    """A four-stage Laguerre filter. A stage that reads the stage before it at THIS bar writes that
    stage's update inline, as the engine's simultaneous update requires."""
    l0 = op("+", op("*", num(1 - gamma), X), op("*", num(gamma), S1))
    l1 = op("+", op("+", op("*", num(-gamma), l0), S1), op("*", num(gamma), S2))
    l2 = op("+", op("+", op("*", num(-gamma), l1), S2), op("*", num(gamma), S3))
    l3 = op("+", op("+", op("*", num(-gamma), l2), S3), op("*", num(gamma), S4))
    return accum(4, [l0, l1, l2, l3], seeds=[X, X, X, X], output=4)


def fisher():
    """A Fisher-style transform: a smoothed position, then a smoothed logarithm of it."""
    v = op("+", op("*", num(0.66), op("-", X, num(0.5))), op("*", num(0.67), S1))
    clipped = call("max", num(-0.999), call("min", num(0.999), v))
    f = op("+", op("*", num(0.5), call("ln", op("/", op("+", num(1), clipped), op("-", num(1), clipped)))), op("*", num(0.5), S2))
    return accum(2, [v, f], output=2)


# ── running a recurrence by hand ─────────────────────────────────────────────

def value(node, env):
    t = node["type"]
    if t == "num":
        return float(node["value"])
    if t == "series":
        return env[node["name"]]
    a = [value(x, env) for x in node.get("args", [])]
    n = node["name"]
    if t == "op":
        return {"+": lambda: a[0] + a[1], "-": lambda: a[0] - a[1], "*": lambda: a[0] * a[1], "/": lambda: a[0] / a[1],
                "u-": lambda: -a[0], ">": lambda: 1.0 if a[0] > a[1] else 0.0, "?:": lambda: a[1] if a[0] else a[2]}[n]()
    return {"ln": lambda: math.log(a[0]), "max": lambda: max(a), "min": lambda: min(a), "abs": lambda: abs(a[0])}[n]()


def run(node, xs, start):
    """Every state after each step, starting from `start`, with all updates replaced together."""
    p = rv.parts(node)
    states, path = list(start), []
    for x in xs:
        env = {"close": x, **{rv.STATES[i]: states[i] for i in range(p["k"])}}
        states = [value(u, env) for u in p["updates"]]
        path.append(list(states))
    return path


def left_of_the_start(node, steps, trials=300, seed=11, inputs=None):
    """The largest difference any state shows, `steps` steps in and after, between two runs that
    differ only in where they started, as a share of how far apart they started."""
    rng = random.Random(seed)
    k = rv.parts(node)["k"]
    worst = 0.0
    for _ in range(trials):
        xs = (inputs or (lambda r: [r.random() for _ in range(steps + 40)]))(rng)
        a0 = [rng.uniform(-1, 1) for _ in range(k)]
        b0 = [rng.uniform(-1, 1) for _ in range(k)]
        apart = max(abs(p - q) for p, q in zip(a0, b0)) or 1.0
        pa, pb = run(node, xs, a0), run(node, xs, b0)
        for m in range(steps - 1, len(xs)):
            worst = max(worst, max(abs(p - q) for p, q in zip(pa[m], pb[m])) / apart)
    return worst


# ═══ 1. reading the call ═════════════════════════════════════════════════════

def test_a_call_is_taken_apart_only_when_it_is_written_as_the_engine_reads_it():
    p = rv.parts(super_smoother())
    assert (p["k"], p["output"], p["warmup"], len(p["seeds"]), len(p["updates"])) == (2, 1, 300, 2, 2)
    for wrong in (call("accum", X, S("self"), num(300)),                       # the one-value form is not this module's
                  call("accum2", num(3), num(300), X, X, S1, S2),               # value number 3 of two
                  call("accum2", num(1), num(0), X, X, S1, S2),                 # no warm-up
                  call("accum2", num(1), X, X, X, S1, S2),                      # the warm-up is not a plain number
                  call("accum2", num(1), num(300), X, X, S1),                   # an update missing
                  call("accum3", num(1), num(300), X, X, S1, S2), X, None):
        assert rv.parts(wrong) is None
        assert rv.classify(wrong)["shape"] == rv.MALFORMED
    # a starting value cannot read a running value: there is none before the start
    assert rv.classify(accum(2, [S1, S2], seeds=[S2, X]))["shape"] == rv.MALFORMED


def test_a_plain_number_may_be_written_as_arithmetic_and_nothing_else_is_one():
    assert rv.literal(op("/", num(2), op("+", num(10), num(1)))) == pytest.approx(2 / 11)
    assert rv.literal(op("u-", num(0.4))) == -0.4
    # the engine's own maths of plain numbers: a filter's coefficients are written, not worked out by hand
    assert rv.literal(call("exp", op("/", op("*", op("u-", num(1.414)), num(3.14159)), num(10)))) == pytest.approx(math.exp(-0.4442208), abs=1e-6)
    assert rv.literal(call("cos", num(0))) == 1.0 and rv.literal(call("sqrt", num(2))) == pytest.approx(math.sqrt(2))
    assert rv.literal(call("pow", num(2), num(10))) == 1024.0
    for not_a_number in (X, op("*", num(2), X), call("exp", X), call("ema", num(1), num(2)), op("/", num(1), num(0)),
                         call("ln", num(-1)), call("sqrt", num(-4)), call("exp", num(5000)), call("pow", num(2)), None):
        assert rv.literal(not_a_number) is None, not_a_number


def test_the_plain_number_multiple_of_each_state():
    k = 2
    assert rv.affine(op("+", op("*", num(0.5), S1), op("*", S2, num(0.2))), k) == [0.5, 0.2]
    assert rv.affine(op("-", X, op("/", S1, num(4))), k) == [-0.25, 0.0]
    assert rv.affine(op("u-", op("-", S2, S1)), k) == [1.0, -1.0]
    assert rv.affine(op("+", op("*", num(0.3), S1), op("*", num(0.4), S1)), k) == pytest.approx([0.7, 0.0])
    assert rv.affine(call("ema", X, num(20)), k) == [0.0, 0.0]                  # reads no state: free
    for no in (call("max", S1, X), op("*", S1, S2), op("*", X, S1), op("/", X, S1), op("/", S1, X),
               op("?:", op(">", X, S1), num(1), num(0)), {"type": "offset", "value": 1, "args": [S1]}):
        assert rv.affine(no, k) is None, no
    # about ONE state: the others count as inputs, however they are read
    assert rv.affine(op("+", call("ln", S1), op("*", num(0.5), S2)), k, only=1) == [0.0, 0.5]
    assert rv.affine(op("+", call("ln", S1), op("*", num(0.5), S2)), k, only=0) is None


# ═══ 2. LINEAR: the bound is the coupled system's own ════════════════════════

def test_a_two_pole_filter_is_linear_and_its_bound_holds_when_it_is_run():
    got = rv.classify(super_smoother(), SETTLED)
    assert got["shape"] == rv.LINEAR and got["needs"] == 25
    assert got["matrix"] == [[1.158, -0.4113], [1.0, 0.0]]
    assert left_of_the_start(super_smoother(), got["needs"]) <= SETTLED
    # CONTROL: the bound is not slack by a wide margin (a few steps earlier the start still shows)
    assert left_of_the_start(super_smoother(), got["needs"] - 6) > SETTLED


def test_four_stages_that_each_read_the_one_before_are_one_coupled_system():
    """Each Laguerre stage alone keeps 0.8 of itself (42 steps to 1e-4). FOUR in a row need far more
    than 42: a bound taken per value would be wrong, which is why it is taken for the system."""
    got = rv.classify(laguerre(), SETTLED)
    assert got["shape"] == rv.LINEAR
    alone = math.ceil(math.log(SETTLED) / math.log(0.8))
    assert alone == 42 and got["needs"] == 82                                   # nearly twice one stage's own bound
    assert left_of_the_start(laguerre(), got["needs"], trials=120) <= SETTLED
    assert left_of_the_start(laguerre(), alone, trials=120) > SETTLED              # the per-value bound is NOT enough


def test_a_mix_whose_powers_rise_before_they_fall_is_bounded_from_where_they_stay_down():
    spike = accum(2, [op("+", op("*", num(0.5), S1), op("*", num(100), S2)), op("*", num(0.5), S2)])
    got = rv.classify(spike, SETTLED)
    assert got["shape"] == rv.LINEAR and got["needs"] is not None
    assert left_of_the_start(spike, got["needs"], trials=60) <= SETTLED
    assert got["needs"] > math.ceil(math.log(SETTLED) / math.log(0.5))              # more than either value alone


@pytest.mark.parametrize("update, what", [
    (op("+", S1, X), "a running total"),
    (op("-", X, S1), "it flips its own sign for ever"),
    (op("*", num(1.01), S1), "it grows"),
])
def test_a_linear_mix_that_never_forgets_its_start_has_no_bound(update, what):
    got = rv.classify(accum(2, [update, S1]), SETTLED)
    assert got["shape"] == rv.LINEAR and got["needs"] is None and "not settled after 960 bars" in got["why"], what


# ═══ 3. CASCADE ══════════════════════════════════════════════════════════════

def test_a_smoothed_stretched_position_is_a_cascade_and_its_bound_holds_when_it_is_run():
    got = rv.classify(fisher(), SETTLED)
    assert got["shape"] == rv.CASCADE
    assert [(s["state"], s["keeps"], s["steps"]) for s in got["stages"]] == [(1, 0.67, 23), (2, 0.5, 14)]
    assert got["needs"] == 3 * 23                                                 # (stages + 1) passes of the slowest

    def pinned(rng):                                                              # runs pinned at an edge, where the logarithm is steepest
        mode = rng.random()
        return [(1.0 if mode < 0.2 else 0.0 if mode < 0.4 else rng.random()) if rng.random() < 0.7 else rng.random() for _ in range(120)]
    assert left_of_the_start(fisher(), got["needs"], trials=600, inputs=pinned) <= SETTLED
    # ⭐ WHY THE SPARE PASSES: at the plain sum of the stages the start still shows
    assert left_of_the_start(fisher(), 23 + 14, trials=600, inputs=pinned) > SETTLED * 0.1


def clamped_feedback():
    """The same, with the value FED BACK clamped (so the logarithm never sees the edge)."""
    v = call("max", op("u-", num(0.999)), call("min", num(0.999),
             op("+", op("*", num(0.66), op("-", X, num(0.5))), op("*", num(0.67), S1))))
    f = op("+", op("*", num(0.5), call("ln", op("/", op("+", num(1), v), op("-", num(1), v)))), op("*", num(0.5), S2))
    return accum(2, [v, f], output=2)


def test_a_value_fed_back_through_a_clamp_keeps_no_more_than_it_would_without():
    """A clamp (max, min, abs) cannot widen a difference: two runs 0.1 apart are at most 0.1 apart
    after it. So `max(-0.999, min(0.999, 0.67 * state1 + ...))` keeps 0.67, as without the clamp."""
    k = 2
    inner = op("+", op("*", num(0.67), S1), X)
    assert rv.own_gain(inner, k, 0) == pytest.approx(0.67)
    assert rv.own_gain(call("max", op("u-", num(0.999)), call("min", num(0.999), inner)), k, 0) == pytest.approx(0.67)
    assert rv.own_gain(call("abs", op("*", num(0.4), S1)), k, 0) == pytest.approx(0.4)
    assert rv.own_gain(op("+", call("abs", op("*", num(0.4), S1)), op("*", num(0.3), S1)), k, 0) == pytest.approx(0.7)
    assert rv.own_gain(op("-", S1, op("*", num(0.5), S1)), k, 0) == pytest.approx(0.5)      # exact when it is a plain mix
    assert rv.own_gain(X, k, 0) == 0.0
    assert rv.own_gain(call("max", S1, X), k, 0) == 1.0                                     # a ratchet keeps all of it
    for unknown in (call("ln", S1), op("*", S1, X), op("?:", op(">", S1, X), num(1), num(0)), call("ema", S1, num(5))):
        assert rv.own_gain(unknown, k, 0) is None, unknown
    got = rv.classify(clamped_feedback(), SETTLED)
    assert got["shape"] == rv.CASCADE and got["needs"] == 69
    assert [round(s_["keeps"], 2) for s_ in got["stages"]] == [0.67, 0.5]

    def pinned(rng):
        mode = rng.random()
        return [(1.0 if mode < 0.2 else 0.0 if mode < 0.4 else rng.random()) if rng.random() < 0.7 else rng.random() for _ in range(120)]
    assert left_of_the_start(clamped_feedback(), got["needs"], trials=600, inputs=pinned) <= SETTLED


def test_the_stages_are_found_in_whatever_order_they_were_written():
    first = op("*", num(0.5), S2)                                                   # state2 is the first stage
    second = op("+", call("abs", S2), op("*", num(0.25), S1))                       # state1 reads it inside a function
    got = rv.classify(accum(2, [second, first]), SETTLED)
    assert got["shape"] == rv.CASCADE and [s["state"] for s in got["stages"]] == [2, 1]


# ═══ 4. PATH-DEPENDENT: refused by what it is ════════════════════════════════

@pytest.mark.parametrize("updates, says", [
    ([call("max", S1, X), S1], "a multiple of 1 or more"),                                             # a ratchet keeps all of itself
    ([call("ln", call("abs", S1)), S1], "inside a function, a comparison or a choice"),                 # its own value inside a function
    ([op("?:", op(">", X, S2), op("+", S1, num(1)), num(0)), X], "inside a function, a comparison or a choice"),   # a count that resets
    ([op("*", S1, call("abs", X)), X], "inside a function, a comparison or a choice"),                 # a coefficient that is a series
    ([op("+", S1, call("abs", S2)), op("*", num(0.5), S2)], "a multiple of 1 or more"),               # a running total fed by a stage
    ([call("abs", S2), call("abs", S1)], "two running values read each other"),                        # each inside a function
])
def test_what_does_not_settle_is_called_path_dependent_and_says_why(updates, says):
    got = rv.classify(accum(2, updates), SETTLED)
    assert got["shape"] == rv.PATH and got["needs"] is None and says in got["why"], got["why"]


def test_a_cascade_too_long_for_the_window_has_no_bound():
    slow = [op("*", num(0.995), S1), op("+", call("abs", S1), op("*", num(0.995), S2))]
    got = rv.classify(accum(2, slow), SETTLED, cap=960)
    assert got["shape"] == rv.CASCADE and got["needs"] is None and "more than the 960 allowed" in got["why"]


# ═══ the engine is the authority: what it will not compute, the rule does not accept ══════════

def _second_stage(reads_first):
    """Two running values: a smoothed close, and a smoothing of `reads_first` (something of the first)."""
    first = op("+", op("*", num(0.5), X), op("*", num(0.5), S1))
    second = op("+", op("*", num(0.5), reads_first), op("*", num(0.5), S2))
    return accum(2, [first, second], seeds=[X, X], output=2)


ENGINE_REFUSES = {
    # ⚰️ the answer found live, 2026-11-18: the second stage took the lowest of the first over 10 bars
    "the lowest of a running value over a window": (_second_stage(call("lowest", S1, num(10))), "lowest"),
    "the highest of a formula that reads one": (_second_stage(call("highest", op("-", X, S1), num(10))), "highest"),
    "an average of a running value": (_second_stage(call("sma", S1, num(5))), "sma"),
    "a running value read one bar further back": (_second_stage({"type": "offset", "value": 1, "args": [S1]}), "bar offset"),
    "a running value inside another running value": (
        _second_stage(call("accum", X, op("+", S("self"), S1), num(50))), "nested accum"),
}
ENGINE_COMPUTES = {
    "an earlier value through arithmetic": _second_stage(op("*", num(2), S1)),
    "an earlier value through one-bar functions": _second_stage(call("max", num(0), call("abs", op("-", X, S1)))),
    "an earlier value through a log": _second_stage(call("ln", op("+", num(1), call("abs", S1)))),
    "a window of something that reads NO running value": _second_stage(call("lowest", X, num(10))),
    "the two-pole filter": super_smoother(),
    "the four Laguerre stages": laguerre(),
    "the Fisher-style chain": fisher(),
}


def _engine(tree):
    """Does the server's own engine compute this tree? (True, or the reason it refuses.)"""
    from api.services import ast_interpret
    from tests.test_house_indicators_values import _walk
    try:
        ast_interpret.interpret(tree, _walk(11, n=420))
        return True
    except ast_interpret.TableRefusal as refusal:
        return str(refusal)


@pytest.mark.parametrize("what", sorted(ENGINE_REFUSES))
def test_the_door_refuses_what_the_engine_refuses(what):
    """A running value carries ONE bar of its past. The rule here used to call each of these a chain
    ("earlier states, any way at all"), so the door accepted an answer the browser then refused."""
    tree, names = ENGINE_REFUSES[what]
    said = _engine(tree)
    assert said is not True and "a running value" in said, (what, said)       # the engine refuses it, by name
    got = rv.classify(tree)
    assert got["shape"] == rv.UNREADABLE and got["needs"] is None, (what, got)
    assert got["why"].startswith("in update 2, a running value sits ") and names in got["why"], got["why"]


@pytest.mark.parametrize("what", sorted(ENGINE_COMPUTES))
def test_CONTROL_what_the_engine_computes_is_not_called_unreadable(what):
    tree = ENGINE_COMPUTES[what]
    assert _engine(tree) is True, what
    assert rv.classify(tree)["shape"] in (rv.LINEAR, rv.CASCADE), (what, rv.classify(tree))
    for update in rv.parts(tree)["updates"]:
        assert rv.engine_objection(update, rv.parts(tree)["k"]) is None


def test_the_objection_is_the_engines_own_predicates_not_a_second_list():
    """`engine_objection` asks `ast_interpret` which functions read one bar. A function added to
    the engine's one-bar set is accepted here with no change, and one that is not is refused."""
    from api.services import ast_interpret as engine
    one_bar = sorted(name for name in ("max", "min", "abs", "ln", "exp", "sqrt", "sign", "floor")
                     if engine.is_pointwise(engine._fn_spec(name)))
    assert len(one_bar) >= 6
    for name in one_bar:
        inner = call(name, S1, num(2)) if name in ("max", "min") else call(name, S1)
        assert rv.engine_objection(op("+", inner, S2), 2) is None, name
    for name in ("lowest", "highest", "sma", "ema", "sum", "stdev"):
        assert not engine.is_pointwise(engine._fn_spec(name)), name
        assert name in rv.engine_objection(op("+", call(name, S1, num(5)), S2), 2), name
    # a formula that reads NO running value is never walked into
    assert rv.engine_objection(call("lowest", X, num(10)), 2) is None

