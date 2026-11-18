"""TWO GUARDS ADDED AFTER THE 2026-11-18 INCIDENT (rulings of that day).

The incident: one deep answer with one refused piece ran the contract check for ten minutes, held
the member's "one call in flight" slot the whole time, and stalled the pod
(`tests/test_contract_check_is_linear.py` holds the fix for the check itself). Two things nothing
bounded are bounded here:

1. THE SIZE OF AN ANSWER. Refused by name, BEFORE anything examines it, when a formula holds more
   nodes or nests deeper than the caps. Sized from what is real, with four times the headroom.
2. THE LENGTH OF A TURN. A wall-clock ceiling. When it passes the member is answered by name,
   their slot is freed, and the turn is recorded as an internal error.
"""
from __future__ import annotations

import copy
import json
import pathlib
import threading
import time

import pytest

from api.services import definition_concierge as dc
from api.services import indicator_telemetry as tel
from api.services import named_indicators as ni
from tests.test_indicator_memory import account, memory_of  # noqa: F401 -- fixtures by name
from tests.test_learned_record import last_turn
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
GOOD = call("ema", S("close"), num(20))


def answer(tree):
    return env(0, [{"op": "create", "name": "x", "placement": "price", "outputs": [{"key": "a", "tree": tree}]}])


def chain(depth, leaf=None):
    """A formula `depth` levels deep, built without recursion."""
    node = leaf if leaf is not None else S("close")
    for _ in range(depth - 1):
        node = op("+", node, num(1))
    return node


def size_of(tree):
    nodes, deepest, stack = 0, 0, [(tree, 1)]
    while stack:
        n, d = stack.pop()
        if isinstance(n, dict):
            nodes, deepest = nodes + 1, max(deepest, d)
            stack.extend((a, d + 1) for a in n.get("args") or [])
    return nodes, deepest


def formulas_on_file():
    found = [(f"library {e['id']}.{o['key']}", o["tree"]) for e in ni.entries() for o in e["outputs"]]

    def walk(value, where):
        if isinstance(value, dict):
            for k, v in value.items():
                if k in ("tree", "when") and isinstance(v, dict):
                    found.append((where, v))
                else:
                    walk(v, where)
        elif isinstance(value, list):
            for v in value:
                walk(v, where)
    for path in sorted((ROOT / "tests" / "fixtures" / "authoring").glob("*.json")):
        try:
            walk(json.loads(path.read_text(encoding="utf-8")), path.name)
        except ValueError:
            continue
    return found


# ═══ 1. the size of an answer ═══════════════════════════════════════════════

def test_the_caps_leave_four_times_the_largest_formula_on_file(conv):
    """A library entry or an evaluation case that outgrows the headroom fails HERE, where it is a
    decision, and never as a refused member."""
    formulas = formulas_on_file()
    assert len(formulas) > 200
    most = max(size_of(t)[0] for _, t in formulas)
    deepest = max(size_of(t)[1] for _, t in formulas)
    assert (most, deepest) == (107, 16)                                      # 70 and 12 before linked running values; a change is seen
    assert most * 4 <= conv.MAX_FORMULA_NODES == 600 and deepest * 4 <= conv.MAX_FORMULA_DEPTH == 64
    for where, tree in formulas:
        assert conv.answer_size_problem(answer(tree)) is None, where
    # the property names typed in the check are the contract's own
    schema = conv.composed_schema()
    kinds = conv._linear_validators()[2]
    held_under = {prop for name, d in schema["$defs"].items() if name not in kinds
                  for prop, sub in (d.get("properties") or {}).items() if sub == {"$ref": "#/$defs/node"}}
    assert conv._SIZED_FORMULA_KEYS == held_under == frozenset({"tree", "when"})
    # and a whole answer: the largest scripted one, four times over, is inside the cap
    def values_in(v):
        n, stack = 0, [v]
        while stack:
            x = stack.pop()
            if isinstance(x, (dict, list)):
                n += len(x)
                stack.extend(x.values() if isinstance(x, dict) else x)
        return n
    scripted = []
    for path in sorted((ROOT / "tests" / "fixtures" / "authoring").glob("*scripted*.json")):
        for answers in (json.loads(path.read_text(encoding="utf-8")).get("turns") or {}).values():
            scripted.extend(a for a in (answers if isinstance(answers, list) else []) if isinstance(a, dict))
    assert len(scripted) > 100
    largest = max(values_in(a) for a in scripted)
    assert 200 < largest and largest * 4 <= conv.MAX_ANSWER_ITEMS == 20000, largest      # 371 on 2026-11-18
    assert all(conv.answer_size_problem(a) is None for a in scripted)
    assert conv.MAX_ANSWER_DEPTH == 2 * conv.MAX_FORMULA_DEPTH + 16


