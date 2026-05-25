import os
import tempfile
import time

import pytest

from api.services import tweet_store


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


def _tweet(id_, handle, text, created_at=None, **kwargs):
    return {
        "id": id_,
        "author_handle": handle,
        "author_name": kwargs.get("author_name", handle),
        "text": text,
        "created_at": created_at or int(time.time()),
        "url": f"https://twitter.com/{handle}/status/{id_}",
        "reply_count": kwargs.get("reply_count", 0),
        "like_count": kwargs.get("like_count", 0),
        "retweet_count": kwargs.get("retweet_count", 0),
        "is_retweet": kwargs.get("is_retweet", 0),
        "raw_json": kwargs.get("raw_json", "{}"),
    }


def test_upsert_is_idempotent(store):
    store.upsert_tweet(_tweet("100", "DeItaone", "$AAPL beats"), ["AAPL"])
    store.upsert_tweet(_tweet("100", "DeItaone", "$AAPL beats"), ["AAPL"])
    assert store.count_tweets() == 1
    assert store.count_ticker_links() == 1


def test_tweet_with_multiple_tickers(store):
    store.upsert_tweet(_tweet("1", "DeItaone", "$AAPL $MSFT both up"), ["AAPL", "MSFT"])
    by_aapl = store.tweets_for_ticker("AAPL", hours=24)
    assert len(by_aapl) == 1
    by_msft = store.tweets_for_ticker("MSFT", hours=24)
    assert len(by_msft) == 1


def test_tweets_for_ticker_respects_hours_window(store):
    now = int(time.time())
    store.upsert_tweet(
        _tweet("old", "DeItaone", "$AAPL old", created_at=now - 48 * 3600), ["AAPL"]
    )
    store.upsert_tweet(
        _tweet("new", "DeItaone", "$AAPL new", created_at=now - 1 * 3600), ["AAPL"]
    )
    assert len(store.tweets_for_ticker("AAPL", hours=24)) == 1
    assert len(store.tweets_for_ticker("AAPL", hours=72)) == 2


def test_tweets_for_ticker_returns_newest_first(store):
    now = int(time.time())
    store.upsert_tweet(
        _tweet("a", "DeItaone", "$AAPL older", created_at=now - 7200), ["AAPL"]
    )
    store.upsert_tweet(
        _tweet("b", "DeItaone", "$AAPL newer", created_at=now - 60), ["AAPL"]
    )
    rows = store.tweets_for_ticker("AAPL", hours=24)
    assert rows[0]["id"] == "b"
    assert rows[1]["id"] == "a"


def test_tape_groups_by_ticker(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("1", "DeItaone", "$ABBV phase 3", created_at=now - 120), ["ABBV"])
    store.upsert_tweet(_tweet("2", "Benzinga", "$ABBV more news", created_at=now - 60), ["ABBV"])
    store.upsert_tweet(_tweet("3", "Benzinga", "$XYZ halt", created_at=now - 30), ["XYZ"])
    tape = store.tape(hours=12, limit=10)
    by_ticker = {r["ticker"]: r for r in tape}
    assert by_ticker["ABBV"]["n_tweets"] == 2
    assert by_ticker["XYZ"]["n_tweets"] == 1
    # Tape ordered by latest_at desc — XYZ (30s ago) before ABBV (60s ago latest)
    assert tape[0]["ticker"] == "XYZ"


def test_batch_counts_returns_zero_for_missing(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("1", "DeItaone", "$AAPL", created_at=now - 60), ["AAPL"])
    counts = store.batch_counts(["AAPL", "MSFT", "NVDA"], hours=24)
    assert counts == {"AAPL": 1, "MSFT": 0, "NVDA": 0}


def test_retention_sweep_deletes_old_and_cascades(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("old", "DeItaone", "$AAPL", created_at=now - 10 * 86400), ["AAPL"])
    store.upsert_tweet(_tweet("new", "DeItaone", "$AAPL", created_at=now - 1 * 86400), ["AAPL"])
    deleted = store.delete_tweets_older_than(days=7)
    assert deleted == 1
    assert store.count_tweets() == 1
    assert store.count_ticker_links() == 1  # cascade


def test_account_crud(store):
    store.add_account("DeItaone", display_name="Walter Bloomberg", added_by_user_id=1)
    accounts = store.list_accounts()
    assert len(accounts) == 1
    assert accounts[0]["handle"] == "DeItaone"
    assert accounts[0]["enabled"] == 1

    store.set_account_enabled("DeItaone", False)
    assert store.list_accounts(enabled_only=True) == []
    assert len(store.list_accounts(enabled_only=False)) == 1


def test_poll_state_roundtrip(store):
    store.add_account("DeItaone")
    store.update_poll_state("DeItaone", last_seen_tweet_id="200", status="ok", tweets_seen=5)
    state = store.get_poll_state("DeItaone")
    assert state["last_seen_tweet_id"] == "200"
    assert state["last_poll_status"] == "ok"
    assert state["total_tweets_seen"] == 5
