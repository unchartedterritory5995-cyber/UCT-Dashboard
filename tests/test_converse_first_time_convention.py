""""For the first time in N bars": the instruction, and what its spelling computes.

Found on production, 2026-11-17: "arrow when price closes at a new 52 week high for the first time
in at least 30 days" spent two model calls and ended in a refusal (Indicators backlog 63). The
instructions did not say how to write "for the first time in N bars", and one natural spelling was
wrongly refused by the repaint lint (fixed separately in the engine).

The instructions now teach ONE spelling that the door has always accepted:

    cond && (offset 1 of barssince(cond, N)) >= N

Pinned here: the instructions say it; the door accepts it; and the ENGINE computes, on every bar,
exactly "the condition is true now and was not true on any of the N bars before". The last is the
point: an instruction that taught a spelling one bar off would be worse than none.

No paid calls.
"""
from __future__ import annotations

import random

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, empty_view, env, num, op,
)

S = lambda n: {"type": "series", "name": n}  # noqa: E731
back = lambda node, bars: {"type": "offset", "value": bars, "args": [node]}  # noqa: E731


def first_time(cond, n):
    """The taught spelling."""
    return op("&&", cond, op(">=", back(call("barssince", cond, num(n)), 1), num(n)))


def _bars(count=420, seed=7):
    random.seed(seed)
    px, out = 100.0, []
    for i in range(count):
        px *= 1 + random.uniform(-0.03, 0.031)
        out.append({"t": 1_700_000_000 + 86_400 * i, "o": px * 0.99, "h": px * 1.01, "l": px * 0.98,
                    "c": px, "v": 1000 + i})
    return out


def test_the_instructions_teach_one_spelling(conv):
    text = conv.system_prompt()
    assert "FOR THE FIRST TIME IN N BARS" in text
    assert "cond && (offset 1 of barssince(cond, N)) >= N" in text
    assert "answers N when the condition was not true that recently" in text
    # it sits with the other window conventions, before the capabilities section
    assert text.index("FOR THE FIRST TIME IN N BARS") < text.index("DO NOT FABRICATE CAPABILITIES")
    assert text.index("the window is the N bars BEFORE this one") < text.index("FOR THE FIRST TIME IN N BARS")


def test_the_door_accepts_the_spelling_it_teaches(conv):
    new_high = op(">=", S("close"), call("highest", S("close"), num(252)))
    patch = env(0, [{"op": "create", "name": "First new high", "placement": "price",
                     "outputs": [{"key": "first", "tree": first_time(new_high, 30)}]},
                    {"op": "set_marker", "output": "first", "shape": "arrowUp", "position": "belowBar"}])
    assert conv.check_envelope(patch, 0, empty_view(0))


def test_the_spelling_computes_true_now_and_on_none_of_the_n_bars_before():
    bars = _bars()
    for lookback, n in ((20, 10), (50, 20), (10, 3), (20, 1)):
        cond = op(">=", S("high"), call("highest", S("high"), num(lookback)))
        is_true = ast_interpret.interpret(cond, bars)
        got = ast_interpret.interpret(first_time(cond, n), bars)
        checked = fired = 0
        for i in range(lookback + n + 2, len(bars)):
            want = 1.0 if is_true[i] == 1.0 and not any(is_true[j] == 1.0 for j in range(i - n, i)) else 0.0
            assert got[i] == want, (lookback, n, i, got[i], want)
            checked += 1
            fired += int(want)
        # not vacuous: it fires, and it fires less often than the bare condition does
        assert checked > 300 and fired >= 1, (lookback, n, checked, fired)
        assert fired <= sum(1 for v in is_true if v == 1.0)
    # and with N = 1 it is "just became true", the plain meaning of a first bar
    cond = op(">=", S("high"), call("highest", S("high"), num(20)))
    assert ast_interpret.interpret(first_time(cond, 1), bars)[25:] == \
        ast_interpret.interpret(op("&&", cond, op("!", back(cond, 1))), bars)[25:]


def test_CONTROL_the_bare_condition_repeats_through_a_run_and_the_spelling_does_not():
    """What the instruction is for: in a run of new highs the bare condition marks every bar."""
    bars = [{"t": 1_700_000_000 + 86_400 * i, "o": 10 + i, "h": 11 + i, "l": 9 + i, "c": 10 + i, "v": 1000}
            for i in range(120)]                                  # a steady climb: every bar a new high
    cond = op(">=", S("high"), call("highest", S("high"), num(20)))
    bare = ast_interpret.interpret(cond, bars)
    first = ast_interpret.interpret(first_time(cond, 10), bars)
    assert sum(1 for v in bare[40:] if v == 1.0) == 80             # every bar
    assert sum(1 for v in first[40:] if v == 1.0) == 0             # never the FIRST in 10: it was true yesterday


def test_the_evaluation_case_is_the_taught_spelling_and_nothing_else():
    """The case graded end to end (door, browser, engine) answers with THIS file's spelling."""
    import io
    import json
    from pathlib import Path
    fx = Path(__file__).resolve().parent / "fixtures" / "authoring"
    cases = json.loads(io.open(fx / "converse_eval_convention_cases.json", encoding="utf-8").read())
    script = json.loads(io.open(fx / "converse_eval_convention_scripted.json", encoding="utf-8").read())["turns"]
    (case,) = [c for c in cases["cases"] if c["group"] == "example"]
    want = first_time(op(">=", S("close"), call("highest", S("close"), num(50))), 20)
    (turn,) = case["turns"]
    assert [o["tree"] for o in turn["expect"]["outputs"]] == [want]
    (answer,) = script[f"{case['id']}#0"]
    assert answer["ops"][0]["outputs"][0]["tree"] == want
    assert turn["expect"]["max_model_calls"] == 1 and turn["expect"]["presentation"] == {"marker": True}
