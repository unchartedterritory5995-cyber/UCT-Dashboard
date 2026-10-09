"""Rails on tools/notebook_nvda_pass.py -- the NVDA screen-reader driver.

Windows-only: the module binds user32/kernel32 at import. On any other platform the file skips, and
says so, rather than passing vacuously.

The three things that must stay true, each with its control:
  1. the grader can FAIL (foreign speech, silence) and can PASS (every phrase present);
  2. the ear parses NVDA's `Speaking [...]` line shape into words;
  3. the foreground guard REFUSES -- raises instead of sending -- when no window carries the run
     nonce, and before `ensure()` has ever found one. A key is never sent on a refusal, which is
     the property the 2026-10-09 incident (seven minutes of keys into the owner's Chrome) needs.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the driver binds user32 at import")

TOOL = pathlib.Path(__file__).resolve().parents[1] / "tools" / "notebook_nvda_pass.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("notebook_nvda_pass", TOOL)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_the_grader_passes_on_the_phrases_and_fails_on_anything_else(mod):
    assert mod.grade(["Skip to notes list", "link"], ["clickable Skip to notes list link"])[0] == "PASS"
    verdict, why = mod.grade(["Skip to notes list"], ["column 3 Sort by Name button"])
    assert verdict == "FAIL" and "missing" in why
    assert mod.grade(["anything"], [])[0] == "FAIL"           # silence is a FAIL, never a pass


def test_the_ear_reads_nvda_speaking_lines_as_words(mod):
    line = ("IO - speech.speech.speak (02:24:50.302) - MainThread (8976):\n"
            "Speaking [LangChangeCommand ('en_US'), 'row 1', 'column 1', 'Select All', 'check box', 'not checked']\n"
            "IO - inputCore.InputManager.executeGesture (02:24:54.176) - winInputHook (21316):\n"
            "Input: kb(desktop):tab")
    assert mod.parse_speech(line) == ["row 1 column 1 Select All check box not checked"]
    assert mod.parse_speech("Input: kb(desktop):tab") == []  # a gesture line is not speech


def test_the_foreground_guard_refuses_without_a_nonce_window_and_before_ensure(mod):
    class NoPage:
        def evaluate(self, *_a, **_k):
            return None
    g = mod.Foreground(NoPage(), "no-window-carries-this-nonce-0123456789abcdef")
    with pytest.raises(mod.ForegroundLost):
        g.ensure()
    with pytest.raises(mod.ForegroundLost):
        g.check()
    # and the senders ask the guard first: with the guard in that state, press() sends nothing
    mod.GUARD = g
    with pytest.raises(mod.ForegroundLost):
        mod.press("tab")
    with pytest.raises(mod.ForegroundLost):
        mod.type_text("x")


def test_extended_keys_carry_the_extended_flag_and_a_scan_code(mod):
    # Arrows without KEYEVENTF_EXTENDEDKEY arrive as numpad keys and NVDA swallows them (r4/r5).
    for name in ("down", "right", "insert", "home", "end"):
        assert mod.VK[name] in mod.EXTENDED_VKS
    assert mod.VK["tab"] not in mod.EXTENDED_VKS
    assert mod.user32.MapVirtualKeyW(mod.VK["slash"], 0) != 0   # a real scan code for "?"
