"""Finance text → speech normalization."""

from api.services.voice_text_normalize import normalize_for_speech


def test_spells_out_tickers():
    out = normalize_for_speech("NVDA leads while XLK and SAIC run.")
    assert "N-V-D-A" in out
    assert "X-L-K" in out
    assert "S-A-I-C" in out


def test_leaves_common_words_and_acronyms_alone():
    out = normalize_for_speech("AI and US growth per CNBC; the FED and CEO agree.")
    assert "AI" in out and "A-I" not in out
    assert "US" in out and "U-S" not in out
    assert "CNBC" in out and "C-N-B-C" not in out
    assert "FED" in out and "CEO" in out


def test_signed_percentages_become_up_down():
    assert "up 2.23 percent" in normalize_for_speech("XLK +2.23% today")
    assert "down 0.55 percent" in normalize_for_speech("IWM -0.55% today")


def test_plain_percent_becomes_word():
    assert "5 percent" in normalize_for_speech("S&P 500 up over 5%")
    assert "%" not in normalize_for_speech("up 90%")


def test_finance_abbreviations():
    out = normalize_for_speech("SAIC beat BMO; price above the 21 EMA after 37 LODs.")
    assert "before market open" in out
    assert "E M A" in out
    assert "lows of day" in out


def test_cashtag_spelled_but_dollar_amount_untouched():
    out = normalize_for_speech("Watching $TSLA into a $3.23 print.")
    assert "T-S-L-A" in out
    assert "$3.23" in out  # dollar amount left for TTS to read as currency


def test_empty_input():
    assert normalize_for_speech("") == ""
    assert normalize_for_speech(None) is None
