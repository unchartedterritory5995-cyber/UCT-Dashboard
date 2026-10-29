"""Trade Exchange News: context-aware tickers (the canonical resolver's wire contexts)
and the derived headline category. Headline shapes follow real Trade Exchange
formats; texts are illustrative."""
from __future__ import annotations

import pytest

from api.services import ticker_resolver as tr
from api.services.trade_exchange_news import categories as cat
from api.services.trade_exchange_news import pipeline as pl

HASSETT = "HASSETT: TRUMP BELIEVES RATES CAN BE LOWER; TRUMP RESPECTS FED INDEPENDENCE"


# ── tickers: ordinary words are not tickers just because a symbol exists ─────

@pytest.mark.parametrize("source,text", [
    ("TX-News", HASSETT),                                                    # CAN = Canaan
    ("TX-News", "OFFICIALS SAY TALKS ARE ON TRACK AND IT IS NOW ALL ABOUT THE LOW BIDDER"),
    ("TX-News", "WHITE HOUSE: WE CAN BE FLEXIBLE ON TIMING"),                  # CAN / BE
    ("TX-Filings", "FORM 4P - TFC - TRUIST FINANCIAL CORP*DIRECTOR|OFFICER - CEO: JONES MP|25,000"),
])
def test_english_words_in_shouted_or_structured_text_are_not_tickers(source, text):
    got = cat.tickers_for(source, text)
    assert not {"CAN", "ARE", "ON", "IT", "NOW", "ALL", "LOW", "BE", "FORM", "MP"} & set(got)


def test_the_hassett_headline_has_no_tickers_and_is_macro():
    assert cat.tickers_for("TX-News", HASSETT) == []
    assert cat.category_for("TX-News", HASSETT) == cat.MACRO


@pytest.mark.parametrize("source,text,want", [
    ("TX-News", "NVIDIA SHARES JUMP AFTER $NVDA GUIDANCE", ["NVDA"]),        # cashtag in shouted text
    ("TX-News", "CAN SHARES SLIDE AFTER MINER WARNS", ["CAN"]),             # explicit stock noun
    ("TX-News", "GOOGL lows", ["GOOGL"]),
    ("TX-News", "Apple and NVDA lead gains as AAPL tops record", ["NVDA", "AAPL"]),
    ("TX-PressRelease", "NVAX NVAX - Novavax Earns $125 Million Milestone", ["NVAX"]),
    ("TX-PressRelease", "S - SentinelOne Named Partner's Most Valuable Vendor", ["S"]),   # 1-letter slot
    ("TX-PressRelease", "AIDX - 20/20 BioLabs to Host Investor Webinar", ["AIDX"]),        # unlisted, named by the wire
    ("TX-PressRelease", "DTE - DTE Energy and sonnen Launch Virtual Power Plant", ["DTE"]),
    ("TX-Filings", "FORM 4P - TFC - TRUIST FINANCIAL CORP*DIRECTOR|OFFICER|25,000", ["TFC"]),
    ("TX-Filings", "FORM 4P  ACTU - ACTUATE THERAPEUTICS, INC.*DIRECTOR|SCHMITT DANIEL MP", ["ACTU"]),
])
def test_explicit_and_clearly_identified_symbols_are_kept(source, text, want):
    assert cat.tickers_for(source, text) == want


def test_a_foreign_listing_in_the_slot_is_not_trusted_unless_listed():
    assert cat.tickers_for("TX-PressRelease", "HDF.PA - HDF Energy Selects Topsoe") == []


def test_a_news_slot_needs_the_universe_and_never_a_stop_word():
    # A broad news line may open with an outlet or desk name, not a symbol.
    assert cat.tickers_for("TX-News", "WSJ - Tariff relief promised in talks") == []
    assert cat.tickers_for("TX-PressRelease", "FED - Statement on rates") == []


def test_mixed_case_headlines_keep_the_existing_headline_rules():
    text = "DTE Energy and sonnen launch a pilot; ON Semi also gains"
    assert cat.tickers_for("TX-News", text) == tr.resolve_tickers(text, tr.HEADLINE)


def test_the_new_contexts_are_declared_in_the_one_resolver():
    assert {tr.WIRE_NEWS, tr.WIRE_RELEASE, tr.WIRE_FILING} <= set(tr.CONTEXTS)
    assert tr.WIRE_NEWS.stop is tr.HEADLINE.stop or tr.WIRE_NEWS.stop == tr.HEADLINE.stop


# ── categories: authoritative labels first, text only with strong evidence ───

@pytest.mark.parametrize("source,text,want", [
    ("TX-PressRelease", "BALY - Bally's Corporation Comments on AUSTRAC Decision", cat.PRESS),
    ("TX-PressRelease", "ABC - Example Corp Reports Third Quarter 2026 Results", cat.EARNINGS),
    ("TX-PressRelease", "ABC - Example Corp Raises Full-Year Guidance", cat.EARNINGS),
    ("TX-Options", "NVDA unusual call activity", cat.OPTIONS),
    ("TX-Filings", "FORM 4P - TFC - TRUIST FINANCIAL CORP*DIRECTOR", cat.FILING),
    ("TX-News", "GOOGL lows", cat.PRICE),
    ("TX-News", "ADT Open", cat.PRICE),
    ("TX-News", "NVDA new highs", cat.PRICE),
    ("TX-News", HASSETT, cat.MACRO),
    ("TX-News", "TRUMP ADMINISTRATION PROMISED TARIFF RELIEF IN TALKS - WSJ", cat.MACRO),
    ("TX-News", "Example Corp beats estimates, EPS $1.10 vs $0.95 est", cat.EARNINGS),
    ("TX-News", "Unusual options activity in Example Corp", cat.OPTIONS),
    ("TX-News", "Iran has not yet responded to the message - Al Jazeera", cat.NEWS),
    ("TX-News", "Example Corp names a new chief operating officer", cat.NEWS),
    ("TX-News1", "Example Corp opens a new plant in Texas", cat.NEWS),
    ("TX-Team", "Desk note", cat.OTHER),                     # never seen: never a guess
    ("", "anything", cat.OTHER),
])
def test_category(source, text, want):
    assert cat.category_for(source, text) == want


