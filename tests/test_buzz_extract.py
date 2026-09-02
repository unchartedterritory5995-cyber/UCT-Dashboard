"""Buzz extractor, measured against REAL #main-chat messages captured 2026-09-01.

The six `_REAL_*` cases below are verbatim from the channel. The extractor this
replaces scored 0/6 on them.
"""
from __future__ import annotations

import pytest

from api.services.buzz_extract import extract


def tickers(text):
    return [t for t, _ in extract(text)]


# ── the six real messages that broke the old extractor ───────────────────────

def test_real_mixed_case_bare_name():
    assert "DELL" in tickers("Dell u ok")


def test_real_company_name_in_a_sentence():
    assert "DELL" in tickers("Hold Michael Dell")


def test_real_all_caps_with_no_trading_keyword():
    # The old extractor dropped this: its caps branch required a word like
    # "chart"/"setup"/"breakout" to be present somewhere in the message.
    assert "DELL" in tickers("If DELL doesn't hold, probably means sellers are showing up")


def test_real_prose_with_no_ticker_finds_nothing():
    assert tickers("very different PA from last earnings same great report") == []


def test_real_macro_chatter_finds_nothing():
    got = tickers("Who are these sellers selling to is my broader question. "
                  "Granted volume has been abysmal, HFs are the most deleveraged "
                  "they've been since 2025 April tariff lows")
    assert got == [], f"false positives: {got}"


def test_real_meme_line_finds_nothing():
    assert tickers("i blame the globalists") == []


# ── the owner's own examples from the brief ──────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("watching Dell here",     "DELL"),
    ("Spy looking heavy",      "SPY"),
    ("Amazon reports tonight", "AMZN"),
    ("mRNA squeezing",         "MRNA"),
    ("SPX 6100 tag",           "SPX"),
])
def test_owner_examples(text, want):
    assert want in tickers(text)


# ── tiers ────────────────────────────────────────────────────────────────────

def test_cashtag_always_wins_even_for_an_ambiguous_symbol():
    assert extract("$OPEN ripping") == [("OPEN", "cashtag")]


def test_bare_lowercase_ambiguous_word_is_never_a_ticker():
    assert tickers("keep it open for now") == []
    assert tickers("that was a big play all day") == []


def test_uppercase_ambiguous_word_is_still_not_a_ticker_without_a_cashtag():
    # People shout in chat. "ALL IN" must not book an Allstate mention.
    assert tickers("I AM ALL IN NOW") == []


def test_house_vocabulary_is_never_a_ticker():
    # "line" matters here: LINE is a genuine listed symbol, so without a gate
    # this sentence books a LINE mention. Verified 2026-09-01. RS is gated via
    # hand-curated HOUSE_VOCAB (an acronym casing can't separate); line/EMA/GAP
    # are gated via the DERIVED chat_words() instead (all three were removed
    # from HOUSE_VOCAB as redundant once the corpus independently covered
    # them) -- either mechanism lands in the same `ambiguous()` set.
    assert tickers("RS line reclaiming the EMA after that GAP") == []


def test_a_gated_collision_still_counts_via_cashtag():
    # OVERTURNED RULING (Task 5): SPOT (Spotify) collides with "spot price" and
    # was ruled ungated by hand-typed guess ("members trade it"); the real
    # #tsdr corpus measured it at 11.2% uppercase -- a genuine word collision,
    # now gated via the DERIVED chat_words(). A bare uppercase mention no
    # longer counts, but the cashtag tier still beats every gate.
    assert tickers("SPOT breaking out of the base") == []
    assert "SPOT" in tickers("$SPOT breaking out of the base")


def test_confidence_is_reported_per_tier():
    assert dict(extract("$NVDA")) == {"NVDA": "cashtag"}
    assert dict(extract("Amazon earnings")) == {"AMZN": "alias"}
    assert dict(extract("NVDA breaking out")) == {"NVDA": "exact"}
    assert dict(extract("nvda breaking out")) == {"NVDA": "contextual"}


def test_dedupes_within_one_message_keeping_the_strongest_tier():
    got = dict(extract("$NVDA and NVDA and nvda"))
    assert got == {"NVDA": "cashtag"}


def test_multiple_tickers_in_one_message():
    assert tickers("$NVDA vs AMD today") == ["AMD", "NVDA"]


def test_empty_and_none_are_safe():
    assert extract("") == []
    assert extract(None) == []