def test_a_formula_over_either_cap_is_named(conv):
    assert conv.answer_size_problem(answer(chain(conv.MAX_FORMULA_DEPTH))) is None
    assert conv.answer_size_problem(answer(chain(conv.MAX_FORMULA_DEPTH + 1))) == "a formula nests more than 64 levels deep"
    wide = call("max", *[copy.deepcopy(GOOD) for _ in range(199)])          # 1 + 199 x 3 = 598 nodes
    assert size_of(wide)[0] == 598 and conv.answer_size_problem(answer(wide)) is None
    wide["args"].append(copy.deepcopy(GOOD))                                 # 601
    assert conv.answer_size_problem(answer(wide)) == "a formula holds more than 600 nodes"
    # each formula is counted on its own: eight outputs at 200 nodes each are eight formulas
    big = call("max", *[copy.deepcopy(GOOD) for _ in range(66)])
    several = env(0, [{"op": "create", "name": "x", "placement": "price",
                       "outputs": [{"key": f"o{i}", "tree": copy.deepcopy(big)} for i in range(8)]}])
    assert conv.answer_size_problem(several) is None
    # nesting that is not through `args` is nesting too (a shape the contract does not have)
    odd = S("close")
    for _ in range(conv.MAX_FORMULA_DEPTH + 2):
        odd = {"type": "op", "name": "+", "inside": odd}
    assert conv.answer_size_problem(answer(odd)) == "a formula nests more than 64 levels deep"
    # values are counted BEFORE they are walked, whatever they are: a long list of plain numbers too
    assert conv.answer_size_problem({"ops": [[0] * (conv.MAX_ANSWER_ITEMS - 2)]}) is None
    assert conv.answer_size_problem({"ops": [[0] * (conv.MAX_ANSWER_ITEMS + 1)]}) == "the answer holds more than 20000 values"
    for nothing in (None, "x", 3, [], {}):
        assert conv.answer_size_problem(nothing) is None


@pytest.mark.parametrize("shape", ["100,000 levels deep", "a million nodes wide", "deep outside any formula"])
def test_a_pathological_answer_is_refused_in_milliseconds(conv, shape):
    if shape == "100,000 levels deep":
        bad = answer(chain(100_000))
    elif shape == "a million nodes wide":
        bad = answer(call("max", *[S("close")] * 1_000_000))
    else:
        nest = []
        for _ in range(10_000):
            nest = [nest]
        bad = {**answer(copy.deepcopy(GOOD)), "extra": nest}
    started = time.monotonic()
    said = conv.answer_size_problem(bad)
    took = time.monotonic() - started
    assert said and took < 0.25, (said, took)


def test_through_the_door_it_is_refused_by_name_before_anything_walks_it(store, conv, clean_env, model, monkeypatch):
    """ONE model call (it is not sent back for a second), the member's sentence, and the next
    request is answered. And nothing that examines an answer was reached."""
    for name in ("_unwrap_input", "mend", "check_envelope", "_schema_errors"):
        monkeypatch.setattr(conv, name, lambda *a, **k: (_ for _ in ()).throw(AssertionError("an oversize answer was examined")))
    client = model([emits(answer(chain(4000, call("noSuchFunction", S("close"))))), emits(answer(copy.deepcopy(GOOD)))])
    started = time.monotonic()
    r = conv.converse("Add an adaptive average", user_id="u1", view=empty_view(0), chart=CHART)
    assert time.monotonic() - started < 5.0
    assert r["ok"] is False and r["gate"] == "envelope:formula-size" and len(client.calls) == 1
    assert r["reason"] == "the UCT Agent wrote a formula too large to check, so nothing was changed"
    assert "envelope" not in r and last_turn()["failure_class"] == "model_invalid"
    monkeypatch.undo()


# ── the same guard AFTER the mend that inlines the outputs a formula reads ──

