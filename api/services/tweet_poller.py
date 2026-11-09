"""Orchestrates polling each enabled account, extracts tickers, persists tweets.

Called from APScheduler jobs in api/main.py. Single-threaded per cron tick,
so concurrent polling is not a concern. The scheduler lock in api/main.py
already prevents multiple pods from firing the same job.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

from api.services import tweet_store, twitterapi_io
from api.services.a8_taxonomy import resolve_primary
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

    stored, newest_id = _store_tweets(handle, tweets, since_id)
    summary["stored"] = stored

    tweet_store.update_poll_state(
        handle,
        last_seen_tweet_id=newest_id,
        status="ok",
        tweets_seen=summary["stored"],
    )
    logger.info("[tweet_poll] %s stored=%d newest=%s",
                handle, summary["stored"], newest_id)
    return summary


def _is_newer(tid: str, than: Optional[str]) -> bool:
    # Twitter ids are numerically increasing; compare as strings safely for bigints.
    return than is None or len(tid) > len(than) or (len(tid) == len(than) and tid > than)


def _store_tweets(handle: str, tweets: list[dict], since_id: Optional[str]) -> tuple[int, Optional[str]]:
    """Persist tweets (tickers, A8 primary, polarity label). Returns
    (stored_count, newest_id). One bad tweet never stops the rest."""
    stored = 0
    newest_id: Optional[str] = since_id
    for tweet in tweets:
        try:
            tickers = extract_tickers(tweet.get("text", ""))
            # TERM-075: which ticker is the story ABOUT. An annotation, never a
            # gate — if it cannot be computed the links store as today's (all
            # primary) and the tweet is kept.
            try:
                primary = resolve_primary(tweet.get("text", ""), tickers)
            except Exception:
                logger.exception("[tweet_poll] %s tweet %s primary resolve failed",
                                 handle, tweet.get("id"))
                primary = None
            tweet_store.upsert_tweet(tweet, tickers, primary)
            stored += 1
            # FT-080: label (never copy the text of) the tweet for the polarity
            # split. A no-op while SOCIAL_POLARITY_ENABLED is off; never fatal.
            try:
                from api.services import social_polarity
                social_polarity.record_tweet(tweet, tickers, primary)
            except Exception:
                logger.exception("[tweet_poll] %s tweet %s polarity label failed",
                                 handle, tweet.get("id"))
            tid = str(tweet.get("id"))
            if _is_newer(tid, newest_id):
                newest_id = tid
        except Exception:
            logger.exception("[tweet_poll] %s tweet %s failed to store",
                             handle, tweet.get("id"))
    return stored, newest_id


# ---- Poll modes (TWEET_POLL_MODE) -------------------------------------------
#
#   timeline (default) - one /user/last_tweets call per account per tick. That
#                        endpoint IGNORES since_id, so every call bills 20 tweets.
#   shadow             - timeline exactly as before (members see no change), PLUS
#                        a roster search that only RECORDS what it saw and when,
#                        into tweet_search_shadow. tweet_store.shadow_report()
#                        compares the two. Run this before switching.
#   search             - the roster search replaces the timeline: one call per
#                        tick for the whole roster, billed per new tweet only.
#
# Unknown values fall back to timeline: a typo must never stop the news feed.

_MODES = ("timeline", "shadow", "search")
_SEARCH_KEY = "roster_search"
_SHADOW_KEY = "roster_shadow"
# First run with no cursor looks back this far (bounded backfill, bounded bill).
_FIRST_RUN_LOOKBACK_S = int(os.environ.get("TWEET_SEARCH_FIRST_LOOKBACK_SECONDS", "1800"))
_MAX_PAGES = int(os.environ.get("TWEET_SEARCH_MAX_PAGES", "10"))


def poll_mode() -> str:
    m = (os.environ.get("TWEET_POLL_MODE") or "timeline").strip().lower()
    return m if m in _MODES else "timeline"


def _roster_search(key: str, handles: list[str]) -> tuple[list[dict], Optional[str], bool]:
    """Search the roster from the stored cursor. Returns (tweets, new_cursor,
    complete). Raises TwitterApiError; the cursor only moves on success."""
    state = tweet_store.get_search_state(key) or {}
    since_id = state.get("since_id")
    since_unix = None if since_id else int(time.time()) - _FIRST_RUN_LOOKBACK_S
    tweets, complete = twitterapi_io.search_roster_since(
        handles, since_id=since_id, since_unix=since_unix, max_pages=_MAX_PAGES)
    cursor = since_id
    for t in tweets:
        if _is_newer(str(t["id"]), cursor):
            cursor = str(t["id"])
    if not complete:
        logger.warning("[tweet_poll] %s burst exceeded %d pages; oldest tweets of "
                       "this window were not fetched", key, _MAX_PAGES)
    return tweets, cursor, complete


def _shadow_pass(handles: list[str]) -> None:
    """Record-only roster search. Never writes tweets, never raises."""
    try:
        tweets, cursor, complete = _roster_search(_SHADOW_KEY, handles)
        tweet_store.record_shadow_seen(tweets)
        tweet_store.update_search_state(_SHADOW_KEY, since_id=cursor,
                                        status="ok" if complete else "truncated")
    except Exception as e:
        logger.warning("[tweet_poll] shadow search failed: %s", e)
        try:
            tweet_store.update_search_state(_SHADOW_KEY, status="error", error=str(e)[:300])
        except Exception:
            pass


def poll_all_via_search(accounts: list[dict]) -> list[dict]:
    """Search mode: one roster search, results routed to each account's own
    poll_state so /api/admin/twitter-stats and the self-heal check keep
    working unchanged. Never raises."""
    handles = [a["handle"] for a in accounts]
    by_lower = {h.lower(): h for h in handles}
    try:
        tweets, cursor, complete = _roster_search(_SEARCH_KEY, handles)
    except twitterapi_io.TwitterApiError as e:
        if isinstance(e, twitterapi_io.TwitterApiAuthError):
            status = "auth_error"
        elif isinstance(e, twitterapi_io.TwitterApiPaymentRequired):
            status = "out_of_credits"
        elif isinstance(e, twitterapi_io.TwitterApiRateLimited):
            status = "rate_limited"
        else:
            status = "error"
        logger.error("[tweet_poll] roster search %s: %s", status, e)
        tweet_store.update_search_state(_SEARCH_KEY, status=status, error=str(e)[:300])
        for h in handles:
            tweet_store.update_poll_state(h, status=status, error=str(e)[:300])
        return [{"handle": h, "stored": 0, "status": status} for h in handles]
    except Exception as e:
        logger.exception("[tweet_poll] roster search unexpected")
        tweet_store.update_search_state(_SEARCH_KEY, status="error", error=f"unexpected: {e}"[:300])
        return [{"handle": h, "stored": 0, "status": "error"} for h in handles]

    grouped: dict[str, list[dict]] = {h: [] for h in handles}
    for t in tweets:
        h = by_lower.get((t.get("author_handle") or "").lower())
        if h:
            grouped[h].append(t)
    summaries = []
    for h in handles:
        prev = (tweet_store.get_poll_state(h) or {}).get("last_seen_tweet_id")
        stored, newest = _store_tweets(h, grouped[h], prev)
        tweet_store.update_poll_state(h, last_seen_tweet_id=newest, status="ok",
                                      tweets_seen=stored)
        summaries.append({"handle": h, "stored": stored, "status": "ok"})
    # Cursor moves only after every tweet was handed to storage.
    tweet_store.update_search_state(_SEARCH_KEY, since_id=cursor,
                                    status="ok" if complete else "truncated")
    logger.info("[tweet_poll] roster search stored=%d accounts=%d complete=%s",
                sum(s["stored"] for s in summaries), len(handles), complete)
    return summaries


def poll_all_accounts() -> list[dict]:
    accounts = tweet_store.list_accounts(enabled_only=True)
    mode = poll_mode()
    if mode == "search":
        return poll_all_via_search(accounts) if accounts else []
    if mode == "shadow" and accounts:
        # Search FIRST, so a tweet both sides find in the same tick reads as a
        # tie rather than a built-in timeline lead.
        _shadow_pass([a["handle"] for a in accounts])
    return [poll_account(a["handle"]) for a in accounts]