@pytest.mark.parametrize("text", [
    "an apple a day",
    "he is the oracle of omaha",
    "can you affirm that",
    "learn the alphabet first",
    "just do it like nike said",
])
def test_an_alias_that_is_an_ordinary_word_needs_the_proper_noun_form(text):
    """Alias keys like apple/oracle/affirm/alphabet/nike are ordinary English.
    Matching them case-insensitively booked mentions at ALIAS confidence --
    stronger than the gated tiers -- on sentences with nothing to do with the
    stock."""
    assert tickers(text) == [], f"false positive: {extract(text)}"


@pytest.mark.parametrize("text", [
    "did you sprain your arm at practice",
    "that comment was very meta of you",
    "my net worth took a hit",
    "back to the lab tomorrow",
    "the band played all night",      # BAND
    "that was a pump and dump",       # PUMP
])
def test_word_forms_lowercase_are_never_a_ticker(text):
    """FIXED (was a documented xfail'd gap for arm/meta/net/lab): #tsdr is a
    disciplined trading feed, so casing measured arm/meta as ticker-dominant
    there even though they are ordinary English in casual chat -- a
    structural blind spot in the corpus, not a flaw in the derivation.
    band/pump joined the same list for a related reason: they are ordinary
    words too, just below the derivation's min_seen floor in this corpus, so
    they were removed from HOUSE_VOCAB (redundant-entry cleanup, 2026-09-01)
    and given a fixture here instead of staying hand-typed there. `uni.WORD_FORMS`
    (AMBIGUOUS_ALIASES + net/lab/band/pump, none of which are alias keys)
    demands the exact-symbol form at the bare-word tier too, same principle
    as the alias tier's proper-noun requirement."""
    assert tickers(text) == [], f"false positive: {extract(text)}"


@pytest.mark.parametrize("text,want", [
    ("Arm reports Tuesday", "ARM"),
    ("Meta earnings tonight", "META"),
    ("Apple event today", "AAPL"),
    ("ORACLE cloud numbers", "ORCL"),
    ("$NET breaking out", "NET"),
    ("Cloudflare guidance", "NET"),
    ("Rocket Lab launch", "RKLB"),
    ("novo up big today", "NVO"),
    ("lilly reports tomorrow", "LLY"),
    ("glp1 trade: novo and lilly both ripping", "NVO"),
])
def test_the_gate_is_a_scalpel_real_mentions_still_count(text, want):
    """CONTROL for the test above. Without this, blocking every ambiguous alias
    outright would also pass -- and would delete real mentions permanently.
    novo and lilly are not ordinary English words, so they are never gated --
    lowercase mentions count."""
    assert want in tickers(text)


@pytest.mark.parametrize("text,want", [
    ("ARM reports Tuesday", "ARM"),          # exact caps still counts
    ("Arm reports Tuesday", "ARM"),          # alias proper-noun path still counts
    ("Meta earnings tonight", "META"),
    ("NET broke out today", "NET"),
    ("Cloudflare guidance", "NET"),
    ("$NET breaking out", "NET"),
    ("Rocket Lab launch", "RKLB"),
    ("LAB reports earnings", "LAB"),         # exact caps still counts (untested corner)
    ("BAND ripping today", "BAND"),          # exact caps still counts
    ("$PUMP breaking out", "PUMP"),          # see the PUMP note below
])
def test_the_lowercase_word_gate_is_a_scalpel(text, want):
    """CONTROL for the WORD_FORMS gate. Without this, blocking those tokens
    outright would also pass -- and would delete real mentions permanently.

    ⚠️ PUMP used to appear here as "PUMP breaking out" -> PUMP, because it was
    a hand-curated WORD_FORMS entry and that gate only blocks the lowercase
    form. Re-deriving against 32,890 real #main-chat messages MEASURED it as a
    collision -- 62 lowercase uses against ONE uppercase -- so it graduated to
    the derived list, where the gate covers the uppercase form too. That is the
    correct outcome for this room: it does not trade the ticker, it says "pump".
    The escape hatch is the cashtag, which is what this case now asserts, and
    it is a stronger control: it proves the gate did not swallow the token
    entirely."""
    assert want in tickers(text)


def test_rocket_lab_does_not_book_a_phantom_LAB():
    assert "LAB" not in tickers("Rocket Lab launch")


def test_urls_do_not_produce_tickers():
    """Must use an UNAMBIGUOUS ticker. The original fixture used AI/OPEN/ALL,
    which the ambiguity gate blocks regardless of URLs -- so it passed with
    _URL.sub() deleted and pinned nothing."""
    assert tickers("https://example.com/DELL/chart") == []
    assert "DELL" in tickers("DELL chart looks good")   # control: not blanket-blocked
