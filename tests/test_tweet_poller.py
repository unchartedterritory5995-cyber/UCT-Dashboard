import contextlib
import os
import tempfile
import time
from unittest.mock import patch

import pytest

from api.services import tweet_store, tweet_poller, twitterapi_io


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        tweet_store.add_account("DeItaone")
        yield tweet_store


def _tw(id_, text, handle="DeItaone"):
    return {
        "id": id_, "author_handle": handle, "author_name": handle,
        "text": text, "created_at": int(time.time()),
        "url": f"https://x.com/{handle}/status/{id_}",
        "reply_count": 0, "like_count": 0, "retweet_count": 0,
        "is_retweet": 0, "raw_json": "{}",
    }


def test_poll_account_stores_tweets_and_tickers(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[_tw("1", "$AAPL big move"), _tw("2", "$MSFT $NVDA")]):
        tweet_poller.poll_account("DeItaone")
    assert store.count_tweets() == 2
    with contextlib.closing(store._connect()) as c:
        tickers = {r["ticker"] for r in c.execute("SELECT ticker FROM tweet_tickers")}
    assert tickers == {"AAPL", "MSFT", "NVDA"}


def test_poll_account_advances_since_id(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[_tw("100", "$AAPL"), _tw("99", "$AAPL")]):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_seen_tweet_id"] == "100"  # max id (newest)
    assert state["last_poll_status"] == "ok"


def test_poll_account_passes_since_id_on_next_poll(store):
    with patch.object(twitterapi_io, "get_user_last_tweets") as mock_get:
        mock_get.return_value = [_tw("50", "$AAPL")]
        tweet_poller.poll_account("DeItaone")
        mock_get.return_value = []
        tweet_poller.poll_account("DeItaone")
    # Second call should have passed since_id="50"
    _, kwargs = mock_get.call_args_list[1]
    assert kwargs.get("since_id") == "50"


def test_poll_account_records_auth_error(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=twitterapi_io.TwitterApiAuthError("bad key")):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "auth_error"
    assert "bad key" in state["last_error"]


def test_poll_account_records_payment_required(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=twitterapi_io.TwitterApiPaymentRequired("no credits")):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "out_of_credits"


def test_poll_account_records_rate_limited(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=twitterapi_io.TwitterApiRateLimited("slow down")):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "rate_limited"


def test_poll_account_records_unexpected_error(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=RuntimeError("boom")):
        # Should not raise — error is captured
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "error"
    assert "boom" in state["last_error"]


def test_poll_all_accounts_skips_disabled(store):
    store.add_account("Benzinga")
    store.set_account_enabled("Benzinga", False)
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[]) as mock_get:
        tweet_poller.poll_all_accounts()
    # Only DeItaone (enabled) was polled
    handles = [c.args[0] for c in mock_get.call_args_list]
    assert handles == ["DeItaone"]
