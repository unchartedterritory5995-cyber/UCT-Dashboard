"""Company News backend tests.

Covers the stages the source-validation phase proved are load-bearing:
the publisher whitelist and its aliases, unknown-publisher exclusion, legal
solicitation, URL canonicalization (including the identity-in-query bug that
produced a false 99% duplicate rate), subject-vs-mention with ticker
collisions, dedupe, search, pagination and idempotent ingestion.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

from api.services.news import canonical, dedupe, filters, sentiment as senti
from api.services.news import sources as news_sources
from api.services.news import store, subject as subj

UTC = timezone.utc


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "news_test.db")
    store.set_db_path(path)
    yield path
    store.set_db_path(os.path.join(tempfile.gettempdir(), "unused_news.db"))


def _dt(days_ago: float = 0, hours: float = 0) -> datetime:
    return datetime.now(UTC) - timedelta(days=days_ago, hours=hours)


def _iso(d: datetime) -> str:
    return d.astimezone(UTC).isoformat()


# ===========================================================================
# publisher registry
# ===========================================================================
class TestSources:
    def test_wire_and_journalism_are_displayable(self):
        for name in ("GlobeNewswire", "Business Wire", "PR Newswire", "Newsfile"):
            cls, _ = news_sources.classify(name)
            assert cls == news_sources.CLASS_WIRE
            assert news_sources.is_displayable(cls)
        for name in ("Reuters", "CNBC", "Barron's", "WSJ", "MarketWatch"):
            cls, _ = news_sources.classify(name)
            assert cls == news_sources.CLASS_JOURNALISM
            assert news_sources.is_displayable(cls)

    def test_commentary_is_rejected_from_default_feed(self):
        for name in ("Zacks Investment Research", "The Motley Fool",
                     "24/7 Wall Street", "Defense World", "Seeking Alpha",
                     "GuruFocus", "Benzinga", "MarketBeat", "InvestorPlace"):
            cls, _ = news_sources.classify(name)
            assert cls == news_sources.CLASS_COMMENTARY, name
            assert not news_sources.is_displayable(cls), name

    def test_spelling_variants_fold_to_one_publisher(self):
        """FMP returned five spellings for three publishers."""
        assert news_sources.classify("GlobeNewsWire")[1] == "GlobeNewswire"
        assert news_sources.classify("Globe News Wire")[1] == "GlobeNewswire"
        assert news_sources.classify("GlobeNewswire Inc.")[1] == "GlobeNewswire"
        assert news_sources.classify("PRNewsWire")[1] == "PR Newswire"
        # Variant spellings must not smuggle a rejected source through.
        assert news_sources.classify("247 Wallst")[0] == news_sources.CLASS_COMMENTARY
        assert news_sources.classify("24/7 Wall Street")[0] == news_sources.CLASS_COMMENTARY
        assert news_sources.classify("Fool - Investing News")[0] == news_sources.CLASS_COMMENTARY

    def test_unknown_publisher_is_stored_but_never_displayed(self):
        cls, name = news_sources.classify("Some Brand New Aggregator")
        assert cls == news_sources.CLASS_UNKNOWN
        assert name == "Some Brand New Aggregator"
        assert not news_sources.is_displayable(cls)

    def test_yahoo_is_not_treated_as_a_publisher(self):
        """Finnhub's 61% 'Yahoo' hides the real publisher; never trust it."""
        assert news_sources.classify("Yahoo")[0] == news_sources.CLASS_COMMENTARY

    def test_provider_asserts_class(self):
        assert news_sources.classify("", provider="sec")[0] == news_sources.CLASS_PRIMARY
        assert news_sources.classify("@reporter", provider="x")[0] == news_sources.CLASS_SOCIAL

    def test_rank_orders_primary_over_wire_over_journalism(self):
        r = news_sources.rank
        assert r(news_sources.CLASS_PRIMARY) < r(news_sources.CLASS_WIRE)
        assert r(news_sources.CLASS_WIRE) < r(news_sources.CLASS_JOURNALISM)
        assert r(news_sources.CLASS_JOURNALISM) < r(news_sources.CLASS_SOCIAL)
        assert r(news_sources.CLASS_SOCIAL) < r(news_sources.CLASS_COMMENTARY)

    def test_env_override_can_reject_without_a_deploy(self, monkeypatch):
        monkeypatch.setenv("NEWS_EXTRA_REJECT", "Reuters")
        news_sources.reset_env_cache()
        try:
            assert news_sources.classify("Reuters")[0] == news_sources.CLASS_COMMENTARY
        finally:
            monkeypatch.delenv("NEWS_EXTRA_REJECT", raising=False)
            news_sources.reset_env_cache()
        assert news_sources.classify("Reuters")[0] == news_sources.CLASS_JOURNALISM


# ===========================================================================
# URL canonicalization — the bug this project actually hit
# ===========================================================================
class TestCanonical:
    def test_tracking_params_are_removed(self):
        a = canonical.canonical_url("https://reuters.com/a/b?utm_source=x&utm_medium=y")
        b = canonical.canonical_url("https://reuters.com/a/b")
        assert a == b == "reuters.com/a/b"

    def test_identity_query_is_preserved(self):
        """THE regression. Finnhub puts the article id in the query string;
        stripping it collapsed every article to one URL and produced a false
        99.2% duplicate rate."""
        u1 = canonical.canonical_url("https://finnhub.io/api/news?id=aaa")
        u2 = canonical.canonical_url("https://finnhub.io/api/news?id=bbb")
        assert u1 != u2
        assert "id=aaa" in u1

    def test_identity_preserved_while_tracking_stripped(self):
        u = canonical.canonical_url(
            "https://site.com/news?id=42&utm_source=twitter&fbclid=zz&page=2")
        assert "id=42" in u and "page=2" in u
        assert "utm_source" not in u and "fbclid" not in u

    def test_host_and_path_normalization(self):
        assert canonical.canonical_url("https://WWW.Reuters.com/A/B/") == "reuters.com/A/B"
        assert canonical.canonical_url("https://reuters.com/a#section") == "reuters.com/a"
        assert canonical.canonical_url("https://reuters.com/a/amp") == "reuters.com/a"

    def test_empty_and_garbage(self):
        assert canonical.canonical_url("") == ""
        assert canonical.canonical_url(None) == ""

    def test_display_url_keeps_scheme_and_strips_tracking(self):
        d = canonical.display_url("https://reuters.com/a?utm_source=x&id=9")
        assert d.startswith("https://reuters.com/a")
        assert "id=9" in d and "utm_source" not in d


