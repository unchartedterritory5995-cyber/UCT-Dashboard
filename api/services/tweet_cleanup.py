"""Nightly retention sweep. Called from the APScheduler 3am ET job."""
import logging
import os

from api.services import tweet_store, twitterapi_io
from api.services.catalyst import store as catalyst_store

logger = logging.getLogger(__name__)

# X's Developer Agreement requires removing a tweet within 24h of it being
# deleted, made protected, or its account suspended on X — materially
# tighter than the age sweep below (PACKET-S CP4, RG-21 §1d). A tweet
# ingested on day 1 and deleted on X on day 2 would otherwise sit in
# tweets.db for up to 6 more days under the age sweep alone.
_DELETION_SYNC_WINDOW_HOURS = 24


def _run_deletion_sync() -> int:
    """Select tweets ingested/posted within X's 24h deletion-sync window,
    batch-check them against TwitterAPI.io, and delete whichever ids no
    longer resolve. Reuses tweet_store.feed() (a query against
    tweets.created_at — no new table) rather than adding a second selection
    function. Never raises: a TwitterAPI.io outage here must not block the
    age sweep or the raw_signals redaction that follow it in run_cleanup()."""
    try:
        recent = tweet_store.feed(hours=_DELETION_SYNC_WINDOW_HOURS, limit=5000)
    except Exception:
        logger.exception("[tweet_cleanup] deletion-sync: could not read recent tweets")
        return 0

    ids = [t["id"] for t in recent if t.get("id")]
    if not ids:
        return 0

    try:
        gone = twitterapi_io.find_deleted_tweet_ids(ids)
    except twitterapi_io.TwitterApiError as e:
        logger.warning("[tweet_cleanup] deletion-sync: TwitterAPI.io check failed: %s", e)
        return 0

    if not gone:
        return 0
    return tweet_store.delete_tweets_by_ids(list(gone))


def run_cleanup() -> int:
    days = int(os.environ.get("TWEET_RETENTION_DAYS", "7"))

    deleted_by_sync = _run_deletion_sync()
    if deleted_by_sync:
        logger.info("[tweet_cleanup] deletion-sync removed %d tweet(s) no longer on X "
                    "(within the %dh window)", deleted_by_sync, _DELETION_SYNC_WINDOW_HOURS)

    deleted = tweet_store.delete_tweets_older_than(days=days)
    logger.info("[tweet_cleanup] deleted %d tweets older than %d days", deleted, days)

    # PACKET-S CP5 (RG-21 §1e): redact stale vendor text out of
    # catalysts.raw_signals using the SAME TWEET_RETENTION_DAYS window, so the
    # tweet's own table and its echo inside a catalyst row cannot drift apart
    # the way RG-21 found they already had. Never allowed to affect the
    # function's return value (age-sweep count) or block on failure.
    try:
        redacted = catalyst_store.redact_stale_raw_signals(days=days)
        if redacted:
            logger.info("[tweet_cleanup] redacted vendor text in %d catalysts.raw_signals "
                        "row(s) older than %d days", redacted, days)
    except Exception:
        logger.exception("[tweet_cleanup] catalyst raw_signals redaction failed")

    return deleted
