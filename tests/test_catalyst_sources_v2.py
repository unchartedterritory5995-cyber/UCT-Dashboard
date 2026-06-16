"""Tests for Catalyst Sources v2 — Twitter enhancements.

TASK A1: expanded curated FinTwit accounts + idempotent startup seed.
TASK A2: wider, env-tunable per-candidate Twitter scan.
"""
import importlib
import os

import pytest


# ---------------------------------------------------------------------------
# TASK A1 — ensure_default_accounts
# ---------------------------------------------------------------------------

@pytest.fixture
def fresh_tweet_store(tmp_path, monkeypatch):
    """Point tweet_store at a tmp DB and reload it so module-level _DB_PATH
    picks up the override."""
    db_path = tmp_path / "tweets_v2.db"
    monkeypatch.setenv("TWEET_DB_PATH", str(db_path))
    from api.services import tweet_store as ts
    ts = importlib.reload(ts)
    ts._init_db()
    yield ts


def test_ensure_default_accounts_seeds_all_ten(fresh_tweet_store):
    ts = fresh_tweet_store
    n = ts.ensure_default_accounts()
    assert n == len(ts.DEFAULT_ACCOUNTS) == 10
    accounts = ts.list_accounts()
    handles = {a["handle"] for a in accounts}
    assert len(accounts) == 10
    for handle, _display in ts.DEFAULT_ACCOUNTS:
        assert handle in handles


def test_ensure_default_accounts_is_idempotent(fresh_tweet_store):
    ts = fresh_tweet_store
    ts.ensure_default_accounts()
    ts.ensure_default_accounts()  # second call must not duplicate
    accounts = ts.list_accounts()
    assert len(accounts) == 10


def test_ensure_default_accounts_does_not_reenable_disabled(fresh_tweet_store):
    ts = fresh_tweet_store
    ts.ensure_default_accounts()
    # Admin disables one account between seed runs
    target = ts.DEFAULT_ACCOUNTS[0][0]
    ts.set_account_enabled(target, False)
    ts.ensure_default_accounts()  # re-run must NOT clobber the disabled flag
    by_handle = {a["handle"]: a for a in ts.list_accounts()}
    assert by_handle[target]["enabled"] == 0
    # And still exactly 10 (no dupes)
    assert len(by_handle) == 10


def test_ensure_default_accounts_never_raises(fresh_tweet_store, monkeypatch):
    ts = fresh_tweet_store

    def boom(*a, **k):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(ts, "add_account", boom)
    # Should swallow per-account errors and return 0, not raise.
    assert ts.ensure_default_accounts() == 0


# ---------------------------------------------------------------------------
# TASK A2 — wider, env-tunable per-candidate Twitter scan
# ---------------------------------------------------------------------------

def test_twitter_search_skip_at_and_max_results(monkeypatch):
    """A candidate with 6 existing tweets is now searched (default skip-at 8 > 6)
    and the search is called with the env-tunable max_results default of 30."""
    from api.services.catalyst import engine as cat_engine
    from api.services import twitterapi_io

    # Ensure the feature is on and defaults are in play.
    monkeypatch.setenv("CATALYST_TWITTER_SEARCH_ENABLED", "1")
    monkeypatch.delenv("CATALYST_TWITTER_SEARCH_MAX", raising=False)
    monkeypatch.delenv("CATALYST_TWITTER_SEARCH_SKIP_AT", raising=False)

    captured = {}

    def fake_search(query, since_unix=None, query_type="Latest", max_results=20):
        captured["query"] = query
        captured["max_results"] = max_results
        return [
            {"id": "100", "author_handle": "x", "text": "a", "url": "u1"},
            {"id": "101", "author_handle": "y", "text": "b", "url": "u2"},
            {"id": "102", "author_handle": "z", "text": "c", "url": "u3"},
        ]

    monkeypatch.setattr(twitterapi_io, "search_tweets", fake_search)

    candidate = {
        "ticker": "ABCD",
        "tweets": [
            {"id": str(i), "author_handle": "h", "text": "t", "url": "u"}
            for i in range(6)
        ],
    }
    cat_engine._enrich_with_twitter_search([candidate])

    # (a) candidate WAS searched and merged (6 existing + 3 new = 9)
    assert captured.get("max_results") == 30
    assert len(candidate["tweets"]) == 9
    assert candidate.get("tweet_mention_count") == 9


def test_twitter_search_still_skips_rich_candidate(monkeypatch):
    """A candidate at/above the skip-at threshold (8) is NOT searched."""
    from api.services.catalyst import engine as cat_engine
    from api.services import twitterapi_io

    monkeypatch.setenv("CATALYST_TWITTER_SEARCH_ENABLED", "1")
    monkeypatch.delenv("CATALYST_TWITTER_SEARCH_SKIP_AT", raising=False)

    called = {"n": 0}

    def fake_search(*a, **k):
        called["n"] += 1
        return []

    monkeypatch.setattr(twitterapi_io, "search_tweets", fake_search)

    candidate = {
        "ticker": "EFGH",
        "tweets": [
            {"id": str(i), "author_handle": "h", "text": "t", "url": "u"}
            for i in range(8)
        ],
    }
    cat_engine._enrich_with_twitter_search([candidate])
    assert called["n"] == 0
