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


#: Owner-reported 2026-10-31: chart captions posted without their chart pair.
DAILY_WEEKLY_CAPTIONS = ["HYG Daily Weekly", "DIA Daily Weekly", "SMH Daily Weekly",
                         "TLT Daily Weekly", "IWM Daily Weekly", "SPY Daily Weekly"]


@pytest.mark.parametrize("text", DAILY_WEEKLY_CAPTIONS + [
    "SPY DAILY WEEKLY", " $QQQ Daily/Weekly ", "BRK.B Daily & Weekly", "SPY​ Daily Weekly",
    "XLF Daily - Weekly", "GLD Daily and Weekly",
])
def test_a_symbol_daily_weekly_caption_is_graphic_only(text):
    assert cat.placeholder_for(text) == "graphic"


@pytest.mark.parametrize("text", [
    "SPY Daily Weekly gains", "Retailer weekly sales rise 4%", "Costco weekly sales beat estimates",
    "SPY daily price move is the largest since April", "NVDA DAILY WEEKLY CHART UPDATE",
    "spy daily weekly", "Costco Daily Weekly", "Daily Weekly", "SPY Weekly", "SPY Daily",
    "Weekly jobless claims fall to 210K", "TOOLONGX Daily Weekly", "SPY Weekly Daily",
    "Technical outlook: SPY daily chart holds support", "SPY, QQQ Daily Weekly",
])
def test_ordinary_daily_or_weekly_headlines_are_never_hidden(text):
    assert cat.placeholder_for(text) is None


def test_a_caption_event_is_marked_and_keeps_its_content():
    row = {"seq": 4, "event_id": "01JABCDEFGHJKMNPQRSTVWXYZ1", "source": "TX-News1",
           "content": "SPY Daily Weekly", "received_at_ms": 1_800_000_000_000,
           "ingested_at_ms": 1_800_000_000_010, "tickers": [], "repeat_count": 0, "via": "push"}
    ev = pl.headline_event(row, "e")
    assert ev["placeholder"] == "graphic" and ev["content"] == "SPY Daily Weekly"


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


def test_its_own_ticker_in_the_headline_is_the_link_not_the_name():
    # The name is recognised (its security is the ticker's) but the ticker is the one link.
    assert tr.resolve_company_mentions("Apple (AAPL) event set", IDX, explicit={"AAPL"}) == []
    assert cat.mentions_for("TX-News", "Apple pie stand opens near $AAPL store") == []
    assert cat.tickers_for("TX-News", "Apple (AAPL) event set") == ["AAPL"]   # filters/alerts keep it


def test_filters_and_alerts_see_the_same_corrected_resolution():
    assert cat.tickers_for("TX-News", "APPLE PIE CONTEST DRAWS RECORD CROWD") == []
    assert cat.tickers_for("TX-News", "MICROSOFT EXPECTS TO RAISE $25 BILLION") == ["MSFT"]


# ── follow-up (production review 2026-10-29): shortened names that are not names ──

NAMES_FU = {**NAMES, "USB": "U.S. Bancorp", "GIC": "Global Industrial Company",
            "LMT": "Lockheed Martin Corporation", "RHI": "Robert Half Inc.",
            "ROK": "Rockwell Automation, Inc.", "BRCB": "Black Rock Coffee Bar, Inc.",
            "GM": "General Motors Company", "AMAT": "Applied Materials, Inc."}
IDX_FU = tr.build_company_index(NAMES_FU, ALIASES)


def m_fu(source, text):
    explicit = set(tr.resolve_tickers(text, cat.SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS)))
    return [s for _, s in tr.resolve_company_mentions(text, IDX_FU, explicit=explicit)]


def test_initials_left_by_dropping_a_corporate_form_are_not_a_name():
    assert ("u", "s") not in IDX_FU                       # "U.S" of U.S. Bancorp
    assert m_fu("TX-News", "TALKS AIM TO SECURE U.S. SUPPORT - WSJ") == []
    assert m_fu("TX-News", "U.S. says talks will resume") == []
    assert ("u", "s", "bancorp") in IDX_FU               # the full name still links


