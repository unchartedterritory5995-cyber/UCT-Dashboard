"""Company NAMES in Trade Exchange headlines -> symbols (canonical resolver),
graphic-only placeholders, and the event fields the widget reads. Reference names
here are test data; production reads the on-disk name cache, never the network."""
from __future__ import annotations

import pytest

from api.services import ticker_resolver as tr
from api.services.trade_exchange_news import categories as cat
from api.services.trade_exchange_news import pipeline as pl

NAMES = {
    "MSFT": "Microsoft Corporation", "AAPL": "Apple Inc.", "NVDA": "NVIDIA Corporation",
    "GOOGL": "Alphabet Inc. Class A", "GOOG": "Alphabet Inc. Class C",
    "TFC": "Truist Financial Corporation", "RKLB": "Rocket Lab USA, Inc.",
    "NYT": "New York Times Company", "SO": "Southern Company", "PGR": "Progressive Corp",
    "DJT": "Trump Media & Technology Group Corp.", "BALY": "Bally's Corporation",
    "OPEN": "Opendoor Technologies Inc.", "X": "United States Steel Corporation",
}
ALIASES = {"microsoft": "MSFT", "apple": "AAPL", "nvidia": "NVDA", "google": "GOOGL",
           "alphabet": "GOOGL", "open": "OPEN", "affirm": "AFRM", "arm": "ARM", "meta": "META"}
IDX = tr.build_company_index(NAMES, ALIASES)


@pytest.fixture(autouse=True)
def _index(monkeypatch):
    monkeypatch.setattr(tr, "_COMPANY_INDEX", IDX)


def m(text):
    return tr.resolve_company_mentions(text, IDX)


@pytest.mark.parametrize("text,want", [
    ("MICROSOFT EXPECTS TO RAISE ABOUT $25 BILLION IN US BOND SALE - SOURCE", [("MICROSOFT", "MSFT")]),
    ("Apple unveils a new chip", [("Apple", "AAPL")]),
    ("NVIDIA SHARES RISE AFTER EXPORT RULING", [("NVIDIA", "NVDA")]),
    ("Google faces a new antitrust suit", [("Google", "GOOGL")]),
    ("Alphabet reports cloud growth", [("Alphabet", "GOOGL")]),
    ("Truist Financial raises its dividend", [("Truist Financial", "TFC")]),
    ("Rocket Lab wins a launch contract", [("Rocket Lab", "RKLB")]),
    ("TRUMP MEDIA files for a new offering", [("TRUMP MEDIA", "DJT")]),
])
def test_high_confidence_company_names_link_to_their_symbol(text, want):
    assert m(text) == want


def test_several_companies_in_one_headline_link_once_each_in_mention_order():
    assert m("Microsoft and Nvidia expand deal; Microsoft also hires") == [
        ("Microsoft", "MSFT"), ("Nvidia", "NVDA")]


@pytest.mark.parametrize("text", [
    "RATES CAN BE LOWER IN NEW YORK, OFFICIALS SAY",     # 'new york' prefix of NYT
    "Progressive policies win in the Southern states",   # single words from reference names
    "UNITED STATES WEIGHS NEW TARIFFS",                   # prefix of a steel company
    "Stores open early; courts affirm ruling; arm sales rise",   # curated words that are English
])
def test_ordinary_words_and_generic_prefixes_never_link(text):
    assert m(text) == []


def test_a_name_shared_by_several_securities_is_not_guessed():
    idx = tr.build_company_index({"AAA": "Example Holdings Group", "AAB": "Example Holdings Corp"}, {})
    assert tr.resolve_company_mentions("Example Holdings rallies", idx) == []
    # ...unless the curated list settles it (Alphabet -> GOOGL over GOOG).
    assert m("Alphabet rallies") == [("Alphabet", "GOOGL")]


def test_no_index_yet_means_no_links_never_a_build_on_the_hot_path(monkeypatch):
    monkeypatch.setattr(tr, "_COMPANY_INDEX", None)
    called = []
    monkeypatch.setattr(tr, "prewarm_company_index", lambda: called.append(1))
    assert tr.resolve_company_mentions("Microsoft rallies") == [] and called == []


