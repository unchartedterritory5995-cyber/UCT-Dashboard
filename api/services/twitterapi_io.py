"""TwitterAPI.io HTTP client.

Single endpoint we need: GET /twitter/get_user_last_tweets
Auth: x-api-key header (no OAuth).
Pricing: $0.15 per 1,000 tweets returned. since_id filtering minimizes spend.

All errors raise structured exceptions so callers can react differently:
  - 401 -> TwitterApiAuthError (kill polling until key fixed)
  - 402 -> TwitterApiPaymentRequired (back off all polling)
  - 429 -> TwitterApiRateLimited (exponential backoff)
  - 5xx / network -> TwitterApiTransientError (retry)
"""
from __future__ import annotations

import json
import logging
import os
import time
from email.utils import parsedate_to_datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("TWITTERAPI_IO_BASE_URL", "https://api.twitterapi.io")
TIMEOUT = int(os.environ.get("TWEET_POLL_TIMEOUT_SECONDS", "10"))


class TwitterApiError(Exception):
    """Base class for all TwitterAPI.io failures."""


class TwitterApiConfigError(TwitterApiError):
    """API key missing."""


class TwitterApiAuthError(TwitterApiError):
    """401 - key invalid or revoked."""


class TwitterApiPaymentRequired(TwitterApiError):
    """402 - out of credits."""


class TwitterApiRateLimited(TwitterApiError):
    """429 - slow down."""


class TwitterApiTransientError(TwitterApiError):
    """5xx or network - retry."""


def _api_key() -> str:
    key = os.environ.get("TWITTERAPI_IO_API_KEY")
    if not key:
        raise TwitterApiConfigError("TWITTERAPI_IO_API_KEY not set")
    return key


def _parse_created_at(value) -> int:
    """Parse the API's `createdAt` (Twitter-style 'Mon Jan 01 12:00:00 +0000 2026')
    or an ISO string, or a unix int. Returns unix seconds UTC."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(parsedate_to_datetime(value).timestamp())
        except (TypeError, ValueError):
            pass
        try:
            import datetime as _dt
            return int(_dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except Exception:
            pass
    return int(time.time())


def _normalize_tweet(raw: dict, fallback_handle: str) -> dict:
    """Map TwitterAPI.io payload to our tweet_store shape."""
    author = raw.get("author") or raw.get("user") or {}
    handle = author.get("userName") or author.get("screen_name") or fallback_handle
    tweet_id = str(raw.get("id") or raw.get("id_str") or raw.get("tweetId"))
    text = raw.get("text") or raw.get("fullText") or raw.get("full_text") or ""
    url = raw.get("url") or f"https://twitter.com/{handle}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "author_handle": handle,
        "author_name": author.get("name"),
        "text": text,
        "created_at": _parse_created_at(raw.get("createdAt") or raw.get("created_at")),
        "url": url,
        "reply_count": raw.get("replyCount") or raw.get("reply_count") or 0,
        "like_count": raw.get("likeCount") or raw.get("favorite_count") or 0,
        "retweet_count": raw.get("retweetCount") or raw.get("retweet_count") or 0,
        "is_retweet": 1 if raw.get("isRetweet") or raw.get("retweeted") else 0,
        "raw_json": json.dumps(raw)[:8000],  # cap payload size
    }


def get_user_last_tweets(handle: str, since_id: Optional[str] = None) -> list[dict]:
    """Fetch newest tweets for a given handle. since_id is the most recent
    tweet id we've already seen - API returns only newer ones."""
    params: dict = {"userName": handle}
    if since_id:
        # TwitterAPI.io may use sinceId or since_id; we send both and let
        # the API ignore the wrong one. Smoke test confirms which works.
        params["sinceId"] = since_id
        params["since_id"] = since_id

    try:
        r = requests.get(
            f"{BASE_URL}/twitter/user/last_tweets",
            params=params,
            headers={"x-api-key": _api_key()},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise TwitterApiTransientError(f"network error: {e}") from e

    if r.status_code == 401:
        raise TwitterApiAuthError(f"auth failed: {r.text[:200]}")
    if r.status_code == 402:
        raise TwitterApiPaymentRequired(f"out of credits: {r.text[:200]}")
    if r.status_code == 429:
        raise TwitterApiRateLimited(f"rate limited: {r.text[:200]}")
    if r.status_code >= 500:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")
    if r.status_code != 200:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")

    body = r.json()
    raw_tweets = _extract_tweets(body)
    return [_normalize_tweet(t, fallback_handle=handle)
            for t in raw_tweets if isinstance(t, dict)]


def _extract_tweets(body: dict) -> list:
    """Robustly extract the tweet list from the response body.

    TwitterAPI.io has wrapped its payload in a few different shapes across
    docs revisions and endpoints. Tested patterns:
      {"tweets": [...]}                            — flat
      {"data": [...]}                              — flat-aliased
      {"data": {"tweets": [...]}}                  — nested (current observed)
      {"status": "...", "data": {"tweets": [...]}} — nested + meta
    Anything else returns [] and logs so we can spot a new pattern.
    """
    if not isinstance(body, dict):
        logger.warning("[twitterapi_io] unexpected body type: %s", type(body).__name__)
        return []

    # Pattern 1: top-level tweets array
    t = body.get("tweets")
    if isinstance(t, list):
        return t

    # Pattern 2 / 3: data is dict containing tweets, or data is directly the list
    data = body.get("data")
    if isinstance(data, dict):
        nested = data.get("tweets")
        if isinstance(nested, list):
            return nested
    if isinstance(data, list):
        return data

    logger.warning("[twitterapi_io] could not find tweets list in response. "
                   "Top-level keys: %s", sorted(body.keys()))
    return []


def search_tweets(query: str, since_unix: Optional[int] = None,
                  query_type: str = "Latest", max_results: int = 20) -> list[dict]:
    """Search ALL of Twitter for a query string (e.g. '$AAPL' or '$AAPL OR \"Palantir\"').

    Used by the catalyst engine to broaden source coverage beyond the curated
    accounts. Same auth + error semantics as get_user_last_tweets.

    Args:
        query: search syntax. Can include cashtags, keywords, OR / AND, lang:en, etc.
        since_unix: optional — only return tweets after this unix timestamp.
                    Appended as " since_time:<ts>" to the query.
        query_type: "Latest" (recency-ordered) or "Top" (engagement-ordered).
        max_results: cap on returned items (page is 20 per spec; we return up to this).

    Returns: list of tweet dicts in the same _normalize_tweet shape as
             get_user_last_tweets so downstream code can treat them uniformly.
    """
    full_query = query
    if since_unix:
        full_query = f"{query} since_time:{int(since_unix)}"

    params = {"query": full_query, "queryType": query_type}

    try:
        r = requests.get(
            f"{BASE_URL}/twitter/tweet/advanced_search",
            params=params,
            headers={"x-api-key": _api_key()},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise TwitterApiTransientError(f"network error: {e}") from e

    if r.status_code == 401:
        raise TwitterApiAuthError(f"auth failed: {r.text[:200]}")
    if r.status_code == 402:
        raise TwitterApiPaymentRequired(f"out of credits: {r.text[:200]}")
    if r.status_code == 429:
        raise TwitterApiRateLimited(f"rate limited: {r.text[:200]}")
    if r.status_code >= 500:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")
    if r.status_code != 200:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")

    body = r.json()
    raw_tweets = _extract_tweets(body)
    out: list[dict] = []
    for raw in raw_tweets[:max_results]:
        if not isinstance(raw, dict):
            continue
        out.append(_normalize_tweet(raw, fallback_handle="search"))
    return out
