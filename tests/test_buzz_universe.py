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


def test_an_unrecognised_dict_shape_contributes_no_symbols():
    """A universe file restructured into metadata must yield NOTHING, never its
    keys. 'count' and 'version' are short enough to pass the length filter and
    are in no vocabulary set, so they would become invisible phantom tickers."""
    assert u._syms_from({"version": "1.0", "count": 3742, "generated": "x"}) == set()
    assert u._syms_from({"symbols": ["NVDA", "AMD"]}) == {"NVDA", "AMD"}


def test_SPOT_is_now_gated_by_measured_corpus_data_not_by_hand():
    """OVERTURNED RULING (Task 5, 2026-09-01). This test used to assert SPOT
    was deliberately ungated because "Spotify is a name this room trades" --
    a hand-typed guess. Running the extractor over the real 7,766-message
    #tsdr corpus measured SPOT at 11.2% uppercase (308 word-uses vs 39
    ticker-uses), well under the 35% word threshold: it IS a genuine
    collision, and only real data could show it. It is gated via the DERIVED
    `chat_words()` (api/data/buzz_collisions.json), never by hand-adding it to
    HOUSE_VOCAB -- that would collapse the two collision mechanisms into one."""
    assert "SPOT" in u.symbols()
    assert "SPOT" in u.chat_words()
    assert "SPOT" in u.ambiguous()
    assert "SPOT" not in u.HOUSE_VOCAB
    # control: LINE/GAIN were removed from HOUSE_VOCAB the same day this ruling
    # was corrected, because the derived corpus already covers them -- still
    # gated, just no longer hand-typed. Both measure 0% uppercase in real
    # #main-chat, so no threshold reaches them.
    # ⚠️ BULL LEFT THIS CONTROL on 2026-09-02. At 24.6% uppercase (33 caps uses
    # against 101 lowercase) it rose above the new 10% bar, so it is countable
    # again. That is the owner's ruling working as intended -- BULL is a real
    # ticker, and "a decent bit of false mentions is fine as long as intended
    # ticker mentions are captured". It is NOT hand-added to HOUSE_VOCAB: that
    # list is for uppercase-by-convention ACRONYMS, and BULL is a word shouted
    # for emphasis. Stretching the list to cover it is how hand-typed vocab
    # grows back.
    for still_gated_via_derivation in ("LINE", "GAIN"):
        assert still_gated_via_derivation in u.chat_words()
        assert still_gated_via_derivation in u.ambiguous()
        assert still_gated_via_derivation not in u.HOUSE_VOCAB
    # BAND moved to WORD_FORMS the same day (an ordinary word this corpus does
    # not measure as a collision) -- neither mechanism marks it ambiguous now;
    # it is gated only at the bare-word tier for its lowercase form
    # (behavioural proof lives in test_buzz_extract.py's scalpel control).
    # ⚠️ PUMP left this list on 2026-09-02. Re-deriving against 32,890 real
    # #main-chat messages MEASURED it -- 62 lowercase uses against ONE
    # uppercase -- so the derived chat_words() now covers it and it was dropped
    # from WORD_FORMS: the same graduation LINE/GAIN made out of HOUSE_VOCAB,
    # and for the same reason (two authorities over one token is the defect,
    # not the redundancy). Asserted, not silently deleted.
    assert "PUMP" in u.chat_words()
    assert "pump" not in u.WORD_FORMS
    for word_form_only in ("BAND",):
        assert word_form_only.lower() in u.WORD_FORMS
        assert word_form_only not in u.HOUSE_VOCAB
        assert word_form_only not in u.chat_words()


def test_house_vocab_holds_only_what_casing_cannot_derive():
    """HOUSE_VOCAB is for uppercase-by-convention ACRONYMS. Anything the corpus
    derivation already covers must not be duplicated here -- a redundant entry
    reads as precedent for hand-typing ordinary words, which is the exact
    anti-pattern the derived list exists to retire."""
    import json, pathlib
    derived = set(json.loads(
        (pathlib.Path(u.__file__).resolve().parents[1] / "data" / "buzz_collisions.json")
        .read_text(encoding="utf-8"))["tokens"])
    assert not (u.HOUSE_VOCAB & derived), sorted(u.HOUSE_VOCAB & derived)


def test_a_malformed_universe_file_degrades_to_empty_instead_of_raising(tmp_path, monkeypatch):
    """buzz_boards imports this transitively on the /buzz query path. A raise
    here takes the command down; an empty set only makes it quiet."""
    bad = tmp_path / "cap_universe.json"
    bad.write_text("{not json at all", encoding="utf-8")
    monkeypatch.setattr(u, "_DATA", tmp_path)
    u._reset_caches_for_tests()
    try:
        assert u._load_json("cap_universe.json") is None
        assert isinstance(u.symbols(), frozenset)      # must not raise
    finally:
        u._reset_caches_for_tests()                    # leave no poisoned cache


def test_a_lowercase_typed_TICKER_is_not_gated_as_a_word():
    """⛔ The casing rule assumes lowercase means "ordinary word", and for a
    ticker that is NOT an English word the lowercase hits are just people
    typing it lazily -- "Watching sgov 5 minute", "buy back the sgov I sold".
    Gating those DROPS REAL MENTIONS, which the owner ruled is the failure that
    matters: "a decent bit of false mentions is fine as long as intended ticker
    mentions are captured and highlighted."

    A 35% threshold ate SGOV, ETSY, COST, UPS, BROS, BILL and DTE for exactly
    this reason. At 10% they are all countable again, while the tokens that are
    genuinely words -- measured at 0-8% uppercase -- stay gated."""
    import json
    import pathlib
    u._reset_caches_for_tests()
    # ⛔ Asserts the OUTCOME, not the mechanism. This briefly tested a
    # LOWERCASE_TICKERS override; lowering the threshold to 10% made SGOV fall
    # out on its own and the override was deleted as a second authority. What
    # must stay true is that the ticker is countable -- by whatever means.
    assert "SGOV" in u.symbols()
    assert "SGOV" not in u.chat_words()
    assert "SGOV" not in u.ambiguous()
    # CONTROL: the exception is a scalpel, not a blanket -- everything else the
    # same corpus flagged is still gated.
    for genuinely_a_word in ("EVER", "SPOT", "GOLD", "NGL", "TY", "BC", "QS"):
        assert genuinely_a_word in u.chat_words(), genuinely_a_word
