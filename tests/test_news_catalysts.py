"""Tests for the News & Catalysts feed service — merge/dedup/sort, both-direction
generation, generate-once, disabled short-circuit. Mocks bars/earnings/tweets and
the shared generator; uses a temp DB.
"""
import time

import pytest

from api.services.cache import cache
from api.services import significant_catalysts
from api.services.news_catalysts import store, service


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "news_catalysts.db"))
    store._init_db()
    # Clear the per-symbol caches between tests.
    for sym in ("NVDA", "TEST", "AAPL", "EMPTY"):
        cache.invalidate(f"news_hist_{sym}")
        cache.invalidate(f"news_live_{sym}")
    monkeypatch.setenv("NEWS_CATALYSTS_ENABLED", "1")
    yield


# ── daily bars (2026) with a clear up day (01-05 +10%) and down day (01-06 -10%) ──
_BARS = [
    {"t": "2026-01-02", "o": 100.0, "c": 100.0},
    {"t": "2026-01-05", "o": 100.0, "c": 110.0},
    {"t": "2026-01-06", "o": 110.0, "c": 99.0},
    {"t": "2026-03-10", "o": 120.0, "c": 132.0},   # earnings day (reaction +10%)
]


def _mock_bars(monkeypatch):
    monkeypatch.setattr(service, "_daily_bars_since", lambda sym, lo=service.YTD_LO: list(_BARS))


def _mock_earnings(monkeypatch, earnings):
    import api.services.earnings_estimates as ee
    monkeypatch.setattr(ee, "get_chart_markers", lambda s: {"earnings": earnings, "splits": [], "dividends": []})


def _mock_tweets(monkeypatch, rows):
    import api.services.tweet_store as ts
    monkeypatch.setattr(ts, "tweets_for_ticker", lambda s, hours=48: list(rows))


class TestMerge:
    def test_sorts_newest_first_and_tags_types(self, monkeypatch):
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [
            {"date": "2026-03-10", "beat": True, "surprise": 8.0, "eps_actual": 1.2,
             "eps_estimate": 1.1, "fiscal_quarter": 4, "fiscal_year": 2025},
        ])
        _mock_tweets(monkeypatch, [
            {"id": "1", "author_handle": "DeItaone", "text": "NVDA breaking headline",
             "created_at": int(time.time()), "url": "http://x/1"},
        ])
        store.replace_catalysts("NVDA", service.HIST_PERIOD, [
            {"date": "2026-01-05", "title": "AI supply deal", "description": "Up.",
             "move_pct": 10.0, "direction": "up"},
        ])
        cache.invalidate("news_hist_NVDA"); cache.invalidate("news_live_NVDA")

        events = service._combined("NVDA")
        types = [e["type"] for e in events]
        assert "catalyst" in types and "earnings" in types and "breaking" in types
        # Newest first: the tweet (now) precedes the March earnings precedes Jan catalyst.
        ts_order = [e["ts"] for e in events]
        assert ts_order == sorted(ts_order, reverse=True)

    def test_dedup_catalyst_near_earnings(self, monkeypatch):
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [
            {"date": "2026-03-10", "beat": True, "surprise": 8.0, "fiscal_quarter": 4, "fiscal_year": 2025},
        ])
        _mock_tweets(monkeypatch, [])
        store.replace_catalysts("NVDA", service.HIST_PERIOD, [
            {"date": "2026-03-10", "title": "Earnings beat", "move_pct": 10.0, "direction": "up"},  # same day → dropped
            {"date": "2026-01-05", "title": "AI supply deal", "move_pct": 10.0, "direction": "up"},  # kept
        ])
        cache.invalidate("news_hist_NVDA")
        events = service._combined("NVDA")
        cats = [e for e in events if e["type"] == "catalyst"]
        assert len(cats) == 1 and cats[0]["date"] == "2026-01-05"

    def test_earnings_direction_from_price_reaction(self, monkeypatch):
        # Beat, but the report-day bar (03-10) closed UP +10% vs prior close → 'up'.
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [
            {"date": "2026-03-10", "beat": True, "surprise": 8.0, "fiscal_quarter": 4, "fiscal_year": 2025},
        ])
        _mock_tweets(monkeypatch, [])
        events = service._combined("NVDA")
        earn = [e for e in events if e["type"] == "earnings"][0]
        # Reaction measured vs prior close (132 vs 99 → +33.3%); direction 'up'
        # even though it was a beat, proving price-reaction (not beat/miss) wins.
        assert earn["direction"] == "up" and earn["move_pct"] == 33.3

    def test_earnings_details_include_revenue(self, monkeypatch):
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [
            {"date": "2026-03-10", "beat": True, "surprise": 19.0, "eps_actual": 0.41,
             "eps_estimate": 0.3446, "revenue_actual": 40_600_000_000,
             "revenue_estimate": 39_900_000_000, "fiscal_quarter": 4, "fiscal_year": 2025},
        ])
        _mock_tweets(monkeypatch, [])
        events = service._combined("NVDA")
        earn = [e for e in events if e["type"] == "earnings"][0]
        det = earn["details"]
        assert any("EPS 0.41 vs 0.34 est" in d for d in det)      # estimate rounded to 2dp
        assert any("Revenue $40.60B vs $39.90B est" in d for d in det)
        assert "Revenue $40.60B vs $39.90B est" in (earn["description"] or "")   # inline carries revenue

    def test_pre_2026_earnings_filtered(self, monkeypatch):
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [{"date": "2025-11-01", "beat": True}])
        _mock_tweets(monkeypatch, [])
        events = service._combined("NVDA")
        assert not [e for e in events if e["type"] == "earnings"]


