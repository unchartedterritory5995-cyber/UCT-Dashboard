"""Orchestrates polling each enabled account, extracts tickers, persists tweets.

Called from APScheduler jobs in api/main.py. Single-threaded per cron tick,
so concurrent polling is not a concern. The scheduler lock in api/main.py
already prevents multiple pods from firing the same job.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import tweet_store, twitterapi_io
from api.services.tweet_ticker_extract import extract_tickers

logger = logging.getLogger(__name__)


def poll_account(handle: str) -> dict:
    """Poll one account, return a summary dict. Never raises."""
    state = tweet_store.get_poll_state(handle) or {}
    since_id = state.get("last_seen_tweet_id")
    summary = {"handle": handle, "stored": 0, "status": "ok"}

    try:
        tweets = twitterapi_io.get_user_last_tweets(handle, since_id=since_id)
    except twitterapi_io.TwitterApiAuthError as e:
        tweet_store.update_poll_state(handle, status="auth_error", error=str(e)[:300])
        logger.error("[tweet_poll] %s auth_error: %s", handle, e)
        summary["status"] = "auth_error"
        return summary
    except twitterapi_io.TwitterApiPaymentRequired as e:
        tweet_store.update_poll_state(handle, status="out_of_credits", error=str(e)[:300])
        logger.error("[tweet_poll] %s out_of_credits: %s", handle, e)
        summary["status"] = "out_of_credits"
        return summary
    except twitterapi_io.TwitterApiRateLimited as e:
        tweet_store.update_poll_state(handle, status="rate_limited", error=str(e)[:300])
        logger.warning("[tweet_poll] %s rate_limited: %s", handle, e)
        summary["status"] = "rate_limited"
        return summary
    except twitterapi_io.TwitterApiError as e:
        tweet_store.update_poll_state(handle, status="error", error=str(e)[:300])
        logger.warning("[tweet_poll] %s error: %s", handle, e)
        summary["status"] = "error"
        return summary
    except Exception as e:
        # Defensive - never let one bad account kill the whole job
        tweet_store.update_poll_state(handle, status="error", error=f"unexpected: {e}"[:300])
        logger.exception("[tweet_poll] %s unexpected", handle)
        summary["status"] = "error"
        return summary

    newest_id: Optional[str] = since_id
    for tweet in tweets:
        try:
            tickers = extract_tickers(tweet.get("text", ""))
            tweet_store.upsert_tweet(tweet, tickers)
            summary["stored"] += 1
            # Track the lexicographically/numerically largest id (Twitter ids
            # are numerically increasing; str compare for safety on bigints)
            tid = str(tweet.get("id"))
            if newest_id is None \
                    or len(tid) > len(newest_id) \
                    or (len(tid) == len(newest_id) and tid > newest_id):
                newest_id = tid
        except Exception:
            logger.exception("[tweet_poll] %s tweet %s failed to store",
                             handle, tweet.get("id"))

    tweet_store.update_poll_state(
        handle,
        last_seen_tweet_id=newest_id,
        status="ok",
        tweets_seen=summary["stored"],
    )
    logger.info("[tweet_poll] %s stored=%d newest=%s",
                handle, summary["stored"], newest_id)
    return summary


def poll_all_accounts() -> list[dict]:
    accounts = tweet_store.list_accounts(enabled_only=True)
    return [poll_account(a["handle"]) for a in accounts]