# ===========================================================================
# junk filters
# ===========================================================================
class TestFilters:
    def test_legal_solicitation_rejected(self):
        for t in [
            "Deadline Alert: Wix.com Ltd. (WIX) Shareholders Who Lost Money Urged To Contact",
            "MICRON TECHNOLOGY, INC. INVESTOR ALERT: Scott+Scott Attorneys at Law LLP Investigates",
            "Gildan Investor News: If You Have Suffered Losses You Are Encouraged To Contact",
            "ROSEN, A LEADING LAW FIRM, Encourages Investors to Secure Counsel",
        ]:
            assert filters.reject_reason(t) == filters.REJECT_LEGAL, t

    def test_material_company_legal_event_survives_on_primary(self):
        t = "Micron settles patent litigation with Netlist"
        assert filters.reject_reason(t, source_class="primary") is None

    def test_market_research_pr_rejected(self):
        for t in [
            "Tile Adhesives Market Size to Surpass USD 12.88 Billion by 2035 Growing at 7.99% CAGR",
            "AI in Pharmaceutical Market to Hit USD 48.43 Billion by 2035",
            "Business Rules Management System Market to Reach $4.20 Billion by 2035",
        ]:
            assert filters.reject_reason(t) == filters.REJECT_PR_SPAM, t

    def test_editorial_commentary_rejected(self):
        for t in [
            "Coca-Cola: Buy, Sell, or Hold After Its Recent Run?",
            "Should You Buy Micron Today?",
            "3 Dividend Kings You Can Buy and Never Sell",
            "Why Microsoft (MSFT) is a Top Stock for the Long-Term",
            "Can Amtech's Booking Momentum Unlock Stronger Revenue Growth?",
            "Is Tesla Stock Under $360 a Share an Obvious Buy in September?",
            "Netlist Soars 667% Year to Date: Can the Stock Sustain the Rally?",
            "Honeywell Is Now Three Companies. Here's Which Piece I'd Actually Own.",
        ]:
            assert filters.reject_reason(t) == filters.REJECT_COMMENTARY, t

    def test_real_news_survives(self):
        for t in [
            "Micron raises fiscal Q4 revenue guidance on HBM demand",
            "Chevron and Halliburton Near Billion-Dollar Venezuela Oil Deals",
            "Micron Technology to Report Fiscal Fourth Quarter Results on September 30, 2026",
            "Apple announces $500 billion US investment plan",
            "Nvidia to acquire Run:ai for undisclosed sum",
            "Honeywell completes separation of Solstice Advanced Materials",
        ]:
            assert filters.reject_reason(t) is None, t

    def test_empty_headline(self):
        assert filters.reject_reason("") == filters.REJECT_EMPTY

    def test_categories(self):
        assert filters.categorize("Micron raises FY guidance") == "guidance"
        assert filters.categorize("Micron Q4 earnings beat estimates") == "earnings"
        assert filters.categorize("Goldman raises price target to $260") == "analyst"
        assert filters.categorize("Nvidia to acquire Run:ai") == "m&a"
        assert filters.categorize("Micron names new CFO") == "management"
        assert filters.categorize("Board approves $10 billion buyback") == "buyback"
        assert filters.categorize("x", form_type="8-K", provider="sec") == "sec"
        assert filters.categorize("anything", provider="x") == "social"
        assert filters.categorize("Some unremarkable headline") == "other"


