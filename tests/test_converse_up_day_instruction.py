"""The assistant is told what an up day is (Indicators backlog 64).

Owner ruling, 2026-11-18: an up DAY is a close above the PREVIOUS close, a down day a close below
it; a close above its own OPEN is an up BAR, a green candle. The house set holds that in its
formulas (`tests/test_house_up_day.py`); this holds it in the instructions, so a member who asks
for "up/down volume" or "an up day on volume" gets the same meaning the house indicators have.

No paid calls.
"""
from __future__ import annotations

from api.services import definition_conversation as conv


def test_the_instructions_say_what_an_up_day_is():
    text = conv.system_prompt()
    assert "AN UP DAY is a close above the PREVIOUS close (close > offset 1 of close)" in text
    assert "A close above its own OPEN is an up BAR (a green candle)" in text
    assert 'use that only when the member says candle, an up or down bar, or "above its open"' in text
    assert 'A colour alone ("green shading") says nothing about which.' in text


def test_it_sits_with_the_other_window_conventions():
    text = conv.system_prompt()
    assert text.index("the window is the N bars BEFORE this one") < text.index("AN UP DAY is a close above the PREVIOUS close")
    assert text.index("AN UP DAY is a close above the PREVIOUS close") < text.index("DO NOT FABRICATE CAPABILITIES")


def test_the_door_accepts_the_meaning_it_teaches():
    """Up/down volume the way the instruction says to count it, through the door's own check."""
    from tests.test_p2_truth_server import call, empty_view, env, num, op
    S = lambda n: {"type": "series", "name": n}  # noqa: E731
    prev = {"type": "offset", "value": 1, "args": [S("close")]}
    up = call("sum", op("?:", op(">", S("close"), prev), S("volume"), num(0)), num(50))
    down = call("sum", op("?:", op("<", S("close"), prev), S("volume"), num(0)), num(50))
    patch = env(0, [{"op": "create", "name": "Up/Down Volume", "placement": "pane",
                     "outputs": [{"key": "udr", "tree": op("/", up, down)}]}])
    assert conv.check_envelope(patch, 0, empty_view(0))
