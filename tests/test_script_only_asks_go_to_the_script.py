"""A style, a precision or a setting only a script holds goes to the script turn first (2026-11-25).

Found by the Deepvue parity probe (live, admin measurement): three requests were BUILT as a formula that could not do
what they asked, and each reply said so: "Plot the Parabolic SAR as dots" (a thin dotted line instead), "show its value
in the status line with 2 decimals" ("I can't set a fixed 2-decimal format") and "the close of another symbol that I
choose in the settings" ("the symbol is fixed in the formula"). A script holds each (plot.style_circles /
plot.style_cross, `precision=`, input.symbol), and a formula that BUILDS is never followed by a script, so the member
got the near thing. Held here: those asks reach the script turn first; a formula's own dotted line, its markers and
an ordinary request keep the formula turn. No paid calls.
"""
from __future__ import annotations

import pytest

from api.services import script_conversation as sc


@pytest.mark.parametrize("words", [
    "Plot the Parabolic SAR as dots",
    "Parabolic SAR 0.02, 0.2 as dots",
    "Plot the 20 day low as small red crosses",
    "Plot the SuperTrend line in circles style",
    "Plot the 50 day average as a step line, and show its value in the status line with 2 decimals",
    "show the RSI value to one decimal place",
    "Plot the close of another symbol that I choose in the settings, as a line in a pane below, defaulting to SPY",
    "a ratio of the close to a ticker I can pick",
    "let me choose the symbol to compare against",
])
def test_a_style_a_precision_or_a_symbol_setting_goes_to_the_script_turn(words):
    assert sc.wants_script(words), words


@pytest.mark.parametrize("words", [
    "Plot the 200 day SMA as a dotted blue line",                 # a formula's line style
    "put a small dot above every bar that is the first bar of a new month",   # a formula's marker
    "Plot SPY's close in a pane below",                           # another symbol, fixed: a formula holds it
    "Plot the 20 day average and color it green when rising",
    "Mark where the 9 EMA crosses above the 21 EMA",              # a cross is a condition, not a style
    "Plot a 2 bar average of the close",
    "Plot the RSI and let me choose its colour",
])
def test_a_formula_request_keeps_the_formula_turn(words):
    assert not sc.wants_script(words), words


def test_the_old_script_words_still_route():
    assert sc.wants_script("show a table of the last 5 closes") and sc.wants_script("label the swing highs")
