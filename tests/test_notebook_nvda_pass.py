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


def test_the_ear_hears_a_string_python_wrote_with_double_quotes(mod):
    """⚰️ The line that fooled the first grader for seven runs: a string holding an apostrophe is
    written by Python's repr with DOUBLE quotes. The first parser read single-quoted strings only,
    graded "I couldn't find that in this note." as never spoken, and a product defect was written
    up, fixed twice and reverted (#294 F1, #295, #296, #297). The ear must hear both quote styles,
    and a mixed line keeps its order."""
    line = "Speaking [LangChangeCommand ('en_US'), \"I couldn't find that in this note.\"]"
    assert mod.parse_speech(line) == ["I couldn't find that in this note."]
    mixed = "Speaking [LangChangeCommand ('en_US'), 'button', 'expanded', \"Patrick's note\", 'link']"
    assert mod.parse_speech(mixed) == ["button expanded Patrick's note link"]
    # and the grader, fed that speech, PASSES the row it used to fail
    assert mod.grade(["find", "note"], mod.parse_speech(line))[0] == "PASS"


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


def test_rows_28_to_38_are_not_run_unless_the_journal_styles_switch_is_a_boolean_true(mod):
    """Rows 28-38 exist only while NOTEBOOK_JOURNAL_STYLES_ENABLED is on for the server under test.
    The reader answers the NOT RUN reason for absent / off / a non-boolean, and None only for True."""
    base = "https://example.invalid"
    off = f"journal styles switch is off on {base}"
    assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: False}, base) == off
    absent = mod.journal_styles_off({"user": {}}, base)
    assert absent.startswith(off) and "carries no" in absent
    for v in ("true", 1, None):
        assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: v}, base).startswith(off)
    assert mod.journal_styles_off(None, base).startswith(off)
    assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: True}, base) is None     # the control: ON proceeds


def test_the_ear_hears_every_new_rows_words_as_nvda_logs_them(mod):
    """Walk the ear over its blind-spot list before grading: each row's own words, written the way
    NVDA writes them (Python's repr). Row 37's name holds ASCII quotes (repr switches to double
    quotes) and row 30's a typographic apostrophe (it does not)."""
    assert [r["n"] for r in mod.P1P2_ROWS] == list(range(28, 39))
    for r in mod.P1P2_ROWS:
        line = "Speaking [LangChangeCommand ('en_US'), " + ", ".join(repr(s) for s in r["logged"]) + "]"
        assert mod.grade(r["expected"], mod.parse_speech(line))[0] == "PASS", r["n"]
    assert '"' + mod.RULE_EDIT_NAME + '"' in repr(mod.RULE_EDIT_NAME)            # the double-quoted shape
    assert "’" in mod.TIMEFRAME_NAME and repr(mod.TIMEFRAME_NAME).startswith("'")
    # the control: a row whose words were never spoken still FAILS
    assert mod.grade(mod.P1P2_ROWS[0]["expected"], ["Styles button"])[0] == "FAIL"


def test_the_block_catalog_is_read_from_the_server_file_not_retyped(mod):
    kinds = mod.block_kinds()
    for wid in ("preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire", "tradeReview"):
        node = mod.block_node(wid, mod.block_params(wid, kinds), kinds)
        assert node["type"] == "widgetEmbed" and node["attrs"]["widgetId"] == wid
        assert node["attrs"]["searchText"] == kinds[wid]["search"] and node["attrs"]["searchText"].startswith("[")
    assert mod.block_params("preEntryChecklist", kinds)["setup"]                  # a setup, so items list
    assert mod.block_params("prepWire", kinds) == {}                              # uncaptured: Capture now


def test_extended_keys_carry_the_extended_flag_and_a_scan_code(mod):
    # Arrows without KEYEVENTF_EXTENDEDKEY arrive as numpad keys and NVDA swallows them (r4/r5).
    for name in ("down", "right", "insert", "home", "end"):
        assert mod.VK[name] in mod.EXTENDED_VKS
    assert mod.VK["tab"] not in mod.EXTENDED_VKS
    assert mod.user32.MapVirtualKeyW(mod.VK["slash"], 0) != 0   # a real scan code for "?"
