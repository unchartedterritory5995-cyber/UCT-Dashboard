"""The browser's `color:states-few` rule, mirrored at the server's door.

Found by the house set, 2026-11-16: asked for "green shading while it is above 1.2", the model
answered with ONE colour state and no `otherwise`. The browser's engine refuses that
(`applyPatch.set_color_states`), but this door had accepted it, so the model never got its one
repair and the member read a failure. The door now refuses it first, with the fix in the note.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, env, model, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

WHEN = {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 1}]}
ONE = {"op": "set_color_states", "channel": "bgcolor", "states": [{"color": "#089981", "when": WHEN}]}
ONLY_OTHERWISE = {"op": "set_color_states", "channel": "bgcolor", "states": [], "otherwise": "#787B86"}
TWO = {"op": "set_color_states", "channel": "bgcolor",
       "states": [{"color": "#089981", "when": WHEN}], "otherwise": "#787B86"}
VIEW = lambda: view(1, [out("value", RSI_GT_70)])  # noqa: E731


def test_one_state_with_no_otherwise_costs_the_repair_and_the_note_names_the_fix(conv, clean_env, model):
    client = model([emits(env(1, [ONE])), emits(env(1, [TWO]))])
    r = conv.converse("shade it green above 1", user_id="u1", view=VIEW())
    assert r["ok"] is True and r["attempts"] == 2
    note = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert note.startswith("[envelope:reference]")
    assert "set_paint" in note and "otherwise" in note


def test_twice_wrong_is_refused_before_the_browser_ever_sees_it(conv, clean_env, model):
    model([emits(env(1, [ONE])), emits(env(1, [ONE]))])
    r = conv.converse("shade it green above 1", user_id="u1", view=VIEW())
    assert r["ok"] is False and r["gate"] == "envelope:reference"


def test_an_otherwise_with_no_state_is_the_same_refusal(conv, clean_env, model):
    model([emits(env(1, [ONLY_OTHERWISE])), emits(env(1, [ONLY_OTHERWISE]))])
    r = conv.converse("shade it", user_id="u1", view=VIEW())
    assert r["ok"] is False and r["gate"] == "envelope:reference"


def test_CONTROL_one_state_plus_an_otherwise_passes_first_time(conv, clean_env, model):
    model([emits(env(1, [TWO]))])
    r = conv.converse("shade it green above 1, grey otherwise", user_id="u1", view=VIEW())
    assert r["ok"] is True and r["attempts"] == 1
