"""The spoken morning briefing never cuts a sentence in the middle of a word (fin walk K5).

Measured live: `POST /api/voice/exec`, tool `play_my_morning_briefing`, returned a script
ending "...a month of unlabeled ones. Af Tap me when you're ready to dig in." The weekly focus
was a character slice (`focus[:300]`), and the next sentence was glued to the stub.

Every length limit in the script is now a clip on a sentence boundary, or failing that a word
boundary. No model and no vendor is called here: every source is replaced.
"""
from __future__ import annotations

import ast
import inspect

import pytest

from api.services import voice_briefings_proactive as vb

# The walk's shape: a focus whose 300th character falls just inside the next sentence.
_LEAD = ("Label every trade the day it closes. " * 6) + "Size down Friday. "    # 240 characters
FOCUS = (_LEAD + "A week of labeled trades beats a month of unlabeled ones. "
         "After that, review the two setups that paid and drop the rest for now.")
assert FOCUS[:300].endswith(" Af"), FOCUS[:300][-12:]      # the fixture reproduces the defect


# ── the clip ────────────────────────────────────────────────────────────────────────────────

def test_a_short_text_is_returned_whole():
    assert vb.clip_spoken("Hold the stop.", 300) == "Hold the stop."
    assert vb.clip_spoken("", 300) == "" and vb.clip_spoken(None, 300) == ""


def test_the_walks_focus_ends_on_its_last_whole_sentence():
    out = vb.clip_spoken(FOCUS, 300)
    assert out.endswith("a month of unlabeled ones.")
    assert len(out) <= 300 and FOCUS.startswith(out)
    assert not out.endswith(" Af")


@pytest.mark.parametrize("limit", range(20, 330, 7))
def test_the_clip_never_exceeds_its_limit_and_never_ends_inside_a_word(limit):
    out = vb.clip_spoken(FOCUS, limit)
    assert len(out) <= limit
    words = FOCUS.split()
    got = out.split()
    # every word is a whole word of the source, in order; only a closing full stop may be added
    assert [w.rstrip(".") for w in got] == [w.rstrip(".") for w in words[:len(got)]], (limit, out)
    assert out == "" or out[-1] in ".!?"


def test_with_no_sentence_end_in_reach_the_clip_falls_back_to_a_word_and_closes_the_sentence():
    text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron"
    out = vb.clip_spoken(text, 30)
    assert out == "alpha beta gamma delta."
    assert len(out) <= 30


def test_a_sentence_end_too_early_to_be_useful_is_not_preferred_over_most_of_the_text():
    text = "Go. " + "word " * 80
    out = vb.clip_spoken(text, 200)
    assert len(out) > 100, "the clip threw away most of the text to end on a two-letter sentence"
    assert out.endswith("word.")


def test_one_word_longer_than_the_limit_is_cut_rather_than_dropped():
    out = vb.clip_spoken("x" * 500, 40)
    assert len(out) <= 40 and out.startswith("x")


# ── the script ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def briefing(monkeypatch):
    """`build_briefing` with every source replaced, so nothing reaches a vendor or a database."""
    from api.services import auth_db, voice_session_context as ctx
    vb._CACHE = type(vb._CACHE)()                                  # no answer from an earlier test

    class _Conn:
        def close(self):
            pass

    state = {"focus": FOCUS, "news": "", "regime": ""}
    monkeypatch.setattr(auth_db, "get_connection", lambda: _Conn())
    monkeypatch.setattr(ctx, "_resolve_account_id", lambda conn, user_id: "acc-1")
    monkeypatch.setattr(ctx, "_load_positions", lambda conn, user_id, account_id: [])
    monkeypatch.setattr(ctx, "_load_interventions", lambda conn, user_id, account_id: [])
    monkeypatch.setattr(ctx, "_load_weekly_focus", lambda conn, user_id, account_id: state["focus"])

    real_safe = vb._safe
    calls = iter(("regime", "news", "catalysts"))

    def _safe(fn, default, *args, **kwargs):
        which = next(calls)
        if which == "regime":
            return state["regime"]
        if which == "news":
            return {"answer": state["news"]}
        return []
    monkeypatch.setattr(vb, "_safe", _safe)
    del real_safe

    def run(**changes):
        state.update(changes)
        return vb.build_briefing(f"u-{len(str(state))}-{id(changes)}")
    return run


def test_the_script_no_longer_ends_the_focus_inside_a_word(briefing):
    script = briefing()["script"]
    assert " Af Tap me" not in script
    assert "a month of unlabeled ones. Tap me when you're ready to dig in." in script


def test_every_clipped_part_of_the_script_ends_a_sentence(briefing):
    long_news = "Futures are higher after the jobs report and yields are easing across the curve. " * 12
    long_regime = "Uptrend under pressure with distribution building in the leaders this week. " * 8
    out = briefing(news=long_news, regime=long_regime)
    s = out["sections"]
    assert len(s["regime"]) <= 300 and len(s["news"]) <= 600 and len(s["weekly_focus"]) <= 300
    for part in (s["regime"], s["news"], s["weekly_focus"]):
        assert part[-1] in ".!?", part[-30:]
    script = out["script"]
    # the news is clipped again for speech (300), and that cut is on a sentence too
    spoken_news = script.split("Overnight news: ")[1].split(" Tap me")[0]
    assert len(spoken_news) <= 300 and spoken_news.endswith("across the curve.")


def test_a_short_focus_is_spoken_exactly_as_written(briefing):
    script = briefing(focus="Trade smaller on Fridays.")["script"]
    assert "This week's focus: Trade smaller on Fridays. Tap me" in script


# ── spoken text carries no Markdown marks (keyed re-walk 8.3) ───────────────────────────────

def test_markdown_marks_are_not_read_aloud():
    """Seen in the keyed re-walk: the script said "- **Label every setup before you enter.**"."""
    assert vb.speakable("- **Label every setup before you enter.**") == "Label every setup before you enter."
    assert vb.speakable("## Focus\n1. Trade *smaller* on `Fridays`.\n* Hold the __stop__.") == (
        "Focus Trade smaller on Fridays. Hold the stop.")
    assert vb.speakable("A 2 * 3 grid and a dash - here") == "A 2 * 3 grid and a dash - here"   # prose is left alone
    assert vb.speakable(None) == ""


def test_the_script_speaks_a_markdown_focus_as_plain_words(briefing):
    script = briefing(focus="- **Label every setup before you enter.**\n- **Size down on Fridays.**")["script"]
    assert "This week's focus: Label every setup before you enter. Size down on Fridays. Tap me" in script
    assert "*" not in script and "- " not in script.split("focus: ")[1]


# ── the rail: no bare character slice of spoken text is left in the module ───────────────────

def test_no_text_in_the_briefing_is_cut_with_a_bare_character_slice():
    """`text[:300]` is how the word was cut. A slice of a LIST (the first five positions) is
    fine; a slice with a limit over 20 is a text cut and must go through `clip_spoken`."""
    tree = ast.parse(inspect.getsource(vb))
    clip = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "clip_spoken")
    inside = {id(n) for n in ast.walk(clip)}
    bare = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Slice) and id(node) not in inside
                and isinstance(node.slice.upper, ast.Constant) and isinstance(node.slice.upper.value, int)
                and node.slice.upper.value > 20):
            bare.append(node.slice.upper.value)
    assert bare == [], f"character slices of spoken text: {bare}"
