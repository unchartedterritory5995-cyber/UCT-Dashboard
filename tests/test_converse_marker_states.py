"""Color states on an output drawn as markers are caught at the door, not in the browser.

Measured on production, 2026-11-17 (the second exploratory round): a TTM squeeze, "dots on the zero
line red while the Bollinger Bands are inside the Keltner Channels and green when they are not",
came back as one output with BOTH `set_marker` and `set_color_states`. The door answered ok; the
browser refused the whole patch ("is drawn as markers; colour states need a line or histogram") and
the member read a red error.

  1. that answer is refused here with the two ways out, and the repair builds the squeeze;
  2. judged in patch order, exactly as the browser applies it (never stricter): color states
     BEFORE the marker, a marker removed first, a different output, and a line with no marker
     all pass;
  3. an output the VIEW already draws as markers is covered too;
  4. the instructions say there is no dots style and how to draw dots that change color.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
GATE = "envelope:reference"
SQUEEZE_ON = op("<", call("bbUpper", S("close"), num(20), num(2)), call("kcUpper", S("close"), num(20), num(1.5)))
STATES = {"op": "set_color_states", "output": "dot", "states": [{"when": SQUEEZE_ON, "color": "#F23645"}],
          "otherwise": "#089981"}
MARKER = {"op": "set_marker", "output": "dot", "shape": "circle", "position": "inBar"}
CREATE = {"op": "create", "name": "TTM Squeeze", "placement": "pane",
          "outputs": [{"key": "mom", "tree": call("linreg", S("close"), num(20))},
                      {"key": "dot", "tree": op("*", S("close"), num(0))}]}


def _refusal(conv, ops, v=None, revision=0):
    with pytest.raises(conv._Refused) as exc:
        conv.check_envelope(env(revision, ops), revision, v if v is not None else empty_view(0))
    assert exc.value.gate == GATE
    return exc.value.detail


def test_the_measured_answer_is_refused_with_both_ways_out(conv):
    detail = _refusal(conv, [CREATE, MARKER, STATES])
    assert "'dot' is drawn as markers" in detail
    assert "leave it a line (no set_marker" in detail
    assert "one yes/no output per color, each with its own set_marker color" in detail


def test_the_repair_builds_the_squeeze(conv, clean_env, model):
    good = env(0, [CREATE, {"op": "set_style", "output": "dot", "style": "line", "width": 4}, STATES])
    client = model([emits(env(0, [CREATE, MARKER, STATES])), emits(good)])
    # (the production request was "TTM squeeze with dots on the zero line". Since 2026-11-18 "TTM
    # Squeeze" is a HELD name, refused by name unless the member describes the rule; this is that
    # request with the rule described, which is what the repair under test needs.)
    r = conv.converse("Bollinger Bands inside the Keltner Channels, with dots on the zero line", user_id="u1",
                      view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == GATE
    assert "drawn as markers" in str(client.calls[1]["messages"][-1]["content"][0]["content"])


def test_never_stricter_than_the_browser(conv):
    ok = lambda ops, v=None, rev=0: conv.check_envelope(env(rev, ops), rev, v if v is not None else empty_view(0))  # noqa: E731
    assert ok([CREATE, STATES])                                              # a line, no marker
    assert ok([CREATE, STATES, MARKER])                                      # the browser judges this order itself
    assert ok([CREATE, MARKER, {"op": "remove_marker", "output": "dot"}, STATES])
    assert ok([CREATE, MARKER, {"op": "set_style", "output": "dot", "style": "line"}, STATES])
    assert ok([CREATE, {"op": "set_marker", "output": "mom", "shape": "circle"}, STATES])   # another output's marker
    assert ok([CREATE, MARKER,
               {"op": "set_color_states", "channel": "bgcolor", "states": [{"when": SQUEEZE_ON, "color": "#F23645"}],
                "otherwise": "#089981"}])                                    # the background, not the dots


def test_an_output_the_view_already_draws_as_markers_is_covered(conv):
    row = out("dot", op(">", S("close"), S("open")), label="Up day")
    row["presentation"] = dict(row.get("presentation") or {}, marker={"shape": "circle", "position": "belowBar"})
    v = view(1, [row])
    states = {"op": "set_color_states", "output": "dot", "states": [{"relation": "rising", "color": "#089981"}],
              "otherwise": "#F23645"}
    assert "'dot' is drawn as markers" in _refusal(conv, [states], v, revision=1)
    # the marker removed in the same patch, first: the browser's to judge
    assert conv.check_envelope(env(1, [{"op": "remove_marker", "output": "dot"}, states]), 1, v)


def test_the_instructions_say_there_is_no_dots_style_and_how_to_draw_colored_dots():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "there is no dots style" in text
    assert "an output drawn as markers cannot also take set_color_states" in text
    assert "draw a thick line on that constant level with set_color_states" in text
    assert "one yes/no output per color, each with its own set_marker color" in text
