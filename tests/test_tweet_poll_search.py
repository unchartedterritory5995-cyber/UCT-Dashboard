"""Roster-search polling (TWEET_POLL_MODE = timeline | shadow | search).

Why it exists: /twitter/user/last_tweets ignores since_id (measured 2026-11-07),
so the timeline poller billed 20 tweets per account per tick. These tests pin
the replacement's contract: query parity filters, pagination + truncation,
cursor that only moves on success, per-account routing, and that shadow mode
never changes what members see.
"""
import os
import tempfile
import time
from unittest.mock import MagicMock, patch

import pytest

from api.services import tweet_poller, tweet_store, twitterapi_io


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "test-key-xyz")


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        for h in ("DeItaone", "FirstSquawk"):
            tweet_store.add_account(h)
        yield tweet_store


def _resp(status, body):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    return r


def _raw(id_, handle, text="$AAPL headline"):
    return {"id": id_, "text": text, "createdAt": "Mon Jan 01 12:00:00 +0000 2026",
            "author": {"userName": handle, "name": handle}}


def _tw(id_, handle):
    return {"id": id_, "author_handle": handle, "author_name": handle, "text": "$AAPL x",
            "created_at": int(time.time()), "url": f"https://x.com/{handle}/status/{id_}",
            "reply_count": 0, "like_count": 0, "retweet_count": 0, "is_retweet": 0,
            "raw_json": "{}"}


# ---- query building -----------------------------------------------------------

def test_query_carries_both_parity_filters_and_the_cursor():
    (q,) = twitterapi_io.build_roster_queries(["DeItaone", "FirstSquawk"], since_id="123")
    assert q.startswith("(from:DeItaone OR from:FirstSquawk)")
    assert "-filter:replies" in q            # the timeline never returned replies
    assert "include:nativeretweets" in q     # the timeline did return retweets
    assert q.endswith(" since_id:123")


def test_query_uses_since_time_without_a_cursor():
    (q,) = twitterapi_io.build_roster_queries(["a"], since_unix=1700000000)
    assert q.endswith(" since_time:1700000000") and "since_id" not in q


def test_query_refuses_an_unbounded_window():
    with pytest.raises(ValueError):
        twitterapi_io.build_roster_queries(["a"])


def test_long_roster_splits_under_the_cap_and_loses_no_handle(monkeypatch):
    monkeypatch.setattr(twitterapi_io, "_SEARCH_QUERY_MAX_CHARS", 120)
    handles = [f"account_{i:02d}" for i in range(12)]
    qs = twitterapi_io.build_roster_queries(handles, since_id="9")
    assert len(qs) > 1                                  # control: the split happened
    assert all(len(q) <= 120 for q in qs)
    joined = " ".join(qs)
    assert all(f"from:{h}" in joined for h in handles)


# ---- fetching -------------------------------------------------------------------

def test_paginates_and_dedupes_newest_first():
    pages = [
        _resp(200, {"tweets": [_raw("105", "DeItaone"), _raw("104", "FirstSquawk")],
                    "has_next_page": True, "next_cursor": "c1"}),
        _resp(200, {"tweets": [_raw("104", "FirstSquawk"), _raw("103", "DeItaone")],
                    "has_next_page": False}),
    ]
    with patch("requests.get", side_effect=pages) as g:
        tweets, complete = twitterapi_io.search_roster_since(["DeItaone", "FirstSquawk"], since_id="100")
    assert [t["id"] for t in tweets] == ["105", "104", "103"]
    assert complete is True
    assert g.call_args_list[1].kwargs["params"]["cursor"] == "c1"


def test_page_cap_reports_incomplete():
    page = _resp(200, {"tweets": [_raw("5", "DeItaone")], "has_next_page": True, "next_cursor": "c"})
    with patch("requests.get", return_value=page) as g:
        _, complete = twitterapi_io.search_roster_since(["DeItaone"], since_id="1", max_pages=3)
    assert complete is False and g.call_count == 3


