"""Nightly retention sweep. Called from the APScheduler 3am ET job."""
import logging
import os

from api.services import tweet_store

logger = logging.getLogger(__name__)


def run_cleanup() -> int:
    days = int(os.environ.get("TWEET_RETENTION_DAYS", "7"))
    deleted = tweet_store.delete_tweets_older_than(days=days)
    logger.info("[tweet_cleanup] deleted %d tweets older than %d days", deleted, days)
    return deleted