# ===========================================================================
# subject vs mention
# ===========================================================================
class TestSubject:
    def setup_method(self):
        for sym, name in [("MU", "Micron Technology, Inc."), ("AAPL", "Apple Inc."),
                          ("HON", "Honeywell International Inc."),
                          ("ONTO", "Onto Innovation Inc."), ("ON", "ON Semiconductor Corp"),
                          ("ALL", "The Allstate Corporation"), ("CAT", "Caterpillar Inc."),
                          ("NVDA", "NVIDIA Corporation"), ("WING", "Wingstop Inc."),
                          ("BEAM", "Beam Therapeutics Inc."), ("PLUG", "Plug Power Inc.")]:
            subj.set_company_name(sym, name)

    def test_headline_name_is_subject(self):
        assert subj.classify_subject("MU", "Micron raises Q4 guidance") == subj.SUBJECT
        assert subj.classify_subject("HON", "Honeywell completes separation") == subj.SUBJECT

    def test_the_adobe_case(self):
        """The exact failure the Massive probe found: AAPL tagged on an Adobe story."""
        got = subj.classify_subject(
            "AAPL", "Is Adobe's Stock Heading for $300?",
            "Apple is mentioned as a high-flying tech stock but is not the subject.",
            provider_tags=["AAPL", "ADBE", "NVDA"])
        assert got == subj.MENTION

    def test_the_3m_case(self):
        got = subj.classify_subject(
            "HON", "Strength in Transportation & Electronics Unit Drives 3M",
            "Honeywell also competes in this segment.",
            provider_tags=["HON", "MMM"])
        assert got == subj.MENTION

    def test_peer_company_headline_is_not_subject(self):
        got = subj.classify_subject(
            "ONTO", "Can Amtech's Booking Momentum Unlock Growth?",
            "Onto Innovation is a peer.", provider_tags=["ONTO", "ASYS"])
        assert got == subj.MENTION

    @pytest.mark.parametrize("sym,title", [
        ("ON", "Markets rally on strong economic data"),
        ("ALL", "All eyes on the Fed this week"),
        ("CAT", "The cat sat on the mat"),
        ("WING", "Boeing wing production resumes"),
        ("BEAM", "A beam of light in the darkness"),
        ("PLUG", "Just plug it in and go"),
    ])
    def test_english_word_tickers_do_not_false_positive(self, sym, title):
        assert subj.classify_subject(sym, title, "") != subj.SUBJECT

    @pytest.mark.parametrize("sym,title", [
        ("ON", "ON Semiconductor cuts full-year guidance"),
        ("ALL", "Allstate raises quarterly dividend"),
        ("CAT", "Caterpillar lifts full-year outlook"),
    ])
    def test_ambiguous_tickers_match_on_company_name(self, sym, title):
        assert subj.classify_subject(sym, title, "") == subj.SUBJECT

    def test_cashtag_and_parenthesised_forms(self):
        assert subj.classify_subject("MU", "$MU jumps on results", "") == subj.SUBJECT
        assert subj.classify_subject("MU", "Shares of (NASDAQ:MU) rise", "") == subj.SUBJECT

    def test_sec_filing_is_always_subject(self):
        assert subj.classify_subject("ZZZZ", "unrelated text", "",
                                     provider="sec") == subj.SUBJECT
        assert subj.classify_subject("ZZZZ", "x", "", cik_match=True) == subj.SUBJECT

    def test_untagged_and_unnamed_is_unknown(self):
        assert subj.classify_subject("NVDA", "Fed holds rates steady", "") == subj.UNKNOWN

    def test_relevance_mapping(self):
        assert subj.relevance_for(subj.SUBJECT) == subj.REL_DIRECT
        assert subj.relevance_for(subj.MENTION) == subj.REL_MENTION
        assert subj.relevance_for(subj.UNKNOWN) == subj.REL_UNKNOWN
        assert subj.in_default_feed(subj.REL_DIRECT)
        assert not subj.in_default_feed(subj.REL_MENTION)
        assert not subj.in_default_feed(subj.REL_UNKNOWN)

    def test_basket_story_is_downgraded(self):
        """'Nvidia, AMD, Micron and 20 others rise' is index commentary."""
        assert subj.relevance_for(subj.SUBJECT, tag_count=25) == subj.REL_RELATED


# ===========================================================================
# dedupe
# ===========================================================================
class TestDedupe:
    def test_identical_headlines_match(self):
        a = "Micron raises fiscal Q4 revenue guidance on HBM demand"
        assert dedupe.similarity(a, a) == 1.0
        assert dedupe.headline_key(a) == dedupe.headline_key(a.upper() + "!")

    def test_syndicated_variants_cluster(self):
        a = "Micron raises fiscal Q4 revenue guidance on HBM demand"
        b = "Micron raises fiscal Q4 revenue guidance amid HBM demand"
        assert dedupe.similarity(a, b) >= dedupe.SHINGLE_THRESHOLD

    def test_unrelated_headlines_do_not_cluster(self):
        assert dedupe.similarity("Micron raises guidance",
                                 "Fed holds rates steady as inflation cools") == 0.0

    def test_time_window_and_ticker_overlap_required(self):
        t = datetime(2026, 9, 7, 12, tzinfo=UTC)
        a = "Micron raises fiscal Q4 revenue guidance on HBM demand"
        b = "Micron raises fiscal Q4 revenue guidance amid HBM demand"
        assert dedupe.same_event(a, t, {"MU"}, b, t + timedelta(hours=1), {"MU"})
        assert not dedupe.same_event(a, t, {"MU"}, b, t + timedelta(days=3), {"MU"})
        assert not dedupe.same_event(a, t, {"MU"}, b, t, {"NVDA"})

    def test_primary_source_wins_the_slot(self):
        t = datetime(2026, 9, 7, 12, tzinfo=UTC)
        items = [
            {"id": 1, "source_class": "journalism", "published_at": t, "description": "d"},
            {"id": 2, "source_class": "primary", "published_at": t + timedelta(hours=1),
             "description": "d"},
            {"id": 3, "source_class": "wire", "published_at": t, "description": "d"},
        ]
        assert dedupe.pick_primary(items)["id"] == 2

    def test_earliest_wins_within_a_class(self):
        t = datetime(2026, 9, 7, 12, tzinfo=UTC)
        items = [
            {"id": 1, "source_class": "wire", "published_at": t + timedelta(hours=2)},
            {"id": 2, "source_class": "wire", "published_at": t},
        ]
        assert dedupe.pick_primary(items)["id"] == 2

    def test_empty(self):
        assert dedupe.pick_primary([]) is None