def stage_oscillator():
    """The largest legitimate inlined answer on file: four hidden filter stages (each one value of
    the same four linked running values) and one line drawn from all four, written with the
    stages' KEYS. The door writes each stage's formula into every place the line reads it."""
    from tests.test_converse_running_values_linked import laguerre

    def stage(k):
        tree = laguerre(0.5)
        tree["args"][0] = num(k)
        return tree
    up = lambda p, q: op("?:", op(">=", S(p), S(q)), op("-", S(p), S(q)), num(0))  # noqa: E731
    dn = lambda p, q: op("?:", op("<", S(p), S(q)), op("-", S(q), S(p)), num(0))  # noqa: E731
    cu = op("+", op("+", up("l0", "l1"), up("l1", "l2")), up("l2", "l3"))
    cd = op("+", op("+", dn("l0", "l1"), dn("l1", "l2")), dn("l2", "l3"))
    outs = [{"key": f"l{k - 1}", "label": f"Stage {k}", "hidden": True, "tree": stage(k)} for k in (1, 2, 3, 4)]
    outs.append({"key": "line", "label": "Oscillator", "tree": op("/", cu, op("+", cu, cd))})
    return env(0, [{"op": "create", "name": "Four-stage oscillator", "placement": "pane", "primary": "line", "outputs": outs}],
               reply="Built it.")


def inlined_nodes(answer_):
    return sum(size_of(o["tree"])[0] for o in answer_["ops"][0]["outputs"])


def test_the_inlined_cap_leaves_four_times_the_largest_inlined_answer_on_file(conv):
    written = stage_oscillator()
    assert conv.answer_size_problem(written) is None and size_of(written["ops"][0]["outputs"][-1]["tree"])[0] == 80
    mended, names = conv.mend(written, empty_view(0))
    assert names == [conv.MEND_OUTPUT_REF]
    total = inlined_nodes(mended)
    assert total == 3364 and size_of(mended["ops"][0]["outputs"][-1]["tree"])[0] == 3032      # what is checked and held
    assert total * 4 <= conv.MAX_INLINED_NODES == 15000
    assert conv.check_envelope(mended, 0, empty_view(0))                                     # and it IS a legitimate answer


def reads_many(times):
    """Output `a` is a hundred averages (311 nodes, ten to a call as the contract allows); output
    `b` reads `a` `times` times."""
    a = call("max", *[call("max", *[copy.deepcopy(GOOD) for _ in range(10)]) for _ in range(10)])
    assert size_of(a)[0] == 311
    b = S("a")
    for _ in range(times - 1):
        b = op("+", b, S("a"))
    return env(0, [{"op": "create", "name": "x", "placement": "price",
                    "outputs": [{"key": "a", "tree": a}, {"key": "b", "tree": b}]}])


