"""TERM-064 follow-ups 1 and 3: the tweet ingest and the frontend's cashtag extractors
answer through the ONE resolver's cashtag tier.

* The JS port's grammar is the Python `CASHTAG_TIER`, byte for byte (read from the file).
* One case file (`app/src/lib/tickerResolver.parity.json`) runs through the Python side
  here and through the JS side in `tickerResolver.test.js`.
* The tweet ingest answers exactly what `resolve_tickers(text, CASHTAG_POST)` answers.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services import ticker_resolver as R
from api.services.tweet_ticker_extract import extract_tickers

REPO = Path(__file__).resolve().parents[1]
JS = REPO / "app" / "src" / "lib" / "tickerResolver.js"
CASES = json.loads((REPO / "app" / "src" / "lib" / "tickerResolver.parity.json")
                   .read_text(encoding="utf-8"))["cases"]


def test_the_js_grammar_is_the_python_cashtag_tier_byte_for_byte():
    m = re.search(r"CASHTAG_TIER = String\.raw`([^`]*)`", JS.read_text(encoding="utf-8"))
    assert m, "tickerResolver.js no longer declares CASHTAG_TIER as a String.raw literal"
    assert m.group(1) == R.CASHTAG_TIER


def test_the_cashtag_tier_is_the_first_alternative_of_the_resolver_grammar():
    assert R._TOKEN_RE.pattern.startswith(R.CASHTAG_TIER + "|")


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["text"][:30] or "empty")
def test_parity_case_through_the_python_resolver(case):
    assert R.resolve_tickers(case["text"], R.CASHTAG_POST) == case["want"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["text"][:30] or "empty")
def test_the_tweet_ingest_answers_what_the_resolver_answers(case):
    assert extract_tickers(case["text"]) == set(case["want"])


def test_a_class_share_tweet_books_a_real_symbol():
    """The defect follow-up 1 names: M5 booked `$BRK.B` as `BRK`."""
    assert extract_tickers("$BRK.B adds to the stake") == {"BRK-B"}


def test_cashtag_post_never_reads_a_bare_word_even_in_the_universe(monkeypatch):
    monkeypatch.setattr(R, "_UNI", {"NVDA", "AAPL"})
    assert R.resolve_tickers("NVDA and AAPL rip", R.CASHTAG_POST) == []
    assert R.resolve_tickers("NVDA and AAPL rip", R.HEADLINE) == ["NVDA", "AAPL"], "control"