@pytest.mark.parametrize("text", [
    "CEO speaks at the 2026 Global Industrial Conference",
    "Global Industrial Expo opens in Chicago",
])
def test_a_name_of_only_generic_words_needs_company_context(text):
    assert ("global", "industrial") in IDX_FU.weak
    assert m_fu("TX-News", text) == []


@pytest.mark.parametrize("source,text,want", [
    ("TX-News", "Global Industrial reports record quarter", ["GIC"]),
    ("TX-News", "Global Industrial shares rise", ["GIC"]),
    ("TX-News", "LOCKHEED MARTIN SELECTED FOR NEW CONTRACT", ["LMT"]),
    ("TX-News", "MICROSOFT EXPECTS AI CAPACITY CONSTRAINTS", ["MSFT"]),
    ("TX-News", "Apple cuts prices in China", ["AAPL"]),
    ("TX-News", "NVIDIA CEO ADDRESSES REPORT", ["NVDA"]),
    ("TX-News", "General Motors recalls 10,000 trucks", ["GM"]),
    ("TX-News", "Rockwell Automation Introduces New Drives", ["ROK"]),     # distinctive: no cue needed
    ("TX-News", "Robert Half says hiring is slowing", ["RHI"]),
    ("TX-News", "Black Rock Coffee Bar Expands Footprint", ["BRCB"]),
])
def test_confirmed_names_still_link(source, text, want):
    assert m_fu(source, text) == want


# ── follow-up: one link per security -- the ticker wins over its own company name ──

@pytest.mark.parametrize("source,text,tickers", [
    ("TX-PressRelease", "BRCB - Black Rock Coffee Bar Expands Footprint in California", ["BRCB"]),
    ("TX-PressRelease", "ROK - Rockwell Automation Introduces New Drives", ["ROK"]),
    ("TX-PressRelease", "RHI - Robert Half honored for workplace culture", ["RHI"]),
    ("TX-News", "Microsoft (MSFT) expects to raise $25 billion", ["MSFT"]),
    ("TX-News", "Global Industrial (GIC) shares rise", ["GIC"]),
])
def test_a_name_whose_ticker_is_present_is_plain_text(source, text, tickers):
    assert m_fu(source, text) == []
    assert tr.resolve_tickers(text, cat.SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS)) == tickers


def test_the_rule_is_per_security_not_per_headline():
    text = "BRCB - Black Rock Coffee Bar and Microsoft Announce a Partnership"
    assert m_fu("TX-PressRelease", text) == ["MSFT"]
    assert m_fu("TX-News", "Microsoft and NVIDIA lead gains as AAPL tops record") == ["MSFT", "NVDA"]
    assert m_fu("TX-News", "Apple and NVIDIA lead gains as AAPL tops record") == ["NVDA"]


def test_another_share_class_of_the_same_issuer_counts_as_present():
    assert IDX.issuer["GOOG"] == IDX.issuer["GOOGL"]
    assert tr.resolve_company_mentions("Alphabet reports cloud growth; GOOG climbs", IDX,
                                       explicit={"GOOG"}) == []


def test_without_its_ticker_the_name_links():
    assert m_fu("TX-News", "Microsoft Expects to Raise About $25 Billion in US Bond Sale") == ["MSFT"]


def test_a_suppressed_name_still_shields_shorter_names_inside_it():
    idx = tr.build_company_index({"BRCB": "Black Rock Coffee Bar, Inc.", "BKR": "Black Rock Holdings Inc."}, {})
    got = tr.resolve_company_mentions("BRCB - Black Rock Coffee Bar Expands", idx, explicit={"BRCB"})
    assert got == []


# ── follow-up: capitalised words in wire prose that are text, not tickers ──

