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
