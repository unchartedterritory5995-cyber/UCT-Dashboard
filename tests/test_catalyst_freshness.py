"""Tests for catalyst freshness (new vs developing).

Covers:
  - store.recent_ranked_tickers window/strictness + is_new column roundtrip
  - scoring freshness boost (new-only, no penalty, additive/no-regression)
"""
import importlib
import json
import os
import time

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    """Fresh store module bound to a tmp DB via CATALYST_DB_PATH + reload."""
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()
    yield _store
    # Restore the module to the default-env state for any later importers.
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


def _row(ticker, market_date, rank=1, **kw):
    return {
        "market_date": market_date,
        "ticker": ticker,
        "rank": rank,
        "score": kw.get("score", 10.0),
        "tag": kw.get("tag", "Catalyst"),
        "price": kw.get("price", 100.0),
        "gap_pct": kw.get("gap_pct", 5.0),
        "vol_x": kw.get("vol_x", 2.0),
        "market_cap": kw.get("market_cap", 1_000_000_000),
        "sector": kw.get("sector", "Tech"),
        "thesis_text": kw.get("thesis_text", "t"),
        "thesis_model": kw.get("thesis_model", "claude-opus-4-7"),
        "thesis_at": kw.get("thesis_at", int(time.time())),
        "thesis_sources": json.dumps(kw.get("sources", [])),
        "signals_hash": kw.get("signals_hash", "abc"),
        "catalyst_at": kw.get("catalyst_at"),
        "raw_signals": kw.get("raw_signals", "{}"),
        "is_new": kw.get("is_new"),
    }


# ---------------------------------------------------------------------------
# TASK 1 — recent_ranked_tickers + is_new column
# ---------------------------------------------------------------------------

def test_recent_ranked_tickers_window_and_strictness(store):
    today = "2026-06-15"
    # AAA ranked on the two prior days — inside a 3-day window.
    store.upsert_catalyst(_row("AAA", "2026-06-14", rank=1))
    store.upsert_catalyst(_row("AAA", "2026-06-13", rank=2))
    # BBB ranked 5 days ago — OUTSIDE the 3-day window.
    store.upsert_catalyst(_row("BBB", "2026-06-10", rank=1))
    # CCC ranked TODAY — must be excluded (strictly-before).
    store.upsert_catalyst(_row("CCC", today, rank=1))

    result = store.recent_ranked_tickers(today, days=3)
    assert result == {"AAA"}
    assert "BBB" not in result
    assert "CCC" not in result


def test_recent_ranked_tickers_excludes_unranked(store):
    today = "2026-06-15"
    # Unranked (rank=None) row in-window must NOT count.
    store.upsert_catalyst(_row("DDD", "2026-06-14", rank=None))
    assert store.recent_ranked_tickers(today, days=3) == set()


def test_recent_ranked_tickers_uppercases(store):
    today = "2026-06-15"
    store.upsert_catalyst(_row("eee", "2026-06-14", rank=1))
    assert store.recent_ranked_tickers(today, days=3) == {"EEE"}


def test_recent_ranked_tickers_never_raises(store):
    # Bad date string → returns set(), no exception.
    assert store.recent_ranked_tickers("not-a-date", days=3) == set()


def test_is_new_upsert_get_roundtrip(store):
    md = "2026-06-15"
    store.upsert_catalyst(_row("NEW", md, rank=1, is_new=True))
    store.upsert_catalyst(_row("OLD", md, rank=2, is_new=False))
    by_sym = {r["ticker"]: r for r in store.get_for_date(md)}
    assert by_sym["NEW"]["is_new"] == 1
    assert by_sym["OLD"]["is_new"] == 0


# ---------------------------------------------------------------------------
# TASK 3 — scoring freshness boost
# ---------------------------------------------------------------------------

def _base_candidate():
    return {"gap_pct": 8.0, "vol_x": 3.0, "price": 50.0,
            "market_cap": 5_000_000_000, "tweet_mention_count": 1}


def test_freshness_boost_only_for_new(monkeypatch):
    monkeypatch.delenv("CATALYST_SCORE_W_FRESHNESS", raising=False)
    from api.services.catalyst import scoring

    new_c = {**_base_candidate(), "is_new": True}
    dev_c = {**_base_candidate(), "is_new": False}
    assert scoring.score(new_c) - scoring.score(dev_c) == pytest.approx(6.0)


def test_missing_is_new_key_is_no_op(monkeypatch):
    """An existing-style candidate WITHOUT the is_new key behaves like is_new=False
    (additive / no-regression guarantee)."""
    monkeypatch.delenv("CATALYST_SCORE_W_FRESHNESS", raising=False)
    from api.services.catalyst import scoring

    no_key = _base_candidate()           # no is_new key at all
    dev_c = {**_base_candidate(), "is_new": False}
    assert scoring.score(no_key) == scoring.score(dev_c)


def test_freshness_weight_env_override(monkeypatch):
    monkeypatch.setenv("CATALYST_SCORE_W_FRESHNESS", "10.0")
    from api.services.catalyst import scoring

    new_c = {**_base_candidate(), "is_new": True}
    dev_c = {**_base_candidate(), "is_new": False}
    assert scoring.score(new_c) - scoring.score(dev_c) == pytest.approx(10.0)
