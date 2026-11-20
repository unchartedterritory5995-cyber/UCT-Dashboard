"""The social-sentiment voice tool reads two sources: the curated trader feed and Reddit.

A third per-site tool was removed; these tests pin what is left: the aggregate
answer's shape, its honest empty states, and that the removed tool name is gone
from the registry and from the Compass tool union while its neighbours stay.
"""
from __future__ import annotations

import importlib

import pytest

from api.services import sentiment_aggregator as agg


def _rows(*texts):
    return [{"text": t} for t in texts]


@pytest.fixture
def sources(monkeypatch):
    from api.services import reddit_sentiment, tweet_store

    box = {"rows": [], "reddit": {"error": "not configured"}, "tweet_calls": [], "reddit_calls": []}

    def fake_tweets(sym, hours=24):
        box["tweet_calls"].append((sym, hours))
        return box["rows"]

    def fake_reddit(sym, hours=24, limit=40):
        box["reddit_calls"].append((sym, hours))
        return box["reddit"]

    monkeypatch.setattr(tweet_store, "tweets_for_ticker", fake_tweets)
    monkeypatch.setattr(reddit_sentiment, "sentiment_for_ticker", fake_reddit)
    return box


def test_both_sources_are_asked_once_for_the_last_24_hours(sources):
    sources["rows"] = _rows("NVDA breakout, going long", "buy the squeeze")
    out = agg.aggregate("nvda")
    assert sources["tweet_calls"] == [("NVDA", 24)]
    assert sources["reddit_calls"] == [("NVDA", 24)]
    assert out["ticker"] == "NVDA"


def test_a_bullish_feed_with_reddit_unconfigured_reads_bullish_from_one_source(sources):
    sources["rows"] = _rows("NVDA breakout, going long", "buy the squeeze")
    out = agg.aggregate("NVDA")
    assert out["verdict"] == "bullish"
    assert out["agreement"] == "unanimous_bullish"
    assert out["sources_consulted"] == ["twitter"]
    assert out["sources_failed"] == ["reddit"]
    assert out["twitter"]["count"] == 2
    assert out["twitter"]["bull"] == 4 and out["twitter"]["bear"] == 0


def test_two_sources_that_disagree_are_reported_as_mixed(sources):
    sources["rows"] = _rows("long, buy")
    sources["reddit"] = {"verdict": "bearish", "mentions": 12}
    out = agg.aggregate("TSLA")
    assert out["sources_consulted"] == ["twitter", "reddit"]
    assert out["verdict"] == "mixed"
    assert out["agreement"] == "mixed_across_sources"
    assert out["reddit"] == {"verdict": "bearish", "mentions": 12}


def test_two_bearish_sources_are_unanimous(sources):
    sources["rows"] = _rows("this will dump, short it")
    sources["reddit"] = {"verdict": "bearish"}
    out = agg.aggregate("TSLA")
    assert out["verdict"] == "bearish"
    assert out["agreement"] == "unanimous_bearish"


def test_no_posts_is_said_as_no_chatter_not_as_a_lean(sources):
    out = agg.aggregate("ZZZZ")
    assert out["twitter"] == {"verdict": "no_chatter", "count": 0}
    assert out["verdict"] == "mixed"
    assert out["agreement"] == "neutral_across_sources"


def test_every_source_failing_is_no_data(monkeypatch, sources):
    from api.services import tweet_store

    def boom(sym, hours=24):
        raise RuntimeError("store down")

    monkeypatch.setattr(tweet_store, "tweets_for_ticker", boom)
    out = agg.aggregate("AAPL")
    assert out["verdict"] == "no_data"
    assert out["agreement"] is None
    assert out["sources"] == {"twitter": None, "reddit": {"error": "not configured"}}


def test_the_answer_carries_exactly_the_two_sources(sources):
    sources["rows"] = _rows("long")
    out = agg.aggregate("AAPL")
    assert set(out) == {"ticker", "verdict", "agreement", "sources_consulted",
                        "sources_failed", "twitter", "reddit"}


def test_a_blank_ticker_is_refused_before_any_source_is_asked(sources):
    assert agg.aggregate("  ") == {"error": "ticker required"}
    assert sources["tweet_calls"] == [] and sources["reddit_calls"] == []


REMOVED = "stocktwits_sentiment"
KEPT = ("reddit_sentiment", "get_social_sentiment", "tweets_for_ticker")


def test_the_removed_tool_is_not_registered_and_its_neighbours_are():
    from api.services import voice_tools as vt
    from api.services import voice_tool_impls  # noqa: F401  (registers on import)

    names = set(vt.all_tool_names())
    assert len(names) > 50, "the registry did not load"
    assert REMOVED not in names
    for name in KEPT:
        assert name in names


def test_the_removed_tool_is_not_in_the_compass_union_and_its_neighbours_are():
    from api.services import voice_agents

    union = voice_agents._compass_tool_union()
    assert REMOVED not in union
    for name in KEPT:
        assert name in union


def test_the_removed_module_is_gone_and_its_sibling_still_imports():
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("api.services.stocktwits_sentiment")
    assert importlib.import_module("api.services.reddit_sentiment").sentiment_for_ticker
