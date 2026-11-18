"""THE DOOR'S CONTRACT CHECK IS LINEAR IN THE SIZE OF THE ANSWER.

THE INCIDENT (production, 2026-11-18 10:36Z, found by a live check). The assistant answered "Add the
Fractal Adaptive Moving Average" with a deep formula holding one piece the contract refuses. The
turn never came back; for about ten minutes every other request from that account was answered
"still working on your previous request"; answers that take a second took 10 to 30; the pod was
restarted.

WHY. A formula node is `oneOf` eight kinds and six of them hold child nodes. On a node that FAILS,
the schema library collects every branch's errors in full, so it descends into the children under
each of the six at every enclosing level: about 6^depth. Measured on this box before the fix: one
invalid piece at depth 4 took 2 s, at depth 6 87 s, at depth 7 about ten minutes. A valid formula
never paid it, which is why no test had met it. It holds the interpreter lock, so the POD stalls.

THE RULE. The envelope is checked with every formula opaque, and each formula node is checked once
with its children opaque. Two things are held here:

1. it says EXACTLY what the full contract says (the same errors, the same words, the same order),
   on every scripted answer in the repo and on a family of broken ones;
2. it is linear: a broken piece 60 levels down is found in well under a second.
"""
from __future__ import annotations

import copy
import json
import pathlib
import time

import pytest

from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "authoring"
S = lambda n: {"type": "series", "name": n}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
GOOD = call("ema", S("close"), num(20))


def reference(conv, envelope):
    """The FULL contract, as the door checked it before 2026-11-18 (the recursive validator)."""
    errors = sorted((b for e in conv._validator().iter_errors(envelope) for b in conv._branch_errors(e)),
                    key=lambda e: [str(p) for p in e.absolute_path])
    return [f"{'/'.join(str(p) for p in e.absolute_path) or '(envelope)'}: {e.message[:200]}" for e in errors[:5]]


def scripted_envelopes():
    """Every answer scripted anywhere in the authoring fixtures: (where it is from, the envelope)."""
    found = []
    for path in sorted(FIXTURES.glob("*scripted*.json")):
        turns = json.loads(path.read_text(encoding="utf-8")).get("turns") or {}
        for key, answers in turns.items():
            for i, answer in enumerate(answers if isinstance(answers, list) else []):
                if isinstance(answer, dict) and "ops" in answer:
                    found.append((f"{path.name}:{key}[{i}]", answer))
    return found


SCRIPTED = scripted_envelopes()

#: ways a formula node can break the contract, each on a small node
BROKEN = {
    "a function that does not exist": call("noSuchFunction", S("close"), num(20)),
    "an operator that does not exist": op("%%", S("close"), num(2)),
    "a number written as text": {"type": "num", "value": "20"},
    "a call with no arguments list": {"type": "call", "name": "ema"},
    "a field the contract does not have": {**copy.deepcopy(GOOD), "comment": "x"},
    "a node that is a string": "close",
    "a kind that does not exist": {"type": "lambda", "args": [S("close")]},
    "an offset with no count": {"type": "offset", "args": [S("close")]},
    "two broken children": op("+", call("noSuchFunction", S("close")), {"type": "num", "value": "20"}),
    "a broken piece under a broken function": call("noSuchFunction", {"type": "num", "value": "20"}, num(20)),
    "a kind that does not exist, holding broken pieces": {"type": "textop", "name": "==", "args": [{"type": "symtext", "name": "sector"}, "x"]},
}


def wrapped(node, depth):
    for i in range(depth):
        node = op("+", node, num(1)) if i % 2 == 0 else call("ema", node, num(20))
    return node


def with_formula(tree, where="create"):
    if where == "create":
        return env(0, [{"op": "create", "name": "x", "placement": "price", "outputs": [{"key": "a", "tree": tree}]}])
    if where == "second output":
        return env(0, [{"op": "create", "name": "x", "placement": "price",
                        "outputs": [{"key": "a", "tree": copy.deepcopy(GOOD)}, {"key": "b", "tree": tree}]}])
    return env(0, [{"op": "set_output_tree", "output": "a", "tree": tree}])


# ═══ 1. it says exactly what the full contract says ═════════════════════════

def test_every_scripted_answer_in_the_repo_gets_the_full_contracts_verdict(conv):
    assert len(SCRIPTED) > 40
    differing = [(name, conv._schema_errors(e), reference(conv, e)) for name, e in SCRIPTED
                 if conv._schema_errors(e) != reference(conv, e)]
    assert differing == []
    # CONTROL: they are not all the trivial case (some scripted answers are refused on purpose)
    assert any(conv._schema_errors(e) for _, e in SCRIPTED) or all(not reference(conv, e) for _, e in SCRIPTED)


