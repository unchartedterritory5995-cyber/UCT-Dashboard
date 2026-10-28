"""Cases for tx_match, most taken verbatim from the #tradexchange feed (Oct 2026).

Copied from tx-recap (the recap worker) so both read headlines the same way.
Twin of tx-recap/test_tx_match.py; keep the cases identical.
"""
import pytest

from api.services.tx_headline_match import confirm, mentions, name_keys, names_regex, parse


@pytest.mark.parametrize("text, prefix", [
    ("ETN - Eaton declares dividend", ["ETN"]),
    ("AEMC AKEMF V7F - RecycLiCo update", ["AEMC", "AKEMF", "V7F"]),
    ("BA -- Expecting large growth demand on Defense business", ["BA"]),
    ("AMD/NVDA – both bid on capex chatter", ["AMD", "NVDA"]),
    ("BRK.B - Berkshire buys more OXY", ["BRK.B"]),
    ("ON - ON Semi beats", ["ON"]),                       # a word-ticker is fine when TX tags it
    ("VISA SAYS CROSS-BORDER VOLUME ROSE 14%", []),       # a hyphen inside a word is not a separator
    ("FED: holds rates", []),                             # not a ticker tag
    ("Consumer Confidence: ACTUAL 91.7 - Expecting 81.2", []),
    ("HOUTHI SPOKESPERSON: HOUTHIE FORCES HIT SAUDI DEFENSE MINISTRY", []),
    ("Market Open! Good Hunting All!", []),
])
def test_prefix_is_txs_own_tag_with_any_separator(text, prefix):
    assert parse(text).prefix == prefix


@pytest.mark.parametrize("text, expect", [
    ("AMDpartners with GOOGL on AI chips", ["AMD", "GOOGL"]),     # glued typo + mid-text ticker
    ("AMDPartners with GOOGL", ["AMD", "GOOGL"]),                 # glued with a capital P
    ("MRNA lows", ["MRNA"]),                                      # bare leading ticker
    ("Oracle Expands AI Services with Snowflake (SNOW)", ["SNOW"]),
    ("Traders pile into $NOW calls", ["NOW"]),                    # $ beats the word list
    ("ADT Secures AI Innovation with Oracle", ["ADT"]),
])
def test_candidates_find_tickers_written_any_other_way(text, expect):
    c = parse(text).candidates
    assert all(t in c for t in expect), c


@pytest.mark.parametrize("text", [
    "FED SAYS FOMC MEETING BEGAN AS SCHEDULED AT 9:30AM TUESDAY",   # shouting: words are not evidence
    "Meta AI director Rohit Patel leaves -- TC",                     # AI, TC
    "CEOs and CFOs see Q3 EPS beat on AI demand in the US",          # acronyms
    "IPOed last week, now up 40%",
])
def test_no_false_candidates_from_acronyms_or_shouting(text):
    assert parse(text).candidates == []


def test_name_keys_strip_legal_suffixes_and_skip_generic_first_words():
    assert name_keys("HOOD", "Robinhood Markets, Inc. Class A Common Stock") == ["robinhood markets", "robinhood"]
    assert name_keys("AMD", "Advanced Micro Devices, Inc.") == ["advanced micro devices"]
    assert "google" in name_keys("GOOGL", "Alphabet Inc. Class A")
    rx = names_regex(name_keys("NFLX", "Netflix, Inc."))
    assert rx.search("Netflix Grapples With Digital-Ad Squeeze - Variety")


@pytest.mark.parametrize("text, ticker, name, hit", [
    ("AMDpartners with GOOGL", "AMD", None, True),
    ("AMDpartners with GOOGL", "GOOGL", None, True),
    ("ROBINHOOD TO INTEGRATE RIPPLE TREASURY INTO OPERATIONS", "HOOD", "Robinhood Markets, Inc.", True),
    ("COREWEAVE 5-YEAR CDS NARROWS TO LOWEST LEVEL", "CRWV", "CoreWeave, Inc.", True),
    ("CIGNA, UNITEDHEALTHCARE QUERIED BY SENATORS OVER COVERAGE", "CI", "The Cigna Group", True),
    ("TSM - Supplier to NVDA raises guide", "NVDA", None, True),
    ("Netflix Grapples With Digital-Ad Squeeze - Variety", "NFLX", "Netflix, Inc.", True),
    ("FED SAYS FOMC MEETING BEGAN AS SCHEDULED", "NOW", "ServiceNow, Inc.", False),
    ("Stocks open higher NOW that CPI is out", "NOW", "ServiceNow, Inc.", False),
    ("ServiceNow raises guide", "NOW", "ServiceNow, Inc.", True),
    ("Market Open! Good Hunting All!", "ALL", "The Allstate Corporation", False),
    ("AMDOCS - wins contract", "AMD", "Advanced Micro Devices, Inc.", False),
    ("Iran and Russia discuss energy cooperation and trade", "TTD", "The Trade Desk, Inc.", False),
    ("Analysts lift price target on chipmakers", "TGT", "Target Corporation", False),
    ("The Trade Desk falls after Amazon ad deal", "TTD", "The Trade Desk, Inc.", True),
    ("a crawler that said it belonged to Roblox", "RBLX", "Roblox Corporation", True),
])
def test_mentions(text, ticker, name, hit):
    assert mentions(text, ticker, name) is hit


@pytest.mark.parametrize("text, expect", [
    ("GME: NOV Weekly 24 CALL Activity on/by OFFER 1K+ Expire NOV 6", ["GME"]),   # colon = checked guess
    ("NOW: ServiceNow raises guide", ["NOW"]),
    ("STX EPS of $7.68 Beat by $0.25, Revenue of $4.2B Beat by $50M", ["STX"]),
    ("INTC ORCL Intel and Oracle Plan Expanded Collaboration", ["INTC", "ORCL"]),
    ("HOOD down ah", ["HOOD"]),
    ("EXE EPS of $1.46 Beat by $0.14, Revenue of $3.29B BeatEGBN EPS of $0.38 Missed", ["EXE", "EGBN"]),
    ("RBBN EPS of $0.07 Beat, Revenue of $218M MissedMCRI EPS of $1.76 Missed", ["RBBN", "MCRI"]),
])
def test_leads_and_glued_earnings_lines(text, expect):
    c = parse(text).candidates
    assert all(t in c for t in expect), c


def test_news_sources_are_not_tickers():
    for text in ("C.D.C. Deputy Director Resigns After Four Months -- NYT",
                 "Japan banks step up digital currency push - NIKKEI",
                 "Argentum AI in talks for $5 billion financing (SM Circulations RTRS)"):
        assert not {"NYT", "NIKKEI", "RTRS"} & set(parse(text).candidates), text


def test_confirm_keeps_real_tickers_and_prefers_the_full_glued_run():
    real = {"LPLA", "LPL", "AMD", "GME"}.__contains__
    assert confirm(parse("LPLAreported Q3 2026 Adj EPS of $5.97"), real) == ["LPLA"]
    assert confirm(parse("AMDPartners with GOOGL"), real) == ["AMD"]
    assert confirm(parse("TRUMP: 100M BARRELS OF VENEZUELAN OIL"), real) == []
