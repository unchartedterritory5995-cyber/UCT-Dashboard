import json
import os
import tempfile
import time

import pytest

from api.services.catalyst import store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield store


def _row(ticker, market_date="2026-05-26", rank=1, tag="Catalyst",
         thesis="test thesis", sources=None, signals_hash="abc", **kw):
    return {
        "market_date": market_date,
        "ticker": ticker,
        "rank": rank,
        "score": kw.get("score", 10.0),
        "tag": tag,
        "price": kw.get("price", 100.0),
        "gap_pct": kw.get("gap_pct", 5.0),
        "vol_x": kw.get("vol_x", 2.0),
        "market_cap": kw.get("market_cap", 1_000_000_000),
        "sector": kw.get("sector", "Tech"),
        "thesis_text": thesis,
        "thesis_model": kw.get("thesis_model", "claude-opus-4-7"),
        "thesis_at": kw.get("thesis_at", int(time.time())),
        "thesis_sources": json.dumps(sources or []),
        "signals_hash": signals_hash,
        "catalyst_at": kw.get("catalyst_at"),
        "raw_signals": kw.get("raw_signals", "{}"),
    }


def test_upsert_is_idempotent_on_ticker_per_date(s):
    s.upsert_catalyst(_row("AAPL"))
    s.upsert_catalyst(_row("AAPL", thesis="updated"))
    rows = s.get_for_date("2026-05-26")
    assert len(rows) == 1
    assert rows[0]["thesis_text"] == "updated"


def test_get_for_date_orders_by_rank(s):
    s.upsert_catalyst(_row("ZZZ", rank=12))
    s.upsert_catalyst(_row("AAA", rank=1))
    s.upsert_catalyst(_row("MID", rank=5))
    rows = s.get_for_date("2026-05-26")
    assert [r["ticker"] for r in rows] == ["AAA", "MID", "ZZZ"]


def test_get_today_returns_only_today(s):
    s.upsert_catalyst(_row("YES", market_date="2026-05-26"))
    s.upsert_catalyst(_row("OLD", market_date="2026-05-20"))
    today = s.get_for_date("2026-05-26")
    assert {r["ticker"] for r in today} == {"YES"}


def test_get_ticker_today_for_skip_stable_check(s):
    s.upsert_catalyst(_row("AAPL", signals_hash="hash1"))
    found = s.get_ticker_for_date("AAPL", "2026-05-26")
    assert found["signals_hash"] == "hash1"
    assert s.get_ticker_for_date("MISSING", "2026-05-26") is None


def test_history_for_ticker_returns_newest_first_across_dates(s):
    s.upsert_catalyst(_row("NVDA", market_date="2026-05-20", thesis="oldest"))
    s.upsert_catalyst(_row("NVDA", market_date="2026-05-26", thesis="newest"))
    s.upsert_catalyst(_row("NVDA", market_date="2026-05-23", thesis="middle"))
    s.upsert_catalyst(_row("AMD", market_date="2026-05-26", thesis="not nvda"))
    rows = s.history_for_ticker("NVDA")
    assert [r["thesis_text"] for r in rows] == ["newest", "middle", "oldest"]


def test_history_for_ticker_is_not_filtered_by_rank(s):
    """Packet G CP1: a ticker that surfaced but did not make a given day's
    top-20 (rank=None, cleared by clear_ranks_for_date) still shows in its
    own history -- the Catalysts tab is a history of what the engine
    NOTICED, not a re-rendering of the top-20 list."""
    s.upsert_catalyst(_row("TSLA", market_date="2026-05-26", rank=3))
    s.clear_ranks_for_date("2026-05-26")
    rows = s.history_for_ticker("TSLA")
    assert len(rows) == 1
    assert rows[0]["rank"] is None


def test_history_for_ticker_never_flagged_returns_empty_not_an_error(s):
    assert s.history_for_ticker("ZZZZ") == []


def test_history_for_ticker_respects_limit(s):
    for i, d in enumerate(["2026-05-20", "2026-05-21", "2026-05-22"]):
        s.upsert_catalyst(_row("SPY", market_date=d))
    rows = s.history_for_ticker("SPY", limit=2)
    assert len(rows) == 2
    assert rows[0]["market_date"] == "2026-05-22"


def test_clear_unselected_for_date_keeps_top_12(s):
    for i, t in enumerate(["A", "B", "C"]):
        s.upsert_catalyst(_row(t, rank=i + 1))
    s.clear_ranks_for_date("2026-05-26")
    rows = s.get_for_date("2026-05-26", ranked_only=False)
    assert all(r["rank"] is None for r in rows)


def test_cost_log_writes(s):
    s.log_cost(market_date="2026-05-26", ticker="AAPL",
               model="claude-opus-4-7", input_tokens=1000,
               output_tokens=250, cost_usd=0.015, was_cached=False)
    s.log_cost(market_date="2026-05-26", ticker="MSFT",
               model="claude-opus-4-7", input_tokens=0,
               output_tokens=0, cost_usd=0.0, was_cached=True)
    stats = s.cost_stats_for_date("2026-05-26")
    assert stats["total_cost_usd"] == pytest.approx(0.015)
    assert stats["call_count"] == 2
    assert stats["cached_count"] == 1
