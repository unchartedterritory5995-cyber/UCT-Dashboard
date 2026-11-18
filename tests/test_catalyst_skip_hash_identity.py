"""Catalyst skip-if-stable hash: content identity, not raw dicts (2026-11-11 AI-spend review).

Measured on prod 2026-11-11: 472 Opus syntheses, 21 skips. The top names re-synthesized on
every run because (a) Perplexity items carry `time_published=time.time()` stamped at
injection and (b) the Twitter "Latest" search refills with new retail posts each call.
"""
import os
import tempfile
from unittest.mock import patch

import pytest

from api.services.catalyst import store, synthesize
from api.services.catalyst.synthesize import compute_signals_hash as H


def _c(**kw):
    base = {"ticker": "NVDA", "price": 173.7, "gap_pct": 3.4, "vol_x": 2.0,
            "tweets": [], "rss": [], "earnings_meta": None, "scanner_setup": None}
    base.update(kw)
    return base


def _rss(src, title, url="https://x/1", t=1000):
    return {"source": src, "title": title, "url": url, "time_published": t}


def _tw(i, via=None):
    d = {"id": str(i), "author_handle": "h", "text": f"t{i}", "url": f"u{i}", "created_at": 1}
    if via:
        d["via"] = via
    return d


def test_an_injection_timestamp_alone_does_not_change_the_hash():
    a = _c(rss=[_rss("Perplexity (earnings)", "guide raised", t=1000)])
    b = _c(rss=[_rss("Perplexity (earnings)", "guide raised", t=2000)])
    assert H(a) == H(b)


def test_a_new_headline_still_changes_the_hash():
    a = _c(rss=[_rss("Reuters", "old")])
    b = _c(rss=[_rss("Reuters", "old"), _rss("Reuters", "FDA approves", url="https://x/2")])
    assert H(a) != H(b)
    # control: the same headline with a different title is a different item
    assert H(a) != H(_c(rss=[_rss("Reuters", "reworded")]))


def test_a_regenerated_market_wide_blurb_counts_by_presence_only():
    a = _c(rss=[_rss("Perplexity (discovery)", "$CRWV beat ...", t=1)])
    b = _c(rss=[_rss("Perplexity (discovery)", "$CRWV shares surged ...", url="https://y", t=2)])
    assert H(a) == H(b)
    assert H(a) != H(_c())          # appearing / disappearing still counts


def test_rss_order_is_irrelevant():
    x, y = _rss("Reuters", "a", url="1"), _rss("Bloomberg", "b", url="2")
    assert H(_c(rss=[x, y])) == H(_c(rss=[y, x]))


def test_search_tweet_churn_does_not_change_the_hash_but_a_curated_tweet_does():
    a = _c(tweets=[_tw(1)] + [_tw(100 + i, "search") for i in range(19)])
    b = _c(tweets=[_tw(1)] + [_tw(500 + i, "search") for i in range(19)])
    assert H(a) == H(b)
    c = _c(tweets=[_tw(1), _tw(2)] + [_tw(500 + i, "search") for i in range(19)])
    assert H(a) != H(c)


def test_search_volume_moving_a_band_changes_the_hash():
    a = _c(tweets=[_tw(i, "search") for i in range(3)])
    b = _c(tweets=[_tw(i, "search") for i in range(8)])
    assert H(a) != H(b)


def test_the_twitter_search_marks_what_it_merges(monkeypatch):
    from api.services.catalyst import engine as cat_engine
    from api.services import twitterapi_io

    monkeypatch.setenv("CATALYST_TWITTER_SEARCH_ENABLED", "1")
    monkeypatch.setattr(twitterapi_io, "search_tweets", lambda **k: [
        {"id": "s1", "author_handle": "r", "text": "x", "url": "u", "created_at": 1}])
    cand = {"ticker": "ABCD", "tweets": [_tw(1)]}
    cat_engine._enrich_with_twitter_search([cand])
    vias = {t["id"]: t.get("via") for t in cand["tweets"]}
    assert vias == {"1": None, "s1": synthesize.SEARCH_TWEET_VIA}


@pytest.fixture
def db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def test_a_rerun_with_only_a_fresh_stamp_reuses_the_thesis(db):
    first = _c(rss=[_rss("Perplexity (earnings)", "guide raised", t=1000)])
    store.upsert_catalyst({
        "market_date": "2026-11-11", "ticker": "NVDA", "rank": 1, "score": 50.0,
        "tag": "News", "price": 173.7, "gap_pct": 3.4, "vol_x": 2.0,
        "market_cap": 1, "sector": "Tech", "thesis_text": "Cached thesis",
        "thesis_model": "claude-opus-5-5", "thesis_at": 1, "thesis_sources": "[]",
        "signals_hash": H(first), "catalyst_at": None, "raw_signals": "{}",
    })
    again = _c(rss=[_rss("Perplexity (earnings)", "guide raised", t=99999)])
    with patch("api.services.catalyst.synthesize._call_anthropic") as call:
        out = synthesize.synthesize_ticker(again, "2026-11-11")
    assert call.call_count == 0
    assert out["was_cached"] is True and out["thesis_text"] == "Cached thesis"
