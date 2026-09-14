"""Paid historical backfill of the official accounts' X posts through TwitterAPI.io (D12 + D17).

⛔ PAID: every page is a billable call — $0.15 per 1,000 tweets returned
(api/services/twitterapi_io.py's module docstring). Three independent stops, all
in code, none in settings:

1. ``flags.x_backfill_enabled()`` (WISDOM_X_BACKFILL_ENABLED) must be on for ANY
   network call, the one-call smoke test included;
2. a :class:`SpendCap` charged a FULL page at the worst case BEFORE each call,
   refusing the call that could cross the cap;
3. ``HARD_MAX_USD``, a ceiling no caller argument can raise.

A dry run makes no network call at all: it returns the query plan and the
worst-case cost.

PAGINATION — NOT VERIFIED IN THIS REPO BEFORE THIS MODULE. The existing client
(``twitterapi_io.search_tweets``, not edited) sends neither a cursor nor an upper
time bound. This reader sends ``GET /twitter/tweet/advanced_search`` with
``query="from:<handle> since_time:<unix> until_time:<unix>"``, ``queryType=Latest``
and ``cursor=<next_cursor>``, and reads ``has_next_page`` / ``next_cursor`` off the
body. :func:`smoke_test` makes exactly ONE paid call and reports the real shape.
Every loop stop is defensive against those names being wrong: no
``has_next_page``, an empty or repeated cursor, a page with no new tweet ids, and
``max_pages`` each end the walk.

⛔ Never writes tweets.db: its 03:00 sweep deletes by ``created_at`` older than 7
days, so a backfilled post written there would be gone the next morning. The
posts go to the R2 archive in the tweets dataset's layout
(capture/backfill.py).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from api.services.wisdom.core import flags

PRICE_PER_TWEET_USD = 0.15 / 1000
PAGE_SIZE_ESTIMATE = 20
HARD_MAX_USD = 25.0
SEARCH_PATH = "/twitter/tweet/advanced_search"
SMOKE_WINDOW_DAYS = 7


class BackfillRefused(RuntimeError):
    """A paid call was asked for while the backfill gate is off."""


@dataclass
class SpendCap:
    max_usd: float
    charged_usd: float = 0.0
    calls: int = 0
    tweets_returned: int = 0
    refused: list = field(default_factory=list)

    def __post_init__(self) -> None:
        if not (0 < float(self.max_usd) <= HARD_MAX_USD):
            raise ValueError(f"max_usd must be in (0, {HARD_MAX_USD}], got {self.max_usd!r}")

    @property
    def worst_case_page_usd(self) -> float:
        return PAGE_SIZE_ESTIMATE * PRICE_PER_TWEET_USD

    def reserve_page(self, label: str) -> bool:
        """Charge a full page before the call; False (and nothing charged) if that would cross the cap."""
        if self.charged_usd + self.worst_case_page_usd > float(self.max_usd) + 1e-12:
            self.refused.append(label)
            return False
        self.charged_usd += self.worst_case_page_usd
        self.calls += 1
        return True

    def settle(self, tweets: int) -> None:
        self.tweets_returned += max(0, int(tweets))

    @property
    def estimated_billed_usd(self) -> float:
        return self.tweets_returned * PRICE_PER_TWEET_USD

    def summary(self) -> dict:
        return {"max_usd": float(self.max_usd), "calls": self.calls, "charged_worst_case_usd": round(self.charged_usd, 6),
                "tweets_returned": self.tweets_returned, "estimated_billed_usd": round(self.estimated_billed_usd, 6),
                "refused": list(self.refused)}


def query_for(handle: str, since_unix: int, until_unix: int) -> str:
    handle = str(handle).lstrip("@").strip()
    if not handle or any(ch.isspace() for ch in handle):
        raise ValueError(f"bad handle {handle!r}")
    if int(since_unix) >= int(until_unix):
        raise ValueError("since_unix must be before until_unix")
    return f"from:{handle} since_time:{int(since_unix)} until_time:{int(until_unix)}"


def require_gate() -> None:
    if not flags.x_backfill_enabled():
        raise BackfillRefused("WISDOM_X_BACKFILL_ENABLED is off: no paid X call is allowed")


def fetch_page(query: str, cursor: Optional[str] = None) -> dict:
    """One advanced_search page. Raises the existing client's structured errors.
    The response is summarised; the API key never leaves the request header."""
    import requests

    from api.services import twitterapi_io as tio

    require_gate()
    params = {"query": query, "queryType": "Latest"}
    if cursor:
        params["cursor"] = cursor
    try:
        resp = requests.get(f"{tio.BASE_URL}{SEARCH_PATH}", params=params,
                            headers={"x-api-key": tio._api_key()}, timeout=tio.TIMEOUT)
    except requests.RequestException as exc:
        raise tio.TwitterApiTransientError(f"network error: {type(exc).__name__}") from exc
    if resp.status_code == 401:
        raise tio.TwitterApiAuthError("auth failed (401)")
    if resp.status_code == 402:
        raise tio.TwitterApiPaymentRequired("out of credits (402)")
    if resp.status_code == 429:
        raise tio.TwitterApiRateLimited("rate limited (429)")
    if resp.status_code != 200:
        raise tio.TwitterApiTransientError(f"HTTP {resp.status_code}")
    body = resp.json()
    raw = tio._extract_tweets(body)
    handle = query.split()[0][len("from:"):] if query.startswith("from:") else "search"
    tweets = [tio._normalize_tweet(t, fallback_handle=handle) for t in raw if isinstance(t, dict)]
    has_next = body.get("has_next_page") if isinstance(body, dict) else None
    nxt = body.get("next_cursor") if isinstance(body, dict) else None
    return {"status": resp.status_code, "tweets": tweets, "has_next_page": has_next, "next_cursor": nxt,
            "keys": sorted(body.keys()) if isinstance(body, dict) else [type(body).__name__]}


def backfill_handle(handle: str, since_unix: int, until_unix: int, *, cap: SpendCap, dry_run: bool = True,
                    max_pages: int = 50, fetch: Callable[[str, Optional[str]], dict] = fetch_page) -> dict:
    query = query_for(handle, since_unix, until_unix)
    plan = {"handle": handle, "query": query, "max_pages": max_pages,
            "worst_case_usd": round(min(float(cap.max_usd), max_pages * cap.worst_case_page_usd), 6)}
    if dry_run:
        return {**plan, "dry_run": True, "pages": 0, "posts": [], "stopped": "dry_run"}
    require_gate()
    by_id: dict = {}
    cursor: Optional[str] = None
    seen_cursors: set = set()
    pages, stopped, foreign = 0, None, 0
    while True:
        if pages >= max_pages:
            stopped = "max_pages"
            break
        if not cap.reserve_page(f"{handle}:page{pages + 1}"):
            stopped = "spend_cap"
            break
        page = fetch(query, cursor)
        pages += 1
        got = page.get("tweets") or []
        cap.settle(len(got))
        new = 0
        for tweet in got:
            if str(tweet.get("author_handle", "")).lower() != handle.lower():
                foreign += 1
                continue
            if tweet["id"] not in by_id:
                new += 1
            by_id[tweet["id"]] = tweet
        if not got:
            stopped = "empty_page"
            break
        if new == 0:
            stopped = "no_new_ids"
            break
        nxt = page.get("next_cursor")
        if not page.get("has_next_page") or not nxt:
            stopped = "last_page"
            break
        if nxt == cursor or nxt in seen_cursors:
            stopped = "repeated_cursor"
            break
        seen_cursors.add(nxt)
        cursor = nxt
    posts = sorted((t for t in by_id.values() if since_unix <= int(t.get("created_at") or 0) < until_unix),
                   key=lambda t: (int(t.get("created_at") or 0), str(t["id"])))
    return {**plan, "dry_run": False, "pages": pages, "stopped": stopped, "posts": posts,
            "outside_window": len(by_id) - len(posts), "foreign_author": foreign}


def smoke_test(handle: str = "TSDR_Trading", *, execute: bool = False, now_unix: Optional[int] = None,
               fetch: Callable[[str, Optional[str]], dict] = fetch_page) -> dict:
    """EXACTLY ONE paid call when ``execute`` — never a second: the cursor it returns
    is reported, not followed. Reports the response shape and whether the
    since_time/until_time bounds were honoured, never the post text."""
    now = int(now_unix if now_unix is not None else time.time())
    until = now - 86400
    since = until - SMOKE_WINDOW_DAYS * 86400
    query = query_for(handle, since, until)
    worst = PAGE_SIZE_ESTIMATE * PRICE_PER_TWEET_USD
    if not execute:
        return {"dry_run": True, "query": query, "calls": 0, "worst_case_usd": round(worst, 6)}
    require_gate()
    page = fetch(query, None)
    tweets = page.get("tweets") or []
    stamps = [int(t.get("created_at") or 0) for t in tweets]
    nxt = page.get("next_cursor")
    return {
        "dry_run": False, "calls": 1, "query": query, "status": page.get("status"),
        "response_keys": page.get("keys"), "tweets": len(tweets),
        "authors": sorted({str(t.get("author_handle")) for t in tweets}),
        "tweets_before_since": sum(1 for s in stamps if s < since),
        "tweets_at_or_after_until": sum(1 for s in stamps if s >= until),
        "unparseable_created_at": sum(1 for s in stamps if s == 0),
        "has_next_page": page.get("has_next_page"),
        "next_cursor_present": bool(nxt), "next_cursor_length": len(nxt) if isinstance(nxt, str) else None,
        "estimated_cost_usd": round(len(tweets) * PRICE_PER_TWEET_USD, 6), "worst_case_usd": round(worst, 6),
        "cursor_param": "not exercised — one paid call only; next_cursor is reported, never followed",
    }
