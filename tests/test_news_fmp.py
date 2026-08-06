"""FMP news as the primary leg of engine.get_news() / _compute_news()
(data-dependability migration plan, Phase 3 Task 14).

Covers: `_fmp_news_item` field mapping; FMP general-latest + news/stock
contributing to the merged feed; AV rate-limited/absent no longer degrading
to RSS-only once FMP has content; the C20 TTL/stale-slot predicate extended
to recognize an FMP-only healthy cycle (not just an AV-only one).
"""
from unittest.mock import patch

from api.services import engine
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    import time
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class _FakeResp:
    def __init__(self, obj):
        self._obj = obj

    def raise_for_status(self):
        pass

    def json(self):
        return self._obj


# ── _fmp_news_item field mapping ─────────────────────────────────────────

def test_fmp_news_item_maps_fields():
    row = {
        "symbol": "AAPL",
        "publishedDate": "2026-08-05 14:30:00",
        "publisher": "Reuters",
        "title": "Apple beats on strong iPhone demand",
        "image": "https://images.financialmodelingprep.com/news/x.jpg",
        "site": "reuters.com",
        "text": "Apple reported...",
        "url": "https://reuters.com/x",
    }
    item = engine._fmp_news_item(row, tickers=["AAPL"])
    assert item["headline"] == "Apple beats on strong iPhone demand"
    assert item["source"] == "Reuters"
    assert item["url"] == "https://reuters.com/x"
    assert item["time"] == "2026-08-05 14:30:00"
    assert item["tickers"] == ["AAPL"]
    # No FMP news endpoint carries a sentiment score (plan §D3) -- "neutral"
    # is the SAME "no signal" default the RSS leg already uses, never a
    # fabricated real reading.
    assert item["sentiment"] == "neutral"


def test_fmp_news_item_falls_back_to_site_when_publisher_missing():
    row = {"title": "Some headline", "site": "seekingalpha.com", "url": "https://x",
           "publishedDate": "2026-08-05 10:00:00"}
    item = engine._fmp_news_item(row, tickers=[])
    assert item["source"] == "seekingalpha.com"
    assert item["tickers"] == []


def test_fmp_news_item_blank_title_returns_none():
    assert engine._fmp_news_item({"title": "", "url": "https://x"}, tickers=["AAPL"]) is None
    assert engine._fmp_news_item({"url": "https://x"}, tickers=["AAPL"]) is None


# ── _compute_news(): FMP contributes both general + per-symbol legs ──────

def _no_av_no_edgar_no_movers(monkeypatch):
    """Shared scaffolding: AV unset (never called), EDGAR empty, no movers
    (so the news/stock leg has nothing to query unless a test overrides it)."""
    monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
    monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
    monkeypatch.setattr("api.services.massive.get_movers", lambda: {"ripping": [], "drilling": []})
    monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, True), raising=False)


class TestFmpPrimaryLeg:
    def setup_method(self):
        cache.invalidate("news")
        engine._news_stale["value"] = None

    def test_fmp_general_latest_contributes_tickerless_items(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        _no_av_no_edgar_no_movers(monkeypatch)

        general_rows = [{
            "symbol": None, "publishedDate": "2026-08-05 09:00:00",
            "publisher": "Seeking Alpha", "title": "Tech takes off toward the highs",
            "site": "seekingalpha.com", "url": "https://seekingalpha.com/x",
        }]

        def _fake_get(url, params=None, timeout=None, headers=None):
            if "general-latest" in url:
                return _FakeResp(general_rows)
            if "news/stock" in url:
                return _FakeResp([])
            raise AssertionError(f"unexpected URL in this test: {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()

        headlines = [r["headline"] for r in result]
        assert "Tech takes off toward the highs" in headlines
        item = next(r for r in result if r["headline"] == "Tech takes off toward the highs")
        assert item["tickers"] == []

    def test_fmp_news_stock_contributes_ticker_tagged_items(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        _no_av_no_edgar_no_movers(monkeypatch)
        # Give the news/stock leg a symbol to query for.
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [{"sym": "MSFT", "pct": "+5.0%"}], "drilling": []})

        stock_rows = [{
            "symbol": "MSFT", "publishedDate": "2026-08-05 09:05:00",
            "publisher": "24/7 Wall Street", "title": "MSFT hyperscaler capex story",
            "site": "247wallst.com", "url": "https://247wallst.com/x",
        }]

        def _fake_get(url, params=None, timeout=None, headers=None):
            if "general-latest" in url:
                return _FakeResp([])
            if "news/stock" in url:
                assert params.get("symbols") == "MSFT"
                return _FakeResp(stock_rows)
            raise AssertionError(f"unexpected URL in this test: {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()

        item = next(r for r in result if r["headline"] == "MSFT hyperscaler capex story")
        assert item["tickers"] == ["MSFT"]

    def test_fmp_news_stock_respects_the_cap_etf_filter(self, monkeypatch):
        """An FMP-tagged symbol that fails the SAME `_check_sym_cap` gate AV
        tickers go through must be excluded, not silently trusted."""
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
        monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [{"sym": "PENNY", "pct": "+5.0%"}], "drilling": []})
        monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, False), raising=False)

        stock_rows = [{
            "symbol": "PENNY", "publishedDate": "2026-08-05 09:05:00",
            "publisher": "X", "title": "Penny stock pumps", "url": "https://x",
        }]

        def _fake_get(url, params=None, timeout=None, headers=None):
            if "general-latest" in url:
                return _FakeResp([])
            if "news/stock" in url:
                return _FakeResp(stock_rows)
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()
        headlines = [r["headline"] for r in result]
        assert "Penny stock pumps" not in headlines