# ── wired into News: tickers for filters/alerts, mentions for the widget ─────

def test_names_join_explicit_tickers_for_filters_and_alerts():
    assert cat.tickers_for("TX-News", "MICROSOFT EXPECTS TO RAISE $25 BILLION") == ["MSFT"]
    assert cat.tickers_for("TX-News", "$NVDA and Microsoft lead") == ["NVDA", "MSFT"]
    assert cat.mentions_for("TX-News1", "Apple unveils a chip") == [["Apple", "AAPL"]]


def test_filings_link_only_their_symbol_slot():
    text = "FORM 4P - TFC - TRUIST FINANCIAL CORP*DIRECTOR|OFFICER"
    assert cat.mentions_for("TX-Filings", text) == [] and cat.tickers_for("TX-Filings", text) == ["TFC"]


def test_the_can_fix_still_holds_with_names_on():
    text = "HASSETT: TRUMP BELIEVES RATES CAN BE LOWER; TRUMP RESPECTS FED INDEPENDENCE"
    assert cat.tickers_for("TX-News", text) == [] and cat.mentions_for("TX-News", text) == []


# ── graphic-only placeholders ────────────────────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("CRYPTO", "graphic"), (" crypto ", "graphic"), ("​​​", "graphic"), ("", "graphic"),
    ("GOOGL lows", None), ("VIX 16.40", None), ("CRWV green", None), ("CRYPTO rally lifts miners", None),
])
def test_only_confirmed_graphic_placeholders_are_marked(text, want):
    assert cat.placeholder_for(text) == want


@pytest.mark.parametrize("text", ["VIX 16.40", "CRWV green", "GOOGL lows", "ADT Open"])
def test_short_price_lines_are_price(text):
    assert cat.category_for("TX-News1", text) == cat.PRICE


def test_the_event_carries_mentions_and_the_placeholder_mark_and_keeps_content():
    row = {"seq": 3, "event_id": "01JABCDEFGHJKMNPQRSTVWXYZ0", "source": "TX-News1",
           "content": "MICROSOFT EXPECTS TO RAISE $25 BILLION", "received_at_ms": 1_800_000_000_000,
           "ingested_at_ms": 1_800_000_000_010, "tickers": [], "repeat_count": 0, "via": "push"}
    ev = pl.headline_event(row, "e")
    assert ev["content"] == row["content"] and ev["mentions"] == [["MICROSOFT", "MSFT"]]
    assert ev["tickers"] == ["MSFT"] and ev["placeholder"] is None
    assert pl.headline_event({**row, "content": "CRYPTO"}, "e")["placeholder"] == "graphic"


@pytest.mark.parametrize("text", [
    "apple pie and alphabet soup at the fair",           # not written as proper nouns
    "Apple pie recipe goes viral",                       # capitalised, but no company context
    "APPLE PIE CONTEST DRAWS RECORD CROWD",              # shouted, no company context
    "Alphabet soup of new rules confuses traders",
    "Google Doodle celebrates a holiday",                # brand word, nothing a company did
])
def test_a_single_word_brand_needs_company_context(text):
    assert m(text) == []


@pytest.mark.parametrize("text,want", [
    ("Apple's new chip ships", [("Apple", "AAPL")]),                          # possessive
    ("APPLE SHARES SLIDE PREMARKET", [("APPLE", "AAPL")]),                    # stock cue
    ("Apple, Google face EU probe", [("Apple", "AAPL"), ("Google", "GOOGL")]),  # coordination
])
def test_single_word_brands_with_company_context_link(text, want):
    assert m(text) == want


def test_its_own_ticker_in_the_headline_is_context():
    assert tr.resolve_company_mentions("Apple (AAPL) event set", IDX, explicit={"AAPL"}) == [("Apple", "AAPL")]
    assert cat.mentions_for("TX-News", "Apple pie stand opens near $AAPL store") == [["Apple", "AAPL"]]


def test_filters_and_alerts_see_the_same_corrected_resolution():
    assert cat.tickers_for("TX-News", "APPLE PIE CONTEST DRAWS RECORD CROWD") == []
    assert cat.tickers_for("TX-News", "MICROSOFT EXPECTS TO RAISE $25 BILLION") == ["MSFT"]