# ===========================================================================
# sentiment
# ===========================================================================
class TestSentiment:
    def test_bullish_events(self):
        assert senti.classify("Micron raises full-year guidance")[0] == senti.BULLISH
        assert senti.classify("Q4 earnings beat estimates")[0] == senti.BULLISH
        assert senti.classify("Board announces $10 billion buyback")[0] == senti.BULLISH
        assert senti.classify("Company raises quarterly dividend")[0] == senti.BULLISH

    def test_bearish_events(self):
        assert senti.classify("Micron cuts full-year guidance")[0] == senti.BEARISH
        assert senti.classify("Q4 revenue misses estimates")[0] == senti.BEARISH
        assert senti.classify("Company suspends its dividend")[0] == senti.BEARISH
        assert senti.classify("Downgraded to sell at Morgan Stanley")[0] == senti.BEARISH

    def test_mixed_stays_unclassified(self):
        got, _ = senti.classify("Micron beats estimates but cuts guidance")
        assert got == senti.NEUTRAL

    def test_financing_is_deliberately_neutral(self):
        """§13 named this: a debt raise is not directionally obvious."""
        assert senti.classify("Micron prices $2 billion senior notes offering")[0] == ""
        assert senti.classify("Company announces public offering")[0] == ""

    def test_ordinary_news_is_unclassified(self):
        assert senti.classify("Micron opens training center in Boise")[0] == ""

    def test_reason_is_returned_when_classified(self):
        s, why = senti.classify("Micron raises full-year guidance")
        assert s == senti.BULLISH and why


# ===========================================================================
# store: pagination, search, idempotency
# ===========================================================================
def _mk(sym: str, headline: str, *, when: datetime, provider="fmp",
        pid: str | None = None, klass="journalism", src="Reuters",
        sentiment="", category="other", relevance="direct", reject="") -> int:
    item = {
        "provider": provider, "provider_id": pid or f"{provider}:{headline}",
        "source_name": src, "source_display": src, "source_class": klass,
        "url": f"https://example.com/{abs(hash(headline)) % 10**8}",
        "canonical_url": f"example.com/{abs(hash(headline)) % 10**8}",
        "headline": headline, "headline_key": dedupe.headline_key(headline),
        "description": f"Body for {headline}", "published_at": _iso(when),
        "ingested_at": _iso(datetime.now(UTC)), "category": category,
        "sentiment": sentiment, "reject_reason": reject, "is_primary": True,
    }
    return store.upsert(item, [{"ticker": sym, "relevance": relevance,
                                "subject": "subject"}])


