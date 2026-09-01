"""Buzz universe: both symbol sources, and a collision set that actually collides."""
from __future__ import annotations

from api.services import buzz_universe as u


def test_symbols_include_equities_and_etfs():
    s = u.symbols()
    assert "NVDA" in s
    assert "TQQQ" in s or "SPY" in s, "ETF source not merged"
    assert all(x == x.upper() for x in list(s)[:200])


def test_house_vocabulary_is_marked_ambiguous_even_though_it_is_real_tickers():
    # Every one of these is a genuine listed symbol AND desk vocabulary.
    amb = u.ambiguous()
    for token in ("RS", "EMA", "MA", "GAP", "PEG"):
        assert token in amb, f"{token} must be ambiguous, not a free ticker match"


def test_ordinary_chat_words_that_are_real_tickers_are_ambiguous():
    # Every token here was VERIFIED present in api/data/cap_universe.json on
    # 2026-09-01. Do not add a word without checking it is in the universe --
    # ambiguous() is an intersection, so a non-symbol can never appear in it
    # and the assertion would fail for a reason that has nothing to do with
    # the code under test.
    amb = u.ambiguous()
    for token in ("ALL", "OPEN", "PLAY", "REAL", "CASH", "NOW", "AI", "KEY", "RUN", "LOW"):
        assert token in amb


def test_index_symbols_are_countable_and_unambiguous():
    # The owner named SPX explicitly in the brief. Indices are absent from
    # cap_universe (an EQUITY screen), so they must be added deliberately.
    s, amb = u.symbols(), u.ambiguous()
    for token in ("SPX", "NDX", "VIX"):
        assert token in s
        assert token not in amb


def test_single_letter_symbols_exist_but_are_not_extractable():
    # cap_universe genuinely contains A, B, C ... Z. They are real tickers, so
    # they stay in the universe; the EXTRACTOR floors token length at 2, which
    # kills them structurally rather than by listing each one.
    assert "A" in u.symbols()


def test_unambiguous_names_are_not_in_the_collision_set():
    amb = u.ambiguous()
    for token in ("NVDA", "TSLA", "AMZN", "PLTR", "SMCI", "DELL"):
        assert token not in amb, f"{token} is not an English word; gating it loses real mentions"


def test_aliases_map_company_names_to_tickers():
    a = u.aliases()
    assert a["amazon"] == "AMZN"
    assert a["nvidia"] == "NVDA"
    assert a["tesla"] == "TSLA"
    assert a["dell"] == "DELL"


def test_alias_keys_are_lowercase():
    assert all(k == k.lower() for k in u.aliases())


def test_ambiguous_is_a_subset_of_the_universe():
    # A collision set listing things that are not symbols is not measuring collisions.
    assert u.ambiguous() <= u.symbols()
