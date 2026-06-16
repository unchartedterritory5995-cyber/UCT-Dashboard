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


# ---------------------------------------------------------------------------
# TASK B1 — free per-mover Google News "why" fetch + _iso_to_unix
# ---------------------------------------------------------------------------

def test_iso_to_unix_parses_iso_rfc822_and_garbage():
    from api.services.catalyst import engine as cat_engine

    # ISO 8601
    iso_ts = cat_engine._iso_to_unix("2025-06-11T13:20:00+00:00")
    assert isinstance(iso_ts, int) and iso_ts > 0
    # ISO with trailing Z
    z_ts = cat_engine._iso_to_unix("2025-06-11T13:20:00Z")
    assert z_ts == iso_ts
    # RFC-822 (Google News style) — same instant as the ISO above
    rfc_ts = cat_engine._iso_to_unix("Wed, 11 Jun 2025 13:20:00 GMT")
    assert rfc_ts == iso_ts
    # garbage / empty / None → None
    assert cat_engine._iso_to_unix("not a date") is None
    assert cat_engine._iso_to_unix("") is None
    assert cat_engine._iso_to_unix(None) is None


def test_enrich_with_ticker_news_appends_to_thin_candidate(monkeypatch):
    from api.services.catalyst import engine as cat_engine
    from api.services import news_search

    monkeypatch.setenv("CATALYST_NEWS_FETCH_ENABLED", "1")

    rfc822 = "Wed, 11 Jun 2025 13:20:00 GMT"
    iso = "2025-06-12T09:00:00+00:00"

    calls = {"n": 0, "queries": []}

    def fake_search(query, count=5):
        calls["n"] += 1
        calls["queries"].append(query)
        return {
            "query": query,
            "count": 2,
            "headlines": [
                {"title": "ABCD beats earnings", "source": "Reuters",
                 "published": rfc822, "url": "https://news/abcd-1"},
                {"title": "ABCD lands contract", "source": "Bloomberg",
                 "published": iso, "url": "https://news/abcd-2"},
            ],
        }

    monkeypatch.setattr(news_search, "search_news", fake_search)

    thin = {"ticker": "ABCD"}  # no rss, no tweets, no earnings_meta → thin
    cat_engine._enrich_with_ticker_news([thin])

    # search ran with "{ticker} stock" (NOT a cashtag)
    assert calls["n"] == 1
    assert calls["queries"][0] == "ABCD stock"

    rss = thin.get("rss") or []
    assert len(rss) == 2
    assert thin["rss_headline_count"] == 2
    assert all(it["source"] == "Google News" for it in rss)

    by_title = {it["title"]: it for it in rss}
    # RFC-822 result parsed to the same int as the ISO equivalent
    expected_ts = cat_engine._iso_to_unix(rfc822)
    assert isinstance(expected_ts, int) and expected_ts > 0
    assert by_title["ABCD beats earnings"]["time_published"] == expected_ts
    assert by_title["ABCD lands contract"]["time_published"] == cat_engine._iso_to_unix(iso)


def test_enrich_with_ticker_news_skips_non_thin_candidate(monkeypatch):
    from api.services.catalyst import engine as cat_engine
    from api.services import news_search

    monkeypatch.setenv("CATALYST_NEWS_FETCH_ENABLED", "1")

    called = {"n": 0}

    def fake_search(query, count=5):
        called["n"] += 1
        return {"headlines": []}

    monkeypatch.setattr(news_search, "search_news", fake_search)

    # Has 3 existing rss headlines → NOT thin → must be skipped
    not_thin = {"ticker": "WXYZ", "rss_headline_count": 3,
                "rss": [{"title": "x"}, {"title": "y"}, {"title": "z"}]}
    cat_engine._enrich_with_ticker_news([not_thin])

    assert called["n"] == 0
    assert not_thin["rss_headline_count"] == 3


# ---------------------------------------------------------------------------
# TASK B2 — Perplexity finance-news discovery query
# ---------------------------------------------------------------------------

def test_perplexity_finance_discovery_query_issued_and_extracted(monkeypatch):
    """The finance-news variant is issued (captured) AND its ticker surfaces
    with source 'Perplexity (finance news)'. The stub returns a recognizable
    $TICKER ONLY for the finance query (isolated via the unique phrase)."""
    from api.services.catalyst import sources as cat_sources
    from api.services import perplexity_search

    monkeypatch.setenv("CATALYST_PERPLEXITY_ENABLED", "1")
    monkeypatch.setenv("CATALYST_PERPLEXITY_FINANCE_DISCOVERY", "1")

    captured = {"queries": []}

    def fake_web_search(query, max_tokens=400, system=None, mode="fast",
                        recency=None, domain_pack="general", domains=None):
        captured["queries"].append(query)
        if "swing traders and news traders" in query:
            return {"answer": "$FINX — upgraded by a major bank today.",
                    "citations": ["https://example.com/finx"]}
        return {"answer": "", "citations": []}

    monkeypatch.setattr(perplexity_search, "web_search", fake_web_search)

    out = cat_sources._pull_perplexity_discovery()

    # (approach noted in report) Finance query WAS issued
    assert any("swing traders and news traders" in q for q in captured["queries"])
    # And its ticker surfaced with the finance-news source label
    assert "FINX" in out
    sources_seen = {item["source"] for item in out["FINX"]}
    assert "Perplexity (finance news)" in sources_seen


# ---------------------------------------------------------------------------
# TASK B3 — swing/news-trader prompt alignment in _enrich_with_perplexity
# ---------------------------------------------------------------------------

def test_enrich_with_perplexity_prompt_includes_swing_catalysts(monkeypatch):
    from api.services.catalyst import engine as cat_engine
    from api.services import perplexity_search

    monkeypatch.setenv("CATALYST_PERPLEXITY_ENABLED", "1")

    captured = {"query": None}

    def fake_web_search(query, max_tokens=300, system=None, mode="fast",
                        recency=None, domain_pack="general", domains=None):
        captured["query"] = query
        return {"answer": "Some catalyst.", "citations": ["https://c"]}

    monkeypatch.setattr(perplexity_search, "web_search", fake_web_search)

    # Zero-signal candidate → triggers the paid fallback prompt
    c = {"ticker": "ZZZZ", "gap_pct": 8.0}
    cat_engine._enrich_with_perplexity([c])

    q = captured["query"]
    assert q is not None
    assert "guidance" in q
    assert "product launches" in q
    # Original "no clear catalyst" line preserved
    assert "no clear catalyst exists, say so plainly" in q