class TestStore:
    def test_feed_is_reverse_chronological(self, db):
        for i in range(5):
            _mk("MU", f"Story number {i}", when=_dt(days_ago=i))
        page = store.feed("MU", limit=10)
        times = [r["published_at"] for r in page["items"]]
        assert times == sorted(times, reverse=True)
        assert len(page["items"]) == 5

    def test_cursor_pagination_is_stable_and_complete(self, db):
        for i in range(25):
            _mk("MU", f"Paged story {i}", when=_dt(hours=i))
        seen: list[int] = []
        cursor = None
        for _ in range(10):
            page = store.feed("MU", limit=7, cursor=cursor)
            seen.extend(int(r["id"]) for r in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break
        assert len(seen) == 25
        assert len(set(seen)) == 25, "cursor paging must not duplicate rows"

    def test_new_row_arriving_midscroll_does_not_duplicate(self, db):
        for i in range(10):
            _mk("MU", f"Base story {i}", when=_dt(hours=i + 5))
        page1 = store.feed("MU", limit=5)
        _mk("MU", "Breaking newest story", when=_dt(hours=0))
        page2 = store.feed("MU", limit=5, cursor=page1["next_cursor"])
        ids = {r["id"] for r in page1["items"]} & {r["id"] for r in page2["items"]}
        assert not ids

    def test_bad_cursor_is_ignored_not_fatal(self, db):
        _mk("MU", "A story", when=_dt())
        assert store.decode_cursor("!!!not-base64!!!") is None
        assert len(store.feed("MU", cursor="garbage")["items"]) == 1

    def test_commentary_class_never_reaches_the_feed(self, db):
        _mk("MU", "Real wire story", when=_dt(), klass="wire", src="GlobeNewswire")
        _mk("MU", "Zacks commentary story", when=_dt(), klass="commentary", src="Zacks")
        _mk("MU", "Unknown source story", when=_dt(), klass="unknown", src="Whoever")
        heads = [r["headline"] for r in store.feed("MU")["items"]]
        assert heads == ["Real wire story"]

    def test_mention_relevance_excluded_from_default_feed(self, db):
        _mk("MU", "Direct story", when=_dt())
        _mk("MU", "Mention story", when=_dt(), relevance="mention")
        heads = [r["headline"] for r in store.feed("MU")["items"]]
        assert heads == ["Direct story"]

    def test_rejected_rows_are_stored_but_hidden(self, db):
        _mk("MU", "Deadline Alert spam", when=_dt(), reject="legal-solicitation")
        _mk("MU", "Genuine story", when=_dt())
        assert [r["headline"] for r in store.feed("MU")["items"]] == ["Genuine story"]

    def test_sentiment_filter(self, db):
        _mk("MU", "Guidance raised", when=_dt(hours=1), sentiment="bullish")
        _mk("MU", "Guidance cut", when=_dt(hours=2), sentiment="bearish")
        _mk("MU", "Plain story", when=_dt(hours=3))
        assert len(store.feed("MU", sentiment="bullish")["items"]) == 1
        assert len(store.feed("MU", sentiment="bearish")["items"]) == 1
        assert len(store.feed("MU")["items"]) == 3

    def test_category_filter(self, db):
        _mk("MU", "Earnings out", when=_dt(hours=1), category="earnings")
        _mk("MU", "New product", when=_dt(hours=2), category="product")
        assert len(store.feed("MU", categories=["earnings"])["items"]) == 1

    def test_search_finds_stored_history(self, db):
        _mk("MU", "Micron HBM3E capacity sold out through 2026", when=_dt(days_ago=200))
        _mk("MU", "Micron opens Boise training center", when=_dt(days_ago=5))
        hits = store.feed("MU", query="HBM")["items"]
        assert len(hits) == 1 and "HBM3E" in hits[0]["headline"]

    def test_search_matches_description_and_source(self, db):
        _mk("MU", "A headline about nothing", when=_dt(), src="Reuters")
        assert len(store.feed("MU", query="Reuters")["items"]) == 1

    def test_search_is_scoped_to_the_symbol(self, db):
        _mk("MU", "Micron HBM story", when=_dt())
        _mk("NVDA", "Nvidia HBM story", when=_dt())
        hits = store.feed("MU", query="HBM")["items"]
        assert len(hits) == 1 and "Micron" in hits[0]["headline"]

    def test_search_with_punctuation_does_not_crash(self, db):
        _mk("MU", "Micron results", when=_dt())
        for q in ['"', "AND", "a AND b", "*", "NEAR(", "foo)"]:
            store.feed("MU", query=q)

    def test_search_paginates(self, db):
        for i in range(12):
            _mk("MU", f"HBM story {i}", when=_dt(hours=i))
        p1 = store.feed("MU", query="HBM", limit=5)
        assert len(p1["items"]) == 5 and p1["has_more"]
        p2 = store.feed("MU", query="HBM", limit=5, cursor=p1["next_cursor"])
        assert not ({r["id"] for r in p1["items"]} & {r["id"] for r in p2["items"]})

    def test_ingestion_is_idempotent(self, db):
        for _ in range(3):
            _mk("MU", "Repeated story", when=_dt(), pid="fmp:stable-id")
        assert len(store.feed("MU")["items"]) == 1

    def test_reingest_updates_in_place(self, db):
        _mk("MU", "Original headline", when=_dt(), pid="fmp:same")
        store.upsert({"provider": "fmp", "provider_id": "fmp:same",
                      "source_display": "Reuters", "source_class": "journalism",
                      "headline": "Corrected headline", "published_at": _iso(_dt()),
                      "ingested_at": _iso(_dt()), "is_primary": True},
                     [{"ticker": "MU", "relevance": "direct", "subject": "subject"}])
        items = store.feed("MU")["items"]
        assert len(items) == 1 and items[0]["headline"] == "Corrected headline"

    def test_counts_and_newest(self, db):
        _mk("MU", "Bull story", when=_dt(hours=1), sentiment="bullish")
        _mk("MU", "Bear story", when=_dt(hours=2), sentiment="bearish")
        c = store.counts_for("MU")
        assert c["total"] == 2 and c["bullish"] == 1 and c["bearish"] == 1
        assert store.newest_published("MU")

    def test_unknown_symbol_returns_empty_not_error(self, db):
        page = store.feed("NOSUCHTICKER")
        assert page["items"] == [] and page["next_cursor"] is None

    def test_health_and_stats_round_trip(self, db):
        store.record_health("fmp", ok=True, last_item_at=_iso(_dt()))
        store.record_health("sec", ok=False, error="boom")
        store.bump("fmp", "accepted", 3, "wire")
        store.bump("fmp", "rejected", 2, "editorial-commentary")
        snap = store.health_snapshot()
        by = {s["source"]: s for s in snap["sources"]}
        assert by["fmp"]["state"] == "ok" and by["sec"]["state"] == "error"
        metrics = {(s["metric"], s["detail"]): s["n"] for s in snap["stats"]}
        assert metrics[("accepted", "wire")] == 3
        assert metrics[("rejected", "editorial-commentary")] == 2

    def test_backfill_state_resumes(self, db):
        store.set_backfill("job1", "AAPL,MU", requests=10)
        st = store.get_backfill("job1")
        assert st["cursor"] == "AAPL,MU" and st["requests"] == 10 and not st["done"]
        store.set_backfill("job1", "AAPL,MU,NVDA", done=True, requests=5)
        st = store.get_backfill("job1")
        assert st["done"] == 1 and st["requests"] == 15


# ===========================================================================
# pipeline
# ===========================================================================
class TestPipeline:
    def test_full_pipeline_accepts_a_real_wire_story(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "Micron Technology, Inc.")
        nid = ingest.process({
            "provider": "fmp", "lane": "press", "provider_id": "press:u1",
            "publisher": "GlobeNewswire",
            "url": "https://globenewswire.com/x?utm_source=feed&id=7",
            "title": "Micron Technology to Report Fiscal Fourth Quarter Results",
            "body": "Micron will report results on September 30, 2026.",
            "image": "", "published_at": _dt(hours=1), "tags": ["MU"],
        })
        assert nid
        items = store.feed("MU")["items"]
        assert len(items) == 1
        assert items[0]["source_display"] == "GlobeNewswire"
        assert items[0]["source_class"] == "wire"
        assert "utm_source" not in items[0]["url"]
        assert "id=7" in items[0]["canonical_url"]

    def test_full_pipeline_rejects_commentary_publisher(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "Micron Technology, Inc.")
        ingest.process({
            "provider": "fmp", "lane": "stock", "provider_id": "stock:u2",
            "publisher": "Zacks Investment Research",
            "url": "https://zacks.com/a", "title": "Micron announces new fab",
            "body": "", "published_at": _dt(hours=1), "tags": ["MU"]})
        assert store.feed("MU")["items"] == []

    def test_full_pipeline_rejects_peer_company_story(self, db):
        from api.services.news import ingest
        subj.set_company_name("HON", "Honeywell International Inc.")
        ingest.process({
            "provider": "fmp", "lane": "stock", "provider_id": "stock:u3",
            "publisher": "Reuters", "url": "https://reuters.com/mmm",
            "title": "Strength in Transportation Unit Drives 3M",
            "body": "Honeywell competes in the segment.",
            "published_at": _dt(hours=1), "tags": ["HON", "MMM"]})
        assert store.feed("HON")["items"] == []

    def test_sec_filing_is_primary_and_always_relevant(self, db):
        from api.services.news import ingest
        ingest.process({
            "provider": "sec", "lane": "sec", "provider_id": "0001-24-000001",
            "publisher": "SEC", "url": "https://sec.gov/x",
            "title": "Micron files 8-K — Results of operations",
            "body": "Results of operations", "published_at": _dt(hours=2),
            "tags": ["MU"], "form_type": "8-K", "cik_match": True})
        items = store.feed("MU")["items"]
        assert len(items) == 1
        assert items[0]["source_class"] == "primary"
        assert items[0]["form_type"] == "8-K"
        assert items[0]["category"] == "sec"

    def test_social_item_enters_the_feed(self, db):
        from api.services.news import ingest
        ingest.process({
            "provider": "x", "lane": "x", "provider_id": "tweet-1",
            "publisher": "@DanNystedt", "url": "https://x.com/a/1",
            "title": "Micron Taiwan fab running at full utilisation",
            "body": "", "published_at": _dt(hours=1), "tags": ["MU"],
            "media_type": "video", "embed_url": "https://x.com/a/1"})
        items = store.feed("MU")["items"]
        assert len(items) == 1 and items[0]["source_class"] == "social"
        assert items[0]["media_type"] == "video"

    def test_house_art_is_suppressed(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "Micron Technology, Inc.")
        url = "https://cdn.example.com/house.jpg"
        for i in range(6):
            ingest.process({
                "provider": "fmp", "lane": "stock", "provider_id": f"h{i}",
                "publisher": "GlobeNewswire", "url": f"https://g.com/{i}",
                "title": f"Micron announces development number {i}",
                "body": "", "image": url, "published_at": _dt(hours=i),
                "tags": ["MU"]})
        items = store.feed("MU", limit=10)["items"]
        assert any(not r["image_url"] for r in items), "house art must be suppressed"

    def test_one_source_failing_does_not_blank_the_feed(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "Micron Technology, Inc.")
        ingest.process({
            "provider": "sec", "lane": "sec", "provider_id": "acc-1",
            "publisher": "SEC", "url": "https://sec.gov/y",
            "title": "Micron files 10-Q — Quarterly report",
            "body": "", "published_at": _dt(hours=1), "tags": ["MU"],
            "form_type": "10-Q", "cik_match": True})
        store.record_health("fmp", ok=False, error="provider down")
        assert len(store.feed("MU")["items"]) == 1


class TestClusteringAcrossSourcesOnly:
    """Regression: distinct filings from ONE source are not duplicates.

    Alibaba files several 6-Ks a week. A 6-K with no item codes has exactly one
    honest headline, so four distinct filings produced four identical headlines
    and the clusterer hid three of them. Clustering must only merge one event
    reported by DIFFERENT outlets.
    """

    def test_same_source_identical_headlines_all_stay_visible(self, db):
        from api.services.news import ingest
        subj.set_company_name("BABA", "Alibaba Group Holding Ltd")
        for i, day in enumerate([1, 3, 5, 8]):
            ingest.process({
                "provider": "sec", "lane": "sec", "provider_id": f"acc-{i}",
                "publisher": "SEC", "url": f"https://sec.gov/f{i}",
                "title": "Alibaba Group Holding Ltd files 6-K — Foreign issuer report",
                "body": "", "published_at": _dt(days_ago=day), "tags": ["BABA"],
                "form_type": "6-K", "cik_match": True})
        assert len(store.feed("BABA", limit=10)["items"]) == 4

    def test_same_event_across_two_sources_collapses_to_one(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "Micron Technology, Inc.")
        when = _dt(hours=2)
        ingest.process({
            "provider": "fmp", "lane": "press", "provider_id": "p1",
            "publisher": "GlobeNewswire", "url": "https://gnw.com/1",
            "title": "Micron raises fiscal Q4 revenue guidance on HBM demand",
            "body": "", "published_at": when, "tags": ["MU"]})
        ingest.process({
            "provider": "fmp", "lane": "stock", "provider_id": "p2",
            "publisher": "Reuters", "url": "https://reuters.com/1",
            "title": "Micron raises fiscal Q4 revenue guidance amid HBM demand",
            "body": "", "published_at": when, "tags": ["MU"]})
        items = store.feed("MU", limit=10)["items"]
        assert len(items) == 1
        # The wire release outranks the journalism write-up.
        assert items[0]["source_display"] == "GlobeNewswire"


class TestReadPathTouchesNoProvider:
    """THE non-negotiable guarantee (§5/§6).

    Opening MU -> News must not reach FMP, SEC or anything else. If this test
    ever fails, provider cost has started scaling with user count.
    """

    def test_feed_read_makes_zero_provider_calls(self, db, monkeypatch):
        calls: list[str] = []

        import httpx
        import requests
        from api.services.news.adapters import fmp_news, sec_news, x_news

        def boom_httpx(*a, **k):
            calls.append("httpx")
            raise AssertionError("read path made an HTTP call")

        def boom_requests(*a, **k):
            calls.append("requests")
            raise AssertionError("read path made an HTTP call")

        monkeypatch.setattr(httpx.Client, "get", boom_httpx, raising=False)
        monkeypatch.setattr(requests, "get", boom_requests, raising=False)
        monkeypatch.setattr(fmp_news, "_get",
                            lambda *a, **k: calls.append("fmp") or {}, raising=False)
        monkeypatch.setattr(sec_news, "fetch",
                            lambda *a, **k: calls.append("sec") or [], raising=False)
        monkeypatch.setattr(x_news, "fetch",
                            lambda *a, **k: calls.append("x") or [], raising=False)

        _mk("MU", "A stored story", when=_dt(hours=1))

        page = store.feed("MU", limit=25)
        assert len(page["items"]) == 1
        store.feed("MU", query="stored")
        store.feed("MU", sentiment="bullish")
        store.feed("MU", limit=5, cursor=store.encode_cursor(
            page["items"][0]["published_at"], page["items"][0]["id"]))
        store.counts_for("MU")

        assert calls == [], f"read path contacted providers: {calls}"

    def test_router_read_makes_zero_provider_calls(self, db, monkeypatch):
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from api.routers import company_news as cn

        calls: list[str] = []
        import requests
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **k: calls.append("requests") or (_ for _ in ()).throw(
                AssertionError("provider call from the API route")),
            raising=False)

        _mk("MU", "Routed story headline", when=_dt(hours=2))

        app = FastAPI()
        app.include_router(cn.router)
        # The routes are member-gated (see TestRouteAccessControl); this test
        # is about provider calls, not authorization.
        app.dependency_overrides[cn.require_member] = lambda: {"plan": "pro"}
        client = TestClient(app)
        r = client.get("/api/company-news/MU?limit=10")
        assert r.status_code == 200
        body = r.json()
        assert body["symbol"] == "MU"
        assert body["items"][0]["headline"] == "Routed story headline"
        assert calls == []

    def test_router_rejects_a_bad_symbol(self, db):
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from api.routers import company_news as cn
        app = FastAPI()
        app.include_router(cn.router)
        app.dependency_overrides[cn.require_member] = lambda: {"plan": "pro"}
        client = TestClient(app)
        assert client.get("/api/company-news/WAYTOOLONGSYMBOL").status_code == 400
        assert client.get("/api/company-news/MU?sentiment=sideways").status_code == 400


