"""R15-style extraction (session 27): `tools/wisdom/null_screens.py` is now the ONE authority for
the golden-v1.1 lexical screens, shared between `tools/wisdom_golden_verify.py` (the golden
methodology reader) and `api/services/wisdom/extract/prescreen.py` (R102's production filter).

⛔ The move must be behaviour-preserving for the golden-verify tool (`--self-check` covers that
directly) — these tests pin the MOVED module's own behaviour and the new `any_screen_fires`
predicate R102 adds on top of it.
"""
from __future__ import annotations

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
for p in (REPO, REPO / "tools" / "wisdom"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from tools.wisdom import null_screens as ns  # noqa: E402


def test_a_clean_narration_segment_trips_no_screen():
    text = "Alright everyone thanks for joining, let's get started for today."
    screens = ns.null_screens(text)
    assert all(not screens[k] for k in ns.SCREEN_KEYS), screens
    assert ns.any_screen_fires(text) is False


def test_a_cashtag_trips_the_instrument_screen():
    assert ns.null_screens("Watching $NVDA here")["cashtags"] == ["$NVDA"]
    assert ns.any_screen_fires("Watching $NVDA here") is True


def test_an_off_universe_uppercase_ticker_still_trips_the_screen():
    """⛔ The screen is shape-based, not universe-gated — SOXL/CBRS etc. must count even though
    they are not in cap_universe.json (the golden-v1.1 build's own regression)."""
    hits = ns.null_screens("SOXL and CBRS both moved today")["upper_tokens"]
    assert set(hits) == {"SOXL", "CBRS"}


def test_common_words_and_abbreviations_never_trip_the_screen():
    text = "ET open was AM, PM close was fine, the CEO gave an interview about the ETF."
    assert ns.null_screens(text)["upper_tokens"] == []


def test_a_company_name_trips_the_instrument_screen_without_a_ticker():
    assert ns.null_screens("Micron reported strong guidance")["companies"] == ["micron"]


def test_a_sector_word_trips_the_instrument_screen():
    assert ns.null_screens("semis look strong here")["sectors"] == ["semis"]


def test_a_price_token_trips_the_price_screen():
    assert ns.null_screens("stopped out at 45.32")["prices"] == ["45.32"]


def test_principle_and_signal_lexicon_are_independent_screens():
    p = ns.null_screens("always cut your losses, discipline matters")
    assert p["principle_lexicon"] and not p["signal_lexicon"]
    s = ns.null_screens("distribution day, classic risk-off rotation")
    assert s["signal_lexicon"] and not s["principle_lexicon"]


def test_any_screen_fires_is_true_if_ANY_ONE_of_the_seven_fires():
    """Non-vacuity: each screen alone must be sufficient, not just the instrument ones."""
    assert ns.any_screen_fires("always cut your losses") is True   # principle only
    assert ns.any_screen_fires("distribution day today") is True   # signal only
    assert ns.any_screen_fires("stopped out at 45.32") is True     # price only, no instrument


def test_screen_keys_matches_what_null_screens_actually_returns():
    """⛔ A hand-typed SCREEN_KEYS that drifts from the dict null_screens returns would make
    any_screen_fires silently blind to a screen — this is the control."""
    assert set(ns.SCREEN_KEYS) == set(ns.null_screens("anything").keys())


def test_golden_verify_reexports_the_same_behaviour():
    """R15 precedent: the golden-verify tool imports its `null_screens` FROM this module rather
    than carrying a second copy. ⚠️ Not an identity check: `wisdom_golden_verify.py`'s own bare
    `from null_screens import null_screens` (via its `sys.path.insert` of `tools/wisdom/`, the
    same pattern `category_norm.py` already uses) loads this file under a SECOND module name —
    `null_screens` vs `tools.wisdom.null_screens` — so Python legitimately creates two distinct
    function objects for one physical source file. What must hold, and does not hold for a
    drifted copy, is that they compute the SAME answer."""
    sys.path.insert(0, str(REPO / "tools"))
    import importlib

    verify = importlib.import_module("wisdom_golden_verify")
    # non-vacuity: verify.null_screens really is imported, not a stray local definition

    assert "def null_screens" not in pathlib.Path(verify.__file__).read_text(encoding="utf-8")
    for text in ("$NVDA moving", "always cut your losses", "clean narration, nothing here"):
        assert verify.null_screens(text) == ns.null_screens(text)
