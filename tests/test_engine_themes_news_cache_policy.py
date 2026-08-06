"""Regression tests for the data-dependability Phase 4 cache-poison sweep,
engine.py sites C20 (news TTL keyed on the wrong source), C21 (theme fetch
error cached 1h), and C22 (`snap.get(ticker, 0.0)` fabricating a +0.00% for a
missing snapshot -- the `Number(null) === 0` bug in Python form).
"""
import time
from unittest.mock import patch

import pytest

from api.services import engine
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


# ── C22: get_themes("Today") must not fabricate a 0.0 for a missing snapshot ─

class TestThemesTodaySnapshotHonesty:
    def setup_method(self):
        cache.invalidate("themes_Today")

    def test_missing_snapshot_excluded_not_fabricated_zero(self, monkeypatch):
        """A real ETF ticker with NO entry in the Massive snapshot map (a
        provider miss) must be excluded from the ranked Today view, not
        fabricated into "leaders" at a fake +0.00% indistinguishable from a
        genuinely flat print. (`_normalize_themes`'s `data.get(period, 0) or
        0` used to collapse the honest None straight back to 0 even after
        `get_themes` stopped defaulting to 0.0 -- both layers had to change.)
        """
        wire = {"themes": {"XLK": {"name": "Technology", "ticker": "XLK",
                                    "etf_name": "Tech Sector", "holdings": []}}}
        monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
        # XLK deliberately absent from the snapshot map — simulates a
        # provider miss for that one ticker within an otherwise-fine batch.
        monkeypatch.setattr(engine, "get_etf_snapshots", lambda keys: {}, raising=False)

        result = engine.get_themes("Today")

        all_tickers = [t["ticker"] for t in result.get("leaders", []) + result.get("laggards", [])]
        assert "XLK" not in all_tickers
        # And it must never show as a fabricated flat print under any name.
        assert not any(t.get("pct") == "+0.00%" for t in result.get("leaders", []))

    def test_present_snapshot_still_flows_through(self, monkeypatch):
        """Control: a ticker WITH a real snapshot value still gets that value
        (this predicate must not blank out a legitimate number)."""
        wire = {"themes": {"XLK": {"name": "Technology", "ticker": "XLK",
                                    "etf_name": "Tech Sector", "holdings": []}}}
        monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
        monkeypatch.setattr(engine, "get_etf_snapshots", lambda keys: {"XLK": 1.23}, raising=False)

        result = engine.get_themes("Today")

        all_rows = result.get("leaders", []) + result.get("laggards", [])
        xlk = next(t for t in all_rows if t["ticker"] == "XLK")
        assert xlk["pct"] == "+1.23%"

    def test_curated_pseudo_ticker_also_excluded_not_fabricated(self, monkeypatch):
        """A curated-only (pseudo-ticker) theme has no live ETF to quote for
        Today by design (`get_themes` sets it to None deliberately) -- it
        must be excluded the same way a provider miss is, not fabricated."""
        wire = {"themes": {"ai_gpu_chips": {"name": "AI GPUs", "ticker": "ai_gpu_chips",
                                            "etf_name": "", "holdings": []}}}
        monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
        monkeypatch.setattr(engine, "get_etf_snapshots", lambda keys: {}, raising=False)

        result = engine.get_themes("Today")

        all_tickers = [t["ticker"] for t in result.get("leaders", []) + result.get("laggards", [])]
        assert "ai_gpu_chips" not in all_tickers


# ── C21: theme-fetch error placeholder must self-heal fast, not sit for 1h ──

class TestThemesLocalDevFetchErrorTTL:
    def setup_method(self):
        cache.invalidate("themes_1M")

    def test_fetch_failure_gets_short_ttl(self, monkeypatch):
        """`morning_wire_engine.fetch_theme_tracker()` raising (local-dev-only
        reachability) must not pin the error placeholder for a full hour."""
        monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
        monkeypatch.setattr(engine, "_load_state", lambda: {})
        # Force the import+call inside get_themes to raise regardless of
        # whether the sibling `morning_wire_engine` module is importable in
        # this environment.
        import sys
        import types
        fake_module = types.ModuleType("morning_wire_engine")

        def _raise():
            raise RuntimeError("engine fetch failed")

        fake_module.fetch_theme_tracker = _raise
        monkeypatch.setitem(sys.modules, "morning_wire_engine", fake_module)

        result = engine.get_themes("1M")

        assert result.get("error")
        assert _ttl_remaining("themes_1M") <= 400  # was 3600 (1h)


# ── C20: news TTL/stale-slot must key on which source actually produced it ──

class TestNewsSourceHealthTTL:
    def setup_method(self):
        cache.invalidate("news")
        engine._news_stale["value"] = None

    def test_rss_only_fallback_gets_short_ttl_and_does_not_become_stale(self, monkeypatch):
        """AV rate-limited -> RSS-only payload. `result[0]` carries no `error`
        key (RSS items never do), so the old predicate gave this the full
        30-min success TTL AND let it become the eternal `_news_stale` fallback."""
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "fake-key-for-test")

        class _FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"Information": "rate limit hit"}  # AV throttle signal

        import requests as _requests_mod
        monkeypatch.setattr(_requests_mod, "get", lambda *a, **k: _FakeResp())

        rss_row = {
            "title": "Some real headline", "source": "CNBC", "url": "https://x",
            "time_published": "2026-08-05T12:00:00Z", "category": "general",
            "sentiment_label": "Neutral", "tickers": [],
        }
        monkeypatch.setattr(
            "api.services.news_aggregator.fetch_rss_news",
            lambda *a, **k: [rss_row],
        )
        monkeypatch.setattr(
            "api.services.edgar.fetch_edgar_news",
            lambda *a, **k: [],
        )
        monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, True), raising=False)

        result = engine._compute_news()

        assert result  # RSS content did come through
        assert not result[0].get("error")
        assert _ttl_remaining("news") <= 700          # short TTL, not the 1800s success one
        assert engine._news_stale["value"] is None    # must NOT become the "last good" fallback

    def test_av_healthy_result_gets_full_ttl_and_becomes_stale(self, monkeypatch):
        """Control: when AV actually contributes, the full success TTL and the
        stale-fallback promotion must still both apply (this predicate must
        not become permanently short)."""
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "fake-key-for-test")

        class _FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"feed": [{
                    "title": "AAPL beats on strong iPhone demand",
                    "source": "Reuters", "url": "https://x",
                    "time_published": "20260805T120000",
                    "overall_sentiment_label": "Bullish",
                    "ticker_sentiment": [{"ticker": "AAPL", "relevance_score": "0.9"}],
                }]}

        import requests as _requests_mod
        monkeypatch.setattr(_requests_mod, "get", lambda *a, **k: _FakeResp())
        monkeypatch.setattr(
            "api.services.edgar.fetch_edgar_news",
            lambda *a, **k: [],
        )
        monkeypatch.setattr(engine, "_check_sym_cap", lambda sym: (sym, True), raising=False)

        result = engine._compute_news()

        assert result
        assert not result[0].get("error")
        assert _ttl_remaining("news") > 1000           # the full 1800s success TTL
        assert engine._news_stale["value"] == result   # DOES become the stale fallback