class TestCompanyNameResolution:
    """Regression: the subject test is USELESS without a company name.

    The first live FMP pull put 220 items on MU and showed ZERO of them.
    `catalyst.ticker_metadata` returns sector/industry/market-cap and no name,
    so matching fell back to the bare symbol -- and a 2-3 char symbol only
    counts in `$MU` / `(NASDAQ:MU)` form, which lives in article bodies far
    more than in headlines. Every genuine Micron press release was therefore
    classified `related`, and the direct-only feed dropped all of them.
    """

    def test_headline_name_match_survives_punctuation(self):
        """SEC registers 'COCA COLA CO'; every headline writes 'Coca-Cola'."""
        subj.set_company_name("KO", "COCA COLA CO")
        subj._aliases.cache_clear()
        assert subj.classify_subject(
            "KO", "Coca-Cola raises full-year guidance", "",
            provider_tags=["KO"]) == subj.SUBJECT

    def test_run_together_registered_names_split(self):
        """SEC registers 'ExxonMobil Holdings Corp'; headlines write two words."""
        subj.set_company_name("XOM", "ExxonMobil Holdings Corp")
        subj._aliases.cache_clear()
        for title in ("Exxon Mobil starts Guyana project",
                      "ExxonMobil raises dividend"):
            assert subj.classify_subject(
                "XOM", title, "", provider_tags=["XOM"]) == subj.SUBJECT, title

    def test_all_caps_registered_name_matches_spaced_headline(self):
        """'JPMORGAN CHASE & CO' has no case boundary to split on."""
        subj.set_company_name("JPM", "JPMORGAN CHASE & CO")
        subj._aliases.cache_clear()
        for title in ("JPMorgan Chase names new CFO", "JP Morgan lifts guidance"):
            assert subj.classify_subject(
                "JPM", title, "", provider_tags=["JPM"]) == subj.SUBJECT, title

    def test_real_press_releases_reach_the_feed(self, db):
        """The exact headlines that were being hidden."""
        from api.services.news import ingest
        subj.set_company_name("MU", "MICRON TECHNOLOGY INC")
        subj._aliases.cache_clear()
        headlines = [
            "Micron Technology to Report Fiscal Fourth Quarter Results on September 30, 2026",
            "Micron and Anthropic Announce Strategic Agreement to Advance AI Memory",
            "Micron Technology, Inc. Reports Record Results for the Fourth Quarter",
            "Micron Appoints Alexis Black Bjorlin to Board of Directors",
            "Micron Selects Bechtel as Construction Partner for High-Volume Fab",
        ]
        for i, h in enumerate(headlines):
            ingest.process({
                "provider": "fmp", "lane": "press", "provider_id": f"pr{i}",
                "publisher": "GlobeNewswire", "url": f"https://gnw.com/{i}",
                "title": h, "body": "", "published_at": _dt(hours=i + 1),
                "tags": ["MU"]})
        items = store.feed("MU", limit=20)["items"]
        assert len(items) == len(headlines), (
            f"only {len(items)} of {len(headlines)} company releases reached "
            f"the feed: {[i['headline'][:40] for i in items]}")

    def test_space_insensitive_match_does_not_fire_on_short_aliases(self):
        """The 8-char gate keeps the squashed fallback from matching noise."""
        subj.set_company_name("XYZ", "Ono Co")
        subj._aliases.cache_clear()
        assert subj.classify_subject(
            "XYZ", "The piano notes ring out", "",
            provider_tags=["XYZ"]) != subj.SUBJECT