# ── AV throttled/absent must no longer degrade to RSS-only once FMP works ──

class TestAvFailureFmpFillsGap:
    def setup_method(self):
        cache.invalidate("news")
        engine._news_stale["value"] = None

    def test_av_rate_limited_fmp_success_skips_rss(self, monkeypatch):
        """Before this task: AV rate-limited -> RSS was the ONLY leg standing
        (see test_engine_themes_news_cache_policy.py's RSS-only case). Now,
        with FMP contributing real content, the feed must NOT fall through to
        RSS at all -- FMP fills the gap AV's throttle left."""
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "fake-av-key")
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [], "drilling": []})
        monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, True), raising=False)

        rss_calls = []
        monkeypatch.setattr(
            "api.services.news_aggregator.fetch_rss_news",
            lambda *a, **k: rss_calls.append(1) or [],
        )

        general_rows = [{
            "symbol": None, "publishedDate": "2026-08-05 09:00:00",
            "publisher": "Bloomberg", "title": "Market rallies on rate-cut hopes",
            "url": "https://bloomberg.com/x",
        }]

        def _fake_get(url, params=None, timeout=None, headers=None, **kw):
            if "alphavantage" in url:
                return _FakeResp({"Information": "rate limit hit"})
            if "general-latest" in url:
                return _FakeResp(general_rows)
            if "news/stock" in url:
                return _FakeResp([])
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()

        headlines = [r["headline"] for r in result]
        assert "Market rallies on rate-cut hopes" in headlines
        assert rss_calls == []  # RSS was never invoked -- FMP already had content

    def test_av_rate_limited_and_fmp_empty_still_falls_back_to_rss(self, monkeypatch):
        """Control: when FMP ALSO has nothing this cycle, the RSS chain must
        still fire exactly as before this task (unchanged behavior)."""
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "fake-av-key")
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [], "drilling": []})
        monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, True), raising=False)

        rss_row = {
            "title": "RSS-sourced headline", "source": "CNBC", "url": "https://x",
            "time_published": "2026-08-05T12:00:00Z", "category": "general",
            "sentiment_label": "Neutral", "tickers": [],
        }
        monkeypatch.setattr(
            "api.services.news_aggregator.fetch_rss_news",
            lambda *a, **k: [rss_row],
        )

        def _fake_get(url, params=None, timeout=None, headers=None, **kw):
            if "alphavantage" in url:
                return _FakeResp({"Information": "rate limit hit"})
            if "general-latest" in url:
                return _FakeResp([])
            if "news/stock" in url:
                return _FakeResp([])
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()
        headlines = [r["headline"] for r in result]
        assert "RSS-sourced headline" in headlines


# ── C20 predicate, extended: an FMP-only healthy cycle must get full TTL ──

class TestHealthyPredicateCoversFmp:
    def setup_method(self):
        cache.invalidate("news")
        engine._news_stale["value"] = None

    def test_fmp_only_success_gets_full_ttl_and_becomes_stale(self, monkeypatch):
        """AV not configured at all (a legitimate, common state -- 25/day
        budget). FMP alone succeeding must STILL count as healthy: full TTL,
        promoted to `_news_stale`. Before generalizing `_healthy` to check
        FMP too, this cycle would have gotten the SHORT TTL despite carrying
        real content, because only `_av_ok` was checked."""
        monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [], "drilling": []})

        general_rows = [{
            "symbol": None, "publishedDate": "2026-08-05 09:00:00",
            "publisher": "Reuters", "title": "A real FMP-sourced headline",
            "url": "https://reuters.com/x",
        }]

        def _fake_get(url, params=None, timeout=None, headers=None, **kw):
            if "general-latest" in url:
                return _FakeResp(general_rows)
            if "news/stock" in url:
                return _FakeResp([])
            raise AssertionError(f"unexpected URL (AV must not be called -- no key): {url}")

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()

        assert result and not result[0].get("error")
        assert _ttl_remaining("news") > 1000
        assert engine._news_stale["value"] == result

    def test_both_sources_empty_gets_short_ttl(self, monkeypatch):
        """Control: FMP configured but genuinely empty, no AV key -- must NOT
        be treated as healthy just because no exception was raised."""
        monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
        monkeypatch.setenv("FMP_API_KEY", "fake-fmp-key")
        monkeypatch.setattr("api.services.edgar.fetch_edgar_news", lambda *a, **k: [])
        monkeypatch.setattr("api.services.massive.get_movers",
                            lambda: {"ripping": [], "drilling": []})
        monkeypatch.setattr("api.services.news_aggregator.fetch_rss_news", lambda *a, **k: [])

        def _fake_get(url, params=None, timeout=None, headers=None, **kw):
            return _FakeResp([])

        monkeypatch.setattr("requests.get", _fake_get)

        result = engine._compute_news()

        assert _ttl_remaining("news") <= 700
        assert engine._news_stale["value"] is None