@pytest.mark.parametrize("status,exc", [
    (401, twitterapi_io.TwitterApiAuthError),
    (402, twitterapi_io.TwitterApiPaymentRequired),
    (429, twitterapi_io.TwitterApiRateLimited),
    (503, twitterapi_io.TwitterApiTransientError),
])
def test_errors_raise_the_shared_taxonomy(status, exc):
    with patch("requests.get", return_value=_resp(status, {})):
        with pytest.raises(exc):
            twitterapi_io.search_roster_since(["DeItaone"], since_id="1")


# ---- modes ------------------------------------------------------------------------

def test_unknown_mode_falls_back_to_timeline(monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "serch")
    assert tweet_poller.poll_mode() == "timeline"
    monkeypatch.setenv("TWEET_POLL_MODE", "Search")
    assert tweet_poller.poll_mode() == "search"     # control: a real value is honored


def test_search_mode_routes_by_author_and_advances_cursor(store, monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "search")
    found = [_tw("205", "firstsquawk"), _tw("204", "DeItaone")]  # API casing differs
    with patch.object(twitterapi_io, "search_roster_since", return_value=(found, True)) as s, \
         patch.object(twitterapi_io, "get_user_last_tweets") as timeline:
        out = tweet_poller.poll_all_accounts()
    assert timeline.call_count == 0                  # one roster call, no per-account calls
    assert s.call_count == 1
    assert {o["handle"]: o["stored"] for o in out} == {"DeItaone": 1, "FirstSquawk": 1}
    assert store.count_tweets() == 2
    assert store.get_poll_state("FirstSquawk")["last_seen_tweet_id"] == "205"
    assert store.get_search_state("roster_search")["since_id"] == "205"


def test_search_mode_uses_stored_cursor_next_tick(store, monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "search")
    with patch.object(twitterapi_io, "search_roster_since",
                      side_effect=[([_tw("300", "DeItaone")], True), ([], True)]) as s:
        tweet_poller.poll_all_accounts()
        tweet_poller.poll_all_accounts()
    first, second = s.call_args_list
    assert first.kwargs["since_id"] is None and first.kwargs["since_unix"]  # bounded first run
    assert second.kwargs["since_id"] == "300"


def test_failed_search_never_moves_the_cursor(store, monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "search")
    store.update_search_state("roster_search", status="ok", since_id="500")
    with patch.object(twitterapi_io, "search_roster_since",
                      side_effect=twitterapi_io.TwitterApiPaymentRequired("x")):
        out = tweet_poller.poll_all_accounts()
    assert {o["status"] for o in out} == {"out_of_credits"}
    assert store.get_search_state("roster_search")["since_id"] == "500"
    assert store.get_poll_state("DeItaone")["last_poll_status"] == "out_of_credits"


def test_shadow_mode_stores_only_timeline_tweets_and_records_search(store, monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "shadow")
    with patch.object(twitterapi_io, "search_roster_since",
                      return_value=([_tw("900", "DeItaone"), _tw("901", "DeItaone")], True)), \
         patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=lambda h, since_id=None: [_tw("900", "DeItaone")] if h == "DeItaone" else []):
        tweet_poller.poll_all_accounts()
    # Members see exactly the timeline's result; the search only RECORDED.
    assert store.count_tweets() == 1
    rep = store.shadow_report(0, settle_seconds=-60)
    assert rep["both"] == 1 and rep["only_search"] == 1 and rep["only_timeline"] == 0


def test_shadow_failure_never_stops_the_timeline(store, monkeypatch):
    monkeypatch.setenv("TWEET_POLL_MODE", "shadow")
    with patch.object(twitterapi_io, "search_roster_since", side_effect=RuntimeError("boom")), \
         patch.object(twitterapi_io, "get_user_last_tweets", return_value=[_tw("7", "DeItaone")]):
        out = tweet_poller.poll_all_accounts()
    assert len(out) == 2 and store.count_tweets() == 1
    assert store.get_search_state("roster_shadow")["last_status"] == "error"


def test_timeline_mode_never_searches(store, monkeypatch):
    monkeypatch.delenv("TWEET_POLL_MODE", raising=False)
    with patch.object(twitterapi_io, "search_roster_since") as s, \
         patch.object(twitterapi_io, "get_user_last_tweets", return_value=[]):
        tweet_poller.poll_all_accounts()
    assert s.call_count == 0
