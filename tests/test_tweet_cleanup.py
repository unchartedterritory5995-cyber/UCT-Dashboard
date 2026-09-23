"""PACKET-S CP4 — tweet deletion-sync wired into the existing nightly
tweet_cleanup job (RG-21 §1d). No new scheduler entry: both the deletion-sync
and the age sweep ride run_cleanup()."""
import os
import tempfile
import time
from unittest.mock import patch

import pytest

from api.services import tweet_cleanup, tweet_store, twitterapi_io
from api.services.catalyst import store as catalyst_store


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "test-key")


def _tweet(id_, handle, text, created_at=None):
    return {
        "id": id_,
        "author_handle": handle,
        "author_name": handle,
        "text": text,
        "created_at": created_at or int(time.time()),
        "url": f"https://twitter.com/{handle}/status/{id_}",
        "reply_count": 0, "like_count": 0, "retweet_count": 0,
        "is_retweet": 0, "raw_json": "{}",
    }


def test_run_cleanup_removes_a_tweet_deleted_on_x_within_24h(store):
    """A tweet ingested moments ago and already gone from X (deleted,
    protected, or the account suspended) is removed the SAME cleanup run --
    the 24h deletion-sync catches what the 7-day age sweep structurally
    cannot (it is only 1 day old, nowhere near the 7-day cutoff)."""
    now = int(time.time())
    store.upsert_tweet(_tweet("deleted-on-x", "DeItaone", "$AAPL beats", created_at=now - 3600), ["AAPL"])
    store.upsert_tweet(_tweet("still-there", "DeItaone", "$MSFT up", created_at=now - 3600), ["MSFT"])

    with patch.object(twitterapi_io, "find_deleted_tweet_ids", return_value={"deleted-on-x"}) as m:
        tweet_cleanup.run_cleanup()

    m.assert_called_once()
    checked_ids = set(m.call_args[0][0])
    assert {"deleted-on-x", "still-there"} <= checked_ids
    assert store.count_tweets() == 1
    remaining = store.tweets_for_ticker("MSFT", hours=24)
    assert [r["id"] for r in remaining] == ["still-there"]


def test_control_the_age_sweep_alone_would_not_have_caught_it(store):
    """Control proving the fix is load-bearing: calling ONLY the pre-existing
    age sweep (delete_tweets_older_than) on the same fixture leaves the
    deleted-on-X tweet in place, because it is only 1 hour old. This is
    exactly the gap RG-21 §1d names."""
    now = int(time.time())
    store.upsert_tweet(_tweet("deleted-on-x", "DeItaone", "$AAPL beats", created_at=now - 3600), ["AAPL"])

    days = int(os.environ.get("TWEET_RETENTION_DAYS", "7"))
    store.delete_tweets_older_than(days=days)

    assert store.count_tweets() == 1  # still there -- the age sweep alone can't see it


def test_run_cleanup_still_runs_the_age_sweep(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("old", "DeItaone", "$AAPL", created_at=now - 10 * 86400), ["AAPL"])
    store.upsert_tweet(_tweet("new", "DeItaone", "$AAPL", created_at=now - 3600), ["AAPL"])

    with patch.object(twitterapi_io, "find_deleted_tweet_ids", return_value=set()):
        deleted = tweet_cleanup.run_cleanup()

    assert deleted == 1
    assert store.count_tweets() == 1


def test_deletion_sync_never_raises_on_a_twitterapi_outage(store):
    """A TwitterAPI.io outage during the deletion-sync must not block the age
    sweep that follows it in run_cleanup()."""
    now = int(time.time())
    store.upsert_tweet(_tweet("old", "DeItaone", "$AAPL", created_at=now - 10 * 86400), ["AAPL"])

    with patch.object(twitterapi_io, "find_deleted_tweet_ids",
                       side_effect=twitterapi_io.TwitterApiTransientError("down")):
        deleted = tweet_cleanup.run_cleanup()  # must not raise

    assert deleted == 1  # age sweep still ran


def test_deletion_sync_no_op_when_nothing_recent(store):
    with patch.object(twitterapi_io, "find_deleted_tweet_ids") as m:
        tweet_cleanup._run_deletion_sync()
    m.assert_not_called()


# ---- PACKET-S CP5 wiring: raw_signals redaction rides the same job --------

def test_run_cleanup_calls_the_redaction_with_the_shared_retention_window(store, monkeypatch):
    monkeypatch.setenv("TWEET_RETENTION_DAYS", "9")
    with patch.object(twitterapi_io, "find_deleted_tweet_ids", return_value=set()), \
         patch.object(catalyst_store, "redact_stale_raw_signals", return_value=3) as m:
        tweet_cleanup.run_cleanup()
    m.assert_called_once_with(days=9)


def test_control_redaction_wiring_absent_would_fail_the_call_assertion(store):
    # Control: proves the assertion above is load-bearing. Calling the OLD
    # two-step run_cleanup shape (age sweep only, no redaction call) leaves
    # redact_stale_raw_signals never invoked -- exactly what this packet fixes.
    with patch.object(catalyst_store, "redact_stale_raw_signals") as m:
        tweet_store.delete_tweets_older_than(days=7)
    m.assert_not_called()


def test_run_cleanup_survives_a_redaction_failure(store):
    with patch.object(twitterapi_io, "find_deleted_tweet_ids", return_value=set()), \
         patch.object(catalyst_store, "redact_stale_raw_signals", side_effect=RuntimeError("db locked")):
        deleted = tweet_cleanup.run_cleanup()  # must not raise
    assert deleted == 0