class TestCrossLaneDuplicates:
    """Regression: one article served by two FMP lanes is ONE story.

    FMP returns company releases from both /news/press-releases and
    /news/stock. Keying identity on "{lane}:{url}" put the same GlobeNewswire
    release in the feed twice, back to back.
    """

    def test_same_url_from_both_lanes_collapses(self, db):
        from api.services.news import ingest
        from api.services.news.adapters import fmp_news
        subj.set_company_name("MU", "MICRON TECHNOLOGY INC")
        subj._aliases.cache_clear()

        row = {
            "symbol": "MU", "publishedDate": "2026-08-26 12:00:00",
            "publisher": "GlobeNewswire", "site": "globenewswire.com",
            "title": "Micron Technology to Report Fiscal Fourth Quarter Results",
            "text": "Micron will report results on September 30, 2026.",
            "url": "https://www.globenewswire.com/news-release/2026/08/26/mu.html",
            "image": "",
        }
        for lane in ("press", "stock"):
            norm = fmp_news.normalize(dict(row), lane=lane)
            assert norm is not None
            ingest.process(norm)

        items = store.feed("MU", limit=10)["items"]
        assert len(items) == 1, [i["headline"] for i in items]

    def test_different_urls_stay_separate(self, db):
        from api.services.news import ingest
        from api.services.news.adapters import fmp_news
        subj.set_company_name("MU", "MICRON TECHNOLOGY INC")
        subj._aliases.cache_clear()
        for i in range(2):
            norm = fmp_news.normalize({
                "symbol": "MU", "publishedDate": f"2026-08-2{i + 4} 12:00:00",
                "publisher": "GlobeNewswire",
                "title": f"Micron announces development number {i}",
                "text": "", "url": f"https://gnw.com/mu-{i}", "image": "",
            }, lane="press")
            ingest.process(norm)
        assert len(store.feed("MU", limit=10)["items"]) == 2