def test_price_needs_the_whole_line_to_be_a_price_line():
    assert cat.category_for("TX-News", "GOOGL lows after regulators open a probe") != cat.PRICE


def test_every_category_is_declared():
    assert set(cat.SOURCE_CATEGORY.values()) <= set(cat.CATEGORIES)


# ── the event: derived fields, source kept verbatim, old rows read the new rules ──

def test_the_event_derives_tickers_and_category_and_keeps_the_source():
    row = {"seq": 7, "event_id": "01JABCDEFGHJKMNPQRSTVWXYZ0", "source": "TX-News", "content": HASSETT,
           "received_at_ms": 1_800_000_000_000, "ingested_at_ms": 1_800_000_000_050,
           "tickers": ["CAN"],                       # what an older ingest stored
           "repeat_count": 0, "via": "push"}
    ev = pl.headline_event(row, "e1")
    assert ev["source"] == "TX-News" and ev["content"] == HASSETT
    assert ev["tickers"] == [] and ev["category"] == cat.MACRO


def test_a_classifier_fault_costs_nothing(monkeypatch):
    monkeypatch.setattr(cat, "category_for", lambda *a: 1 / 0)
    monkeypatch.setattr(cat, "tickers_for", lambda *a: 1 / 0)
    assert pl._category_for("TX-News", "x") == "Other" and pl._tickers_for("x", "TX-News") == []


# ── shouted headlines: the high-confidence SUBJECT case, and what it must not reopen ──

@pytest.mark.parametrize("text,want", [
    ("NVDA JUMPS ON EARNINGS", ["NVDA"]),
    ("AAPL FALLS AFTER SUPPLIER WARNING", ["AAPL"]),
    ("META DOWNGRADED AT EXAMPLE BROKER", ["META"]),
    ("TSLA SHARES SLIDE IN PREMARKET TRADING", ["TSLA"]),
    ("AMD BEATS ON REVENUE, RAISES OUTLOOK", ["AMD"]),
])
def test_a_shouted_headline_keeps_its_stock_subject(text, want):
    assert cat.tickers_for("TX-News", text) == want
    assert cat.tickers_for("TX-News1", text) == want                  # the same wire context


@pytest.mark.parametrize("text", [
    HASSETT,                                                           # CAN mid-sentence
    "CAN RISES ARE NOT EXPECTED, OFFICIALS SAY",                       # English word at the front
    "ALL GAINS ERASED AS INDEXES FALL",
    "GOLD JUMPS TO A RECORD AS DOLLAR SLIDES",
    "NOW FALLS SILENT ON THE TRADE TALKS",
    "LOW RATES BOOST HOUSING DEMAND",
    "FED BEATS EXPECTATIONS WITH A HOLD",
    "STOCKS RALLY AS INVESTORS CHEER DATA",
])
def test_the_subject_rule_does_not_reopen_english_words(text):
    assert cat.tickers_for("TX-News", text) == []


def test_a_subject_later_in_a_shouted_sentence_stays_conservative():
    # Not the first word: no capitalisation signal and no cue -> not claimed.
    assert cat.tickers_for("TX-News", "STOCKS RALLY AS NVDA JUMPS ON EARNINGS") == []
    assert cat.tickers_for("TX-News", "STOCKS RALLY AS $NVDA JUMPS ON EARNINGS") == ["NVDA"]


# ── every approved source variant maps as intended (the receiver allowlist is not touched) ──

@pytest.mark.parametrize("source", ["TX-News", "TX-News1"])
@pytest.mark.parametrize("text,want", [
    ("GOOGL lows", cat.PRICE), (HASSETT, cat.MACRO),
    ("Example Corp beats estimates, EPS $1.10 vs $0.95 est", cat.EARNINGS),
    ("Unusual options activity in Example Corp", cat.OPTIONS),
    ("Example Corp opens a new plant in Texas", cat.NEWS),
])
def test_both_broad_news_labels_classify_the_same_way(source, text, want):
    assert cat.category_for(source, text) == want


@pytest.mark.parametrize("source,want", [
    ("TX-PressRelease", cat.PRESS), ("TX-Filings", cat.FILING), ("TX-Options", cat.OPTIONS),
    ("TX-News", cat.NEWS), ("TX-News1", cat.NEWS), ("TX-Team", cat.OTHER),
])
def test_each_label_has_its_category_and_ticker_context(source, want):
    assert cat.category_for(source, "Example Corp names a new chief operating officer") == want
    ctx = cat.SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS)
    assert ctx in (tr.WIRE_NEWS, tr.WIRE_RELEASE, tr.WIRE_FILING)