@pytest.mark.parametrize("where", ["create", "second output", "set_output_tree"])
@pytest.mark.parametrize("depth", [0, 1, 2, 3])
@pytest.mark.parametrize("how", sorted(BROKEN))
def test_a_broken_formula_gets_the_full_contracts_errors_word_for_word(conv, how, depth, where):
    envelope = with_formula(wrapped(copy.deepcopy(BROKEN[how]), depth), where)
    want = reference(conv, envelope)
    assert want, "the case is meant to break the contract"
    assert conv._schema_errors(envelope) == want


def test_what_breaks_outside_a_formula_is_said_as_before_and_beside_a_broken_formula(conv):
    for envelope in (
        env(0, [{"op": "create", "name": "x", "placement": "separate", "outputs": [{"key": "a", "tree": copy.deepcopy(GOOD)}]}]),
        env(0, [{"op": "noSuchOp"}]),
        {**with_formula(copy.deepcopy(GOOD)), "extra": 1},
        env(0, [{"op": "create", "name": "x", "placement": "separate",
                 "outputs": [{"key": "a", "tree": wrapped(copy.deepcopy(BROKEN["a number written as text"]), 2)}]}]),
        {"contract": "nope"},
        [],
        None,
    ):
        want = reference(conv, envelope)
        assert want and conv._schema_errors(envelope) == want, envelope


def test_a_colour_rules_condition_is_a_formula_too(conv):
    """The contract holds a formula in two kinds of place: a `tree`, and a colour state's `when`."""
    _, _, roots, kinds = conv._linear_validators()
    assert kinds == frozenset({"num", "series", "op", "call", "offset", "sym", "tf", "tf_live"})
    assert roots == frozenset({"tree", "when"})
    states = next((o for _, e in SCRIPTED for o in e["ops"] if o.get("op") == "set_color_states"), None)
    assert states is not None, "no scripted answer sets colour states: add one to this test by hand"
    good = env(0, [copy.deepcopy(states)])
    assert conv._schema_errors(good) == reference(conv, good)
    broken = copy.deepcopy(good)
    place = next(s for s in broken["ops"][0]["states"] if isinstance(s, dict) and "when" in s)
    place["when"] = wrapped(copy.deepcopy(BROKEN["a function that does not exist"]), 2)
    want = reference(conv, broken)
    assert want and any("/when/" in line for line in want)
    assert conv._schema_errors(broken) == want


# ═══ 2. it is linear ════════════════════════════════════════════════════════

@pytest.mark.parametrize("depth", [5, 7, 12, 60])
def test_one_broken_piece_deep_in_a_formula_is_found_at_once(conv, depth):
    """Depth 7 took about ten minutes before the fix, and each level more multiplied it by six."""
    envelope = with_formula(wrapped(call("noSuchFunction", S("close")), depth))
    started = time.monotonic()
    said = conv._schema_errors(envelope)
    took = time.monotonic() - started
    assert took < 2.0, f"{took:.1f} s at depth {depth}"
    assert len(said) == 1 and "'noSuchFunction' is not one of" in said[0]
    assert said[0].startswith("ops/0/outputs/0/tree" + "/args/0" * depth + "/name: ")       # found where it is


def test_a_wide_and_deep_valid_formula_costs_its_size(conv):
    tree = copy.deepcopy(GOOD)
    for _ in range(9):
        tree = op("+", tree, copy.deepcopy(tree))                # 512 leaves' worth of nodes
    started = time.monotonic()
    assert conv._schema_errors(with_formula(tree)) == []
    assert time.monotonic() - started < 5.0


def test_the_whole_turn_comes_back_and_the_account_is_free_again(store, conv, clean_env, model):
    """THE INCIDENT, end to end: a deep answer with one refused piece, twice (the repair is as bad).
    The member is answered at once and their next request is not 'still working'."""
    bad = with_formula(wrapped(call("noSuchFunction", S("close")), 14))
    client = model([emits(bad), emits(bad)])
    started = time.monotonic()
    r = conv.converse("Add an adaptive average that follows the fractal dimension", user_id="u1", view=empty_view(0),
                      chart={"sym": "NVDA", "tf": "D"})
    assert time.monotonic() - started < 10.0
    assert r["ok"] is False and str(r["gate"]).startswith("envelope:") and len(client.calls) == 2
    client = model([emits(with_formula(copy.deepcopy(GOOD)))])
    again = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart={"sym": "NVDA", "tf": "D"})
    assert again.get("gate") != "rate:busy" and again["ok"] is True