class TestGeneration:
    def test_generate_both_directions_and_store(self, monkeypatch):
        _mock_bars(monkeypatch)
        monkeypatch.setattr(significant_catalysts, "generate", lambda *a, **k: [
            {"date": "2026-01-05", "title": "AI deal", "description": "Up.", "move_pct": 10.0,
             "direction": "up", "sort_order": 0},
            {"date": "2026-01-06", "title": "Guidance cut", "description": "Down.", "move_pct": -10.0,
             "direction": "down", "sort_order": 1},
        ])
        service._generate_and_store("NVDA")
        rows = store.get_catalysts("NVDA", service.HIST_PERIOD)
        assert {r["direction"] for r in rows} == {"up", "down"}

    def test_generate_once(self, monkeypatch):
        _mock_bars(monkeypatch)
        calls = {"n": 0}

        def _gen(*a, **k):
            calls["n"] += 1
            return [{"date": "2026-01-05", "title": "AI deal", "move_pct": 10.0, "direction": "up"}]

        monkeypatch.setattr(significant_catalysts, "generate", _gen)
        assert store.needs_generation("NVDA", service.HIST_PERIOD, 86400) is True
        service._generate_and_store("NVDA")
        assert calls["n"] == 1
        assert store.needs_generation("NVDA", service.HIST_PERIOD, 86400) is False
        # feed() must NOT re-generate (status 'ready') now that rows exist.
        _mock_earnings(monkeypatch, []); _mock_tweets(monkeypatch, [])
        cache.invalidate("news_hist_NVDA")
        assert service.feed("NVDA")["status"] == "ready"
        assert calls["n"] == 1

    def test_empty_bars_marks_attempt_no_rows(self, monkeypatch):
        monkeypatch.setattr(service, "_daily_bars_since", lambda sym, lo=service.YTD_LO: [])
        called = {"gen": 0}
        monkeypatch.setattr(significant_catalysts, "generate", lambda *a, **k: called.__setitem__("gen", called["gen"] + 1) or [])
        service._generate_and_store("EMPTY")
        assert store.get_catalysts("EMPTY", service.HIST_PERIOD) == []
        assert called["gen"] == 0                       # generator never called on empty bars
        assert store.needs_generation("EMPTY", service.HIST_PERIOD, 86400) is False  # attempt stamped

    def test_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("NEWS_CATALYSTS_ENABLED", "0")
        _mock_earnings(monkeypatch, []); _mock_tweets(monkeypatch, [])
        _mock_bars(monkeypatch)
        out = service.feed("NVDA")
        assert out["status"] == "ready"                 # no generation attempted


