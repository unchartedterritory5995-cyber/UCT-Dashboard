"""2026-11-02 -- OPEN-FINDINGS-2026-10 §3: a line is renamed only in the member's words.

Measured in production on 10-08: "make the RSI length 28 and call it Momentum Pulse"
renamed the INDICATOR to "Momentum Pulse" (asked) and ALSO relabelled the RSI LINE to
"Momentum" (never asked). Only the prompt forbade it. ``check_output_renames`` is the
server-side gate: an unrequested ``rename_output`` of an existing line is refused at
``envelope:rename-unrequested`` and costs the ONE bounded repair, like every envelope
gate; it is never silently stripped.
"""
from __future__ import annotations

import inspect

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, env, model, out, view,
)

MEASURED = "Okay, make the RSI length 28 and call it Momentum Pulse."
SET_28 = {"op": "set_slot", "slot": "value#1", "value": 28}
RENAME_DEF = {"op": "rename_definition", "name": "Momentum Pulse"}
GATE = "envelope:rename-unrequested"


def _view():
    return view(1, [out("value", RSI_GT_70, label="RSI")])


def test_the_measured_unrequested_line_rename_is_refused_and_repaired(conv, model):
    """ASKED: does the 10-08 patch still reach the member? CLAIMED: no. DID: the
    first answer (rename_definition + rename_output "Momentum") is refused at the
    gate; the repair without the line rename is accepted; 2 calls."""
    bad = env(1, [SET_28, RENAME_DEF, {"op": "rename_output", "output": "value", "label": "Momentum"}])
    good = env(1, [SET_28, RENAME_DEF])
    client = model([emits(bad), emits(good)])
    r = conv.converse(MEASURED, user_id="u1", view=_view())
    assert r["ok"] is True and r["envelope"] == good
    assert r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == GATE
    last = client.calls[1]["messages"][-1]["content"][0]
    assert last["type"] == "tool_result" and last["is_error"] is True
    assert "rename_output" in str(last["content"])       # the model is told what to drop


def test_a_model_that_insists_is_refused_with_member_words_only(conv, model):
    bad = env(1, [SET_28, RENAME_DEF, {"op": "rename_output", "output": "value", "label": "Momentum"}])
    model([emits(bad), emits(bad)])
    r = conv.converse(MEASURED, user_id="u1", view=_view())
    assert r["ok"] is False and r["gate"] == GATE
    assert "rename_output" not in r["reason"] and "ops[" not in r["reason"]
    assert r["reason"].startswith(conv.REFUSALS[GATE])


def test_a_line_the_member_names_in_their_own_words_is_renamed(conv, model):
    good = env(1, [{"op": "rename_output", "output": "value", "label": "Fast RSI"}])
    client = model([emits(good)])
    r = conv.converse("rename the RSI line to Fast RSI", user_id="u1", view=_view())
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1


def test_the_members_explicit_name_may_be_the_lines_label(conv, model):
    """One-output definitions: the plot label follows the indicator's name
    (``readback.outputNamer``), so the member's exact cue name is allowed."""
    good = env(1, [SET_28, RENAME_DEF, {"op": "rename_output", "output": "value", "label": "Momentum Pulse"}])
    model([emits(good)])
    assert conv.converse(MEASURED, user_id="u1", view=_view())["ok"] is True


def test_a_line_added_in_the_same_patch_may_be_labelled_freely(conv, model):
    good = env(1, [{"op": "add_output", "key": "avg", "tree": RSI_GT_70},
                   {"op": "rename_output", "output": "avg", "label": "Smoothed"}])
    model([emits(good)])
    r = conv.converse("add a smoothed line", user_id="u1", view=_view())
    assert r["ok"] is True and r["attempts"] == 1


def test_renaming_a_line_to_the_label_it_already_has_is_not_a_rename(conv, model):
    good = env(1, [SET_28, {"op": "rename_output", "output": "value", "label": "rsi"}])
    model([emits(good)])
    assert conv.converse("make it 28", user_id="u1", view=_view())["ok"] is True


def test_a_fragment_of_the_indicator_name_is_not_a_line_name(conv):
    """The direct function, no model: the cue name belongs to the INDICATOR."""
    e = env(1, [RENAME_DEF, {"op": "rename_output", "output": "value", "label": "Pulse"}])
    try:
        conv.check_output_renames(e, MEASURED, _view())
    except conv._Refused as refused:
        assert refused.gate == GATE
    else:
        raise AssertionError("an unrequested line rename passed the gate")


def test_the_gate_is_wired_into_the_repairable_check(conv):
    """The wire, not just the function: it runs right after ``check_envelope``
    inside the same ``try`` so a refusal pays the repair."""
    src = inspect.getsource(conv._converse_turn)
    a = src.index("envelope = check_envelope(candidate, revision, view)")
    b = src.index("check_output_renames(envelope, message, view)")
    c = src.index("except _Refused as refused:", a)
    assert a < b < c
