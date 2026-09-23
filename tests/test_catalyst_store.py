import datetime
import json
import os
import tempfile
import time
from zoneinfo import ZoneInfo

import pytest

from api.services.catalyst import store

_ET = ZoneInfo("America/New_York")


def _date(days_ago: int) -> str:
    return (datetime.datetime.now(_ET).date() - datetime.timedelta(days=days_ago)).isoformat()


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


# ---- redact_stale_raw_signals (PACKET-S CP5, RG-21 §1e) --------------------

def _raw_signals(**overrides):
    base = {
        "tweets": [
            {"id": "t1", "author_handle": "DeItaone", "text": "$AAPL beats estimates", "created_at": 1234567890},
        ],
        "rss": [
            {"source": "CNBC", "title": "Apple surges on earnings", "url": "https://cnbc.com/x", "time_published": 1234567891},
        ],
        "earnings_meta": {"publish_time": 1234567800},
        "scanner_setup": "pullback_ma",
        "options_flow": {"dir": "bull", "netPremium": 500000, "bullPct": 62},
        "brain_grade": "B",
    }
    base.update(overrides)
    return base


def test_redact_strips_tweet_text_and_rss_title_url_for_stale_rows(s):
    s.upsert_catalyst(_row("AAPL", market_date=_date(10), raw_signals=json.dumps(_raw_signals())))

    n = s.redact_stale_raw_signals(days=7)

    assert n == 1
    row = s.get_ticker_for_date("AAPL", _date(10))
    signals = json.loads(row["raw_signals"])
    assert "text" not in signals["tweets"][0]
    assert "title" not in signals["rss"][0]
    assert "url" not in signals["rss"][0]


def test_redact_preserves_structural_fields_and_counts(s):
    s.upsert_catalyst(_row("AAPL", market_date=_date(10), raw_signals=json.dumps(_raw_signals())))
    s.redact_stale_raw_signals(days=7)
    row = s.get_ticker_for_date("AAPL", _date(10))
    signals = json.loads(row["raw_signals"])

    # Counts (list lengths) survive.
    assert len(signals["tweets"]) == 1
    assert len(signals["rss"]) == 1
    # Timestamps + author + source (what _compute_catalyst_at / the tile read).
    assert signals["tweets"][0]["created_at"] == 1234567890
    assert signals["tweets"][0]["author_handle"] == "DeItaone"
    assert signals["rss"][0]["time_published"] == 1234567891
    assert signals["rss"][0]["source"] == "CNBC"
    # Non-vendor-text structured signals untouched entirely.
    assert signals["earnings_meta"] == {"publish_time": 1234567800}
    assert signals["scanner_setup"] == "pullback_ma"
    assert signals["options_flow"] == {"dir": "bull", "netPremium": 500000, "bullPct": 62}
    assert signals["brain_grade"] == "B"


def test_redact_never_touches_thesis_score_grade_tag_ticker(s):
    s.upsert_catalyst(_row("AAPL", market_date=_date(10), thesis="Apple beat on iPhone demand",
                           score=42.5, tag="Earnings", raw_signals=json.dumps(_raw_signals())))
    s.upsert_catalyst(_row("AAPL", market_date=_date(10), thesis="Apple beat on iPhone demand",
                           score=42.5, tag="Earnings", raw_signals=json.dumps(_raw_signals())))
    s.redact_stale_raw_signals(days=7)

    row = s.get_ticker_for_date("AAPL", _date(10))
    assert row["thesis_text"] == "Apple beat on iPhone demand"
    assert row["score"] == 42.5
    assert row["tag"] == "Earnings"
    assert row["ticker"] == "AAPL"


def test_redact_control_leaves_recent_rows_untouched(s):
    # Control: a row inside the retention window must NOT be redacted --
    # otherwise the "stale" gate is doing nothing and this would silently
    # strip vendor text off catalysts still fully within their normal life.
    recent_signals = _raw_signals()
    s.upsert_catalyst(_row("MSFT", market_date=_date(1), raw_signals=json.dumps(recent_signals)))

    n = s.redact_stale_raw_signals(days=7)

    assert n == 0
    row = s.get_ticker_for_date("MSFT", _date(1))
    signals = json.loads(row["raw_signals"])
    assert signals["tweets"][0]["text"] == "$AAPL beats estimates"
    assert signals["rss"][0]["title"] == "Apple surges on earnings"
    assert signals["rss"][0]["url"] == "https://cnbc.com/x"


def test_redact_is_idempotent_second_pass_is_a_noop(s):
    s.upsert_catalyst(_row("AAPL", market_date=_date(10), raw_signals=json.dumps(_raw_signals())))
    first = s.redact_stale_raw_signals(days=7)
    second = s.redact_stale_raw_signals(days=7)
    assert first == 1
    assert second == 0  # nothing left to strip


def test_redact_skips_rows_with_no_raw_signals(s):
    s.upsert_catalyst(_row("ZZZ", market_date=_date(10), raw_signals=None))
    n = s.redact_stale_raw_signals(days=7)
    assert n == 0


def test_redact_handles_malformed_json_without_raising(s):
    s.upsert_catalyst(_row("BADJSON", market_date=_date(10), raw_signals="not valid json{{"))
    n = s.redact_stale_raw_signals(days=7)
    assert n == 0
    row = s.get_ticker_for_date("BADJSON", _date(10))
    assert row["raw_signals"] == "not valid json{{"  # left alone, not corrupted