class TestWebGrounding:
    def test_web_research_grounds_and_tags_source_url(self, monkeypatch):
        _mock_bars(monkeypatch)
        import api.services.perplexity_search as pplx
        monkeypatch.setattr(pplx, "web_search", lambda *a, **k: {
            "answer": "On 2026-01-05 the company signed a major cloud deal that spiked shares.",
            "citations": ["https://finance.yahoo.com/x", "https://tikr.com/y"],
        })
        captured = {}

        def _gen(*a, **k):
            captured["grounding"] = k.get("grounding")
            return [{"date": "2026-01-05", "title": "Major cloud deal",
                     "description": "Signed a big cloud contract.", "move_pct": 99.0, "direction": "up"}]

        monkeypatch.setattr(significant_catalysts, "generate", _gen)
        service._generate_and_store("NVDA")
        rows = store.get_catalysts("NVDA", service.HIST_PERIOD)
        assert len(rows) == 1
        assert rows[0]["source"] == "web"
        assert rows[0]["url"] == "https://finance.yahoo.com/x"       # top citation
        assert rows[0]["move_pct"] == 10.0                          # recomputed from the real bar
        assert "cloud deal" in (captured["grounding"] or "").lower()  # research fed as grounding

    def test_falls_back_to_ai_when_web_unavailable(self, monkeypatch):
        _mock_bars(monkeypatch)
        import api.services.perplexity_search as pplx
        monkeypatch.setattr(pplx, "web_search", lambda *a, **k: {"error": "PERPLEXITY_API_KEY not set", "answer": ""})
        captured = {}

        def _gen(*a, **k):
            captured["grounding"] = k.get("grounding")
            return [{"date": "2026-01-05", "title": "X", "move_pct": 10.0, "direction": "up"}]

        monkeypatch.setattr(significant_catalysts, "generate", _gen)
        service._generate_and_store("NVDA")
        rows = store.get_catalysts("NVDA", service.HIST_PERIOD)
        assert rows and rows[0]["source"] == "ai"                   # no web → from-memory
        assert captured["grounding"] is None

    def test_web_search_disabled_flag(self, monkeypatch):
        monkeypatch.setenv("NEWS_WEB_SEARCH_ENABLED", "0")
        text, url = service._web_research("NVDA", None, [])
        assert text is None and url is None


class TestBreakingHelpers:
    def test_split_headline_allcaps_lead(self):
        head, body = service._split_headline(
            "MORGAN STANLEY SEES CLOUD SPENDING SURGING TO $1.2T Morgan Stanley expects global cloud capital spending to reach $1.2 trillion."
        )
        assert head == "MORGAN STANLEY SEES CLOUD SPENDING SURGING TO $1.2T"
        assert body and body.startswith("Morgan Stanley expects")

    def test_split_headline_dash_cashtags(self):
        head, body = service._split_headline(
            "UPDATE: Trump Administration Drafting Ban on New Chinese Data Center Component Imports - $POET $COHR $LITE 👉 Key Highlights: ..."
        )
        assert head == "Trump Administration Drafting Ban on New Chinese Data Center Component Imports"
        assert body and body.startswith("$POET")

    def test_relevance_filters_passing_mention(self):
        text = ("AMAZON $AMZN TOPS $3 TRILLION Shares rose, joining Nvidia $NVDA, "
                "Alphabet $GOOGL, Microsoft $MSFT and Apple $AAPL")
        head, _ = service._split_headline(text)
        assert service._tweet_relevant(text, "MSFT", head) is False   # buried among many
        assert service._tweet_relevant(text, "AMZN", head) is True    # subject / first / headline

    def test_relevance_keeps_two_ticker_tweet(self):
        text = "$AMD launches a chip to rival $NVDA in AI accelerators"
        head, _ = service._split_headline(text)
        assert service._tweet_relevant(text, "NVDA", head) is True

    def test_dedup_keeps_earliest_of_near_duplicates(self):
        t1 = "Trump administration drafting ban on Chinese data center component imports"
        t2 = "UPDATE: Trump Administration Drafting Ban on New Chinese Data Center Component Imports for AI"
        early = {"ts": 100, "title": "early", "type": "breaking"}
        late = {"ts": 200, "title": "late", "type": "breaking"}
        # Pass late first (newest-first order) — dedup must still keep the earlier ts.
        kept = service._dedup_breaking([(late, service._sig_words(t2)), (early, service._sig_words(t1))])
        assert len(kept) == 1 and kept[0]["ts"] == 100

    def test_dedup_keeps_distinct_stories(self):
        a = {"ts": 100, "type": "breaking"}
        b = {"ts": 200, "type": "breaking"}
        kept = service._dedup_breaking([
            (a, service._sig_words("Company announces record quarterly revenue growth")),
            (b, service._sig_words("Regulators open antitrust probe into advertising practices")),
        ])
        assert len(kept) == 2

    def test_breaking_relevance_end_to_end(self, monkeypatch):
        # A 5-ticker roundup where MSFT is only name-dropped → excluded from MSFT feed.
        _mock_bars(monkeypatch)
        _mock_earnings(monkeypatch, [])
        _mock_tweets(monkeypatch, [
            {"id": "1", "author_handle": "faststocknewss",
             "text": "AMAZON $AMZN TOPS $3 TRILLION Shares rose, joining $NVDA, $GOOGL, $MSFT and $AAPL",
             "created_at": 1000, "url": "http://x/1"},
        ])
        cache.invalidate("news_live_MSFT")
        events = service._breaking_events("MSFT")
        assert events == []