def test_an_answer_whose_inlined_form_is_over_the_cap_is_refused_by_name_while_the_mend_writes_it(store, conv, clean_env, model):
    under = reads_many(40)                            # 311 nodes read 40 times: about 12,800 once inlined
    mended, names = conv.mend(under, empty_view(0))
    assert names == [conv.MEND_OUTPUT_REF] and inlined_nodes(mended) < conv.MAX_INLINED_NODES
    over = reads_many(50)                             # ... 50 times: about 16,000
    assert conv.answer_size_problem(over) is None     # AS WRITTEN it is small: 311 nodes and 99
    started = time.monotonic()
    with pytest.raises(conv._Refused) as caught:
        conv.mend(over, empty_view(0))
    assert time.monotonic() - started < 2.0           # stopped at the cap, not after building it
    assert caught.value.gate == "envelope:formula-size"
    assert caught.value.detail == ("the answer holds more than 15000 formula nodes once the outputs its formulas read are "
                                   "written into them")
    # through the door: one model call, the member's sentence, nothing built, and the next request is answered
    client = model([emits(over), emits(answer(copy.deepcopy(GOOD)))])
    r = conv.converse("Add an adaptive average", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "envelope:formula-size" and len(client.calls) == 1
    assert r["reason"] == "the UCT Agent wrote a formula too large to check, so nothing was changed"
    assert "envelope" not in r and last_turn()["failure_class"] == "model_invalid"
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 2


def test_any_other_trouble_inside_a_mend_still_costs_nothing(conv, monkeypatch):
    """A mend never costs the turn: only the size cap is allowed out of it."""
    monkeypatch.setattr(conv, "_mend_output_refs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    written = stage_oscillator()
    assert conv.mend(written, empty_view(0)) == (written, [])


# ═══ 2. the length of a turn ════════════════════════════════════════════════

def slow_model(conv, monkeypatch, seconds):
    """Make every model call take `seconds`; returns the event set when a slow call has ended."""
    real, ended = conv._call_model, threading.Event()

    def slow(messages):
        try:
            time.sleep(seconds)
            return real(messages)
        finally:
            ended.set()
    monkeypatch.setattr(conv, "_call_model", slow)
    return ended


def test_a_turn_that_runs_past_the_ceiling_is_answered_by_name_and_the_account_is_freed(
        store, conv, account, clean_env, model, monkeypatch):
    assert conv.TURN_CEILING_S == 90.0
    monkeypatch.setattr(conv, "TURN_CEILING_S", 0.4)
    mem = memory_of(account)
    kind = conv.clarify_question("average_kind")
    snippets = [{"role": "member", "text": "Add a 20 day moving average"}, {"role": "assistant", "text": kind["text"]}]
    # (an answer to one of the door's questions: what the member SAID is theirs and is remembered
    # when they say it, before any call; what the turn would have BUILT is what is not offered)
    client = model([emits(answer(copy.deepcopy(GOOD)))])
    ended = slow_model(conv, monkeypatch, 1.5)
    started = time.monotonic()
    r = conv.converse("Exponential (EMA)", user_id="u1", view=empty_view(0), chart=CHART, snippets=snippets, memory=mem)
    took = time.monotonic() - started
    assert 0.3 < took < 1.2, took                                            # at the ceiling, not when the call ended
    assert r["ok"] is False and r["gate"] == "internal:timeout" and "envelope" not in r
    assert r["reason"] == "That took too long on our side and nothing was changed. Try again."
    # recorded as an internal error, so the weekly report counts it
    assert last_turn()["failure_class"] == "internal"
    assert tel.weekly_report(7)["internal_error"]["this"]["turns"] == 1
    # THE SLOT IS FREE NOW, while the abandoned call is still running
    assert not ended.is_set()
    with dc.interactive_slot("u1") as free:
        assert free is True
    # when the abandoned call ends: it was paid for and is in the ledger, and no change was offered
    assert ended.wait(5.0)
    time.sleep(0.3)
    assert len(client.calls) == 1
    assert dc.spend_for("u1") > 0
    assert mem.choice("average_kind")["value"] == "ema"                     # the member's own answer stands


def test_a_turn_abandoned_at_the_ceiling_makes_no_second_model_call(store, conv, clean_env, model, monkeypatch):
    """Its first answer is one the door would send back for repair. The member has been answered,
    so the repair call is never made."""
    monkeypatch.setattr(conv, "TURN_CEILING_S", 0.4)
    bad = answer(call("noSuchFunction", S("close")))
    client = model([emits(bad), emits(answer(copy.deepcopy(GOOD)))])
    ended = slow_model(conv, monkeypatch, 1.0)
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["gate"] == "internal:timeout"
    assert ended.wait(5.0)
    time.sleep(1.8)                 # longer than a whole second call would take: it had time to happen
    assert len(client.calls) == 1


def test_a_turn_inside_the_ceiling_is_untouched_and_a_turn_that_raises_is_answered(store, conv, clean_env, model, monkeypatch):
    client = model([emits(answer(copy.deepcopy(GOOD)))])
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    assert r["usage"]["calls"] == 1 and last_turn()["failure_class"] == "ok"

    def broken(*_a, **_k):
        raise RuntimeError("a defect of ours, outside every net")
    monkeypatch.setattr(conv, "_converse_turn", broken)
    r = conv.converse("Add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "internal:error" and r["reason"] == dc.REFUSALS["internal:error"]
    with dc.interactive_slot("u1") as free:
        assert free is True


def test_the_window_says_the_same_sentence():
    import re
    js = (ROOT / "app/src/components/chart/builder/authoring/memberWords.js").read_text(encoding="utf-8")
    code = "\n".join(line for line in re.sub(r"/\*.*?\*/", "", js, flags=re.S).splitlines() if not line.lstrip().startswith("//"))
    (line,) = [ln for ln in code.splitlines() if ln.startswith("export const TOOK_TOO_LONG = ")]
    assert line == "export const TOOK_TOO_LONG = 'That took too long on our side and nothing was changed. Try again.'"
    assert "  if (g === 'internal:timeout') return TOOK_TOO_LONG" in code