@pytest.mark.parametrize("source,text,bad", [
    ("TX-News", "Top Admiral Briefs Trump On Iran Attack Options -- WSJ (SM Circulations)", "SM"),
    ("TX-News", "Hackers exploit Cisco SD-WAN flaw to deploy custom malware - BC", "SD"),
    ("TX-News", "Hackers exploit Cisco SD-WAN flaw to deploy custom malware - BC", "BC"),
    ("TX-News", "Tariff talks resume after a pause - AP", "AP"),
    ("TX-PressRelease", "XGMS - X Games USA Launches New Series", "USA"),
    ("TX-News", "Lawmakers say they'll refuse an AI-BUBBLE bailout", "AI"),
])
def test_ordinary_wire_text_is_not_a_ticker(source, text, bad):
    assert bad not in cat.tickers_for(source, text)


@pytest.mark.parametrize("source,text,want", [
    ("TX-News", "GM says it will recall trucks", ["GM"]),
    ("TX-News", "GE shares rise after upgrade", ["GE"]),
    ("TX-News", "Stocks slip as $SM falls - BC", ["SM"]),                   # a cashtag always counts
    ("TX-News", "GOOGL lows", ["GOOGL"]),
    ("TX-News", "NVDA JUMPS ON EARNINGS", ["NVDA"]),
    ("TX-PressRelease", "S - SentinelOne Named Partner's Most Valuable Vendor", ["S"]),
    ("TX-PressRelease", "BRK.B - Berkshire Hathaway Annual Letter", ["BRK-B"]),
])
def test_real_tickers_in_wire_text_are_kept(source, text, want):
    assert tr.resolve_tickers(text, cat.SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS)) == want


# ── terminal upgrade (2026-10-29): source credits and technology topics ──

@pytest.mark.parametrize("source,text", [
    ("TX-News1", "Taiwan exports hit a record on AI demand (CNA)*"),
    ("TX-News1", "Taiwan exports hit a record on AI demand (CNA*)"),
    ("TX-News1", "Taiwan exports hit a record on AI demand (CNA)"),
    ("TX-News", "Japan weighs new chip subsidies (Kyodo)"),
])
def test_a_parenthesised_source_credit_is_not_a_ticker(source, text):
    assert "CNA" not in cat.tickers_for(source, text)
    assert cat.mentions_for(source, text) == [] or all(s != "CNA" for _, s in cat.mentions_for(source, text))


@pytest.mark.parametrize("source,text", [
    ("TX-News", "$CNA rises after earnings"),                                 # a cashtag always counts
    ("TX-PressRelease", "CNA - CNA Financial Announces Third Quarter Results"),  # the leading slot
    ("TX-PressRelease", "Example Corp. (NYSE: CNA) declares a dividend"),      # a listing, not a credit
])
def test_a_real_cna_reference_still_links(source, text):
    assert "CNA" in cat.tickers_for(source, text)


NAMES_TOPIC = {**NAMES_FU, "QUBT": "Quantum Computing Inc.", "DLR": "Digital Realty Trust, Inc."}
IDX_TOPIC = tr.build_company_index(NAMES_TOPIC, ALIASES)


def m_topic(text):
    explicit = set(tr.resolve_tickers(text, tr.WIRE_RELEASE))
    return [s for _, s in tr.resolve_company_mentions(text, IDX_TOPIC, explicit=explicit)]


@pytest.mark.parametrize("text", [
    "IonQ Expands Partnership to Accelerate Commercial Quantum Computing",
    "New Center Advances Research in Quantum Computing and Materials",
    "Universities Launch Quantum Computing Curriculum",
])
def test_a_technology_topic_is_not_a_company(text):
    assert ("quantum", "computing") in IDX_TOPIC.weak
    assert "QUBT" not in m_topic(text)


@pytest.mark.parametrize("text", [
    "Quantum Computing Inc. Announces Third Quarter Results",
    "Quantum Computing shares jump after contract win",
    "Quantum Computing reports record revenue",
])
def test_the_company_quantum_computing_still_links_with_context(text):
    assert m_topic(text) == ["QUBT"]


def test_a_topic_named_company_with_its_ticker_links_only_the_ticker():
    assert m_topic("QUBT - Quantum Computing Inc. Announces New Photonic Chip Order") == []