class TestRouteAccessControl:
    """Release guard: these routes SPEND MONEY and expose internals.

    Found unauthenticated during the pre-deploy audit (7 Sep 2026). Left open,
    `POST /api/company-news-ops/ingest` is a way for anyone on the internet to
    trigger our FMP and SEC ingestion, and `/health` leaks source health,
    publisher mix and database paths.
    """

    def test_every_ops_route_requires_admin(self):
        from api.routers import company_news as cn
        for route in cn.ops_router.routes:
            deps = [d.call.__name__ for d in route.dependant.dependencies]
            assert "require_admin" in deps, (
                f"{route.path} is not admin-gated (deps={deps})")

    def test_every_read_route_requires_a_member(self):
        from api.routers import company_news as cn
        for route in cn.router.routes:
            deps = [d.call.__name__ for d in route.dependant.dependencies]
            assert deps, f"{route.path} is PUBLIC"
            assert "require_member" in deps, f"{route.path} deps={deps}"

    def test_free_account_is_refused_with_402(self):
        from fastapi import HTTPException
        from api.routers import company_news as cn
        with pytest.raises(HTTPException) as e:
            cn.require_member({"plan": "free", "is_paid": False})
        assert e.value.status_code == 402

    def test_paid_account_passes(self):
        from api.routers import company_news as cn
        for user in ({"plan": "pro"}, {"is_paid": True},
                     {"plan_status": "active"}):
            assert cn.require_member(user) is user


class TestUrlSchemeSafety:
    """A provider row is untrusted input. Only http(s) may reach an href."""

    @pytest.mark.parametrize("bad", [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "vbscript:msgbox(1)",
        "file:///etc/passwd",
    ])
    def test_unsafe_schemes_produce_no_link(self, bad):
        assert canonical.display_url(bad) == ""

    def test_http_and_https_survive(self):
        assert canonical.display_url("https://reuters.com/a").startswith("https://")
        assert canonical.display_url("http://reuters.com/a").startswith("http://")

    def test_scheme_relative_and_bare_host_still_work(self):
        assert canonical.display_url("reuters.com/a") == "reuters.com/a"

    def test_pipeline_drops_an_unsafe_url(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "MICRON TECHNOLOGY INC")
        subj._aliases.cache_clear()
        ingest.process({
            "provider": "fmp", "lane": "press", "provider_id": "evil",
            "publisher": "GlobeNewswire", "url": "javascript:alert(1)",
            "title": "Micron announces a new fabrication facility",
            "body": "", "published_at": _dt(hours=1), "tags": ["MU"]})
        items = store.feed("MU")["items"]
        assert len(items) == 1
        assert items[0]["url"] == "", "an unsafe scheme must not reach the UI"


class TestMalformedInputDoesNotAbortIngestion:
    """§29 failure mode: ONE bad provider row must not stop the batch."""

    @pytest.mark.parametrize("junk", [
        "javascript:alert(1)", "http://[::1", "://nohost", "http://a:notaport/",
        "\x00\x01", "h" * 5000, "://", "https://", "?"])
    def test_canonical_url_never_raises(self, junk):
        canonical.canonical_url(junk)          # must not raise
        canonical.display_url(junk)

    def test_a_malformed_row_does_not_stop_the_batch(self, db):
        from api.services.news import ingest
        subj.set_company_name("MU", "MICRON TECHNOLOGY INC")
        subj._aliases.cache_clear()
        rows = [
            {"provider": "fmp", "lane": "press", "provider_id": "ok1",
             "publisher": "GlobeNewswire", "url": "https://gnw.com/1",
             "title": "Micron announces a new fabrication facility",
             "body": "", "published_at": _dt(hours=1), "tags": ["MU"]},
            {"provider": "fmp", "lane": "press", "provider_id": "bad",
             "publisher": "GlobeNewswire", "url": "javascript:alert(1)",
             "title": "Micron reports record quarterly revenue",
             "body": "", "published_at": _dt(hours=2), "tags": ["MU"]},
            {"provider": "fmp", "lane": "press", "provider_id": "ok2",
             "publisher": "GlobeNewswire", "url": "http://a:notaport/x",
             "title": "Micron opens a training center in Boise",
             "body": "", "published_at": _dt(hours=3), "tags": ["MU"]},
        ]
        for r in rows:
            ingest.process(r)          # none of these may raise
        items = store.feed("MU", limit=10)["items"]
        assert len(items) == 3, "a malformed row stopped the batch"
        unsafe = [i for i in items if i["url"].lower().startswith("javascript:")]
        assert not unsafe, "an unsafe scheme reached the UI"
