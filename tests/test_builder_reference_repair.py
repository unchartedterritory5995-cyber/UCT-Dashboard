"""2026-10-28 production failure -- a correct custom indicator refused in the browser.

The owner asked UCT Agent: "create a custom indicator that shows the difference
between the 9ema and 20ema as a percentage, put it in a separate pane". The
member read "UCT Intelligence proposed a change that does not fit this indicator,
so nothing was applied", which is the BROWSER engine's sentence for a patch the
model got wrong. The server's ``/converse`` gates had already answered ``ok``.

The gap: the browser refuses a whole patch whose names do not resolve
(``create:key-required``, ``output:*``, ``assumption:unknown-output`` /
``unknown-slot``), and the server checked none of them. A model that disclosed a
choice against a guessed slot id, or left a second output unkeyed, got no repair;
the member got a dead end for a correct formula.

These rails pin: the same rules run server-side (``_check_references``) and cost
the ONE bounded repair with the exact valid names; correct multi-series answers
still pass in one call; a reference the server cannot judge is left to the
browser; and a genuinely bad answer is still refused after its repair.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    CLOSE, call, conv, emits, empty_view, env, model, num, op, out, view,
)

REQUEST = ("create a custom indicator that shows the difference between the 9ema and "
           "20ema as a percentage, put it in a separate pane")
E9, E20 = call("ema", CLOSE, num(9)), call("ema", CLOSE, num(20))
PCT = op("*", op("/", op("-", E9, E20), E20), num(100))     # (EMA9 - EMA20) / EMA20 * 100


def create(outputs, **extra):
    return {"op": "create", "name": "EMA 9/20 % Diff", "placement": "pane", "outputs": outputs, **extra}


def good(**extra):
    return env(0, [create([{"key": "diff", "label": "EMA 9/20 % Diff", "tree": PCT}])],
               reply="Built the EMA 9/20 percentage difference in its own pane.", **extra)


def repair_text(client):
    """The diagnostic the model was handed on its repair turn."""
    block = client.calls[1]["messages"][-1]["content"][0]
    assert block["type"] == "tool_result" and block["is_error"] is True
    content = block["content"]
    return content if isinstance(content, str) else json.dumps(content)


# ═══ the exact production request ════════════════════════════════════════

def test_the_exact_request_with_a_correct_answer_passes_first_time_in_its_own_pane(conv, model):
    client = model([emits(good(assumptions=[{"text": "Both averages use the close."}]))])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["turn"] == "patch" and r["attempts"] == 1 and len(client.calls) == 1
    (c,) = r["envelope"]["ops"]
    assert c["op"] == "create" and c["placement"] == "pane" and c["outputs"][0]["tree"] == PCT


def test_a_guessed_slot_id_costs_the_repair_and_the_repair_names_the_real_ids(conv, model):
    """The production shape: a correct formula disclosed against a slot id that is not
    in it. Before: ok here, refused whole in the browser. Now: refused HERE at
    envelope:reference, repaired once with the tree's own slot ids, then ok."""
    bad = good(assumptions=[{"slot": "diff#0.0.0.2", "text": "Using closing prices."}])
    fixed = good(assumptions=[{"slot": "diff#0.0.0.0", "text": "Using closing prices."}])
    client = model([emits(bad), emits(fixed)])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == "envelope:reference"
    text = repair_text(client)
    assert "diff#0.0.0.2" in text and "diff#0.0.0.1 = 9" in text and "diff#0.0.1.1 = 20" in text
    assert "`text` alone" in text


def test_an_assumption_naming_an_output_that_does_not_exist_is_repaired(conv, model):
    bad = good(assumptions=[{"output": "pct_diff", "text": "Shown as a percentage."}])
    fixed = good(assumptions=[{"output": "diff", "text": "Shown as a percentage."}])
    client = model([emits(bad), emits(fixed)])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == "envelope:reference"
    assert "'pct_diff'" in repair_text(client) and "diff" in repair_text(client)


def test_a_second_output_with_no_key_is_repaired(conv, model):
    bad = env(0, [create([{"key": "ema9", "tree": E9, "hidden": True}, {"tree": PCT}])], reply="Built it.")
    client = model([emits(bad), emits(good())])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == "envelope:reference"
    assert "needs its own `key`" in repair_text(client)


def test_separate_pane_said_as_a_placement_word_is_still_repaired_by_the_schema(conv, model):
    """The handoff's other local shape: `placement: "separate"` is outside the enum and
    already costs the schema repair (unchanged)."""
    bad = env(0, [create([{"key": "diff", "tree": PCT}], placement="separate")], reply="Built it.")
    client = model([emits(bad), emits(good())])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["usage"]["repair_gate"] == "envelope:schema"
    assert "ops/0/placement: 'separate' is not one of ['pane', 'price']" in repair_text(client)


def test_a_reference_that_stays_wrong_after_the_repair_is_refused_and_the_member_reads_no_ids(conv, model):
    bad = good(assumptions=[{"slot": "diff#9", "text": "x"}])
    client = model([emits(bad), emits(bad)])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == "envelope:reference" and len(client.calls) == 2
    assert "envelope" not in r and "#" not in r["reason"] and "slot" not in r["reason"]


# ═══ related valid multi-series maths: one call, no repair ═══════════════

SMA = lambda n: call("sma", CLOSE, num(n))          # noqa: E731


@pytest.mark.parametrize("label,ops,assumptions", [
    ("helpers plus the percentage, primary named",
     [create([{"key": "ema9", "tree": E9, "hidden": True}, {"key": "ema20", "tree": E20, "hidden": True},
              {"key": "pct", "tree": PCT}], primary="pct")],
     [{"slot": "pct#0.0.0.1", "text": "The member's 9."}]),
    ("a first output with no key, disclosed as value#...",
     [create([{"tree": PCT}])], [{"slot": "value#1", "text": "Scaled to percent."}]),
    ("close as a percentage of its 50 SMA",
     [create([{"key": "dist", "tree": op("*", op("/", op("-", CLOSE, SMA(50)), SMA(50)), num(100))}])],
     [{"output": "dist", "text": "Measured from the close."}]),
    ("two outputs: SMA spread and its own 9-bar EMA",
     [create([{"key": "spread", "tree": op("-", SMA(10), SMA(30))},
              {"key": "signal", "tree": call("ema", op("-", SMA(10), SMA(30)), num(9))}])],
     [{"slot": "signal#1", "text": "A 9-bar signal line."}]),
])
def test_valid_multi_series_indicators_pass_in_one_call(conv, model, label, ops, assumptions):
    client = model([emits(env(0, ops, reply="Built it.", assumptions=assumptions))])
    r = conv.converse(REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, label


# ═══ never stricter than the browser on an existing indicator ════════════

def _existing(slots=("diff#1",)):
    return view(3, [out("diff", PCT, type_="series",
                        slots=[{"id": s, "kind": "number", "value": 100} for s in slots])],
                name="EMA 9/20 % Diff")


def test_a_slot_shown_in_the_view_passes(conv, model):
    e = env(3, [{"op": "set_slot", "slot": "diff#1", "value": 1000}], reply="Scaled by 1000.",
            assumptions=[{"slot": "diff#1", "text": "x"}])
    model([emits(e)])
    assert conv.converse("make it 1000", user_id="u1", view=_existing())["ok"] is True


def test_a_slot_not_in_the_view_is_repaired_with_the_views_ids(conv, model):
    bad = env(3, [{"op": "set_slot", "slot": "diff#1", "value": 1000}], reply="x",
              assumptions=[{"slot": "diff#7", "text": "x"}])
    ok = env(3, [{"op": "set_slot", "slot": "diff#1", "value": 1000}], reply="x")
    client = model([emits(bad), emits(ok)])
    r = conv.converse("make it 1000", user_id="u1", view=_existing())
    assert r["ok"] is True and r["usage"]["repair_gate"] == "envelope:reference"
    assert "diff#1" in repair_text(client)


def test_a_slot_on_an_output_this_turn_reshapes_is_left_to_the_browser(conv, model):
    """add_clause moves slot ids; the server cannot know the result's ids, so it passes."""
    cond = op(">", CLOSE, E20)
    v = view(2, [out("value", cond, slots=[{"id": "value#1", "kind": "series", "value": "close"}])])
    e = env(2, [{"op": "add_clause", "output": "value", "join": "and", "tree": op(">", E9, E20)}],
            reply="Added it.", assumptions=[{"slot": "value#1.1", "text": "x"}])
    model([emits(e)])
    r = conv.converse("and the 9 ema above the 20 ema", user_id="u1", view=v)
    assert r.get("gate") != "envelope:reference"


# ═══ server and browser name the same slots ══════════════════════════════

CASES = json.loads((Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart"
                    / "builder" / "authoring" / "slotIdCases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_server_slot_ids_match_the_browser_fixture(conv, case):
    assert [sid for sid, _ in conv._slots_of_tree(case["key"], case["tree"])] == case["ids"]


def test_the_fixture_is_not_empty():
    assert len(CASES) >= 3 and all(c["ids"] for c in CASES)
