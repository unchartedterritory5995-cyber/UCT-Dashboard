"""Import a tweet -- the READ side: recent posts UCT holds, and a pasted X link as a post.

Two reads, one shape. Both answer the same camelCase POST:

    {id, name, handle, avatarUrl, text, postedAt, url, tickers, media, kind}

  * `recent(symbol, scope)` -- posts already in `tweets.db` over the last 168 hours: for one
    ticker (`'ticker'`, `tweet_store.tweets_for_ticker`) or the whole curated feed (`'all'`,
    `tweet_store.feed(hours=168, limit=200)`).
  * `resolve_link(url)` -- a pasted link becomes a post. The store is asked first (no vendor
    call, no spend); only a miss goes to the vendor.

THE RULES THIS MODULE KEEPS (each is a decision, and each has a test):
  * The server only ever fetches a tweet by its NUMERIC ID. `parse_status_id` takes the id out
    of the link and nothing else of the member's text goes anywhere: the URL is never requested,
    so a pasted link cannot make the server fetch an address of the member's choosing.
  * A post fetched from a link is NEVER written to `tweets.db`. That store is the curated
    accounts' feed; a member's pasted link must not add an account's post to everybody's feed.
  * `postedAt` is unix seconds (the store's own `created_at`), `avatarUrl` is the
    `pbs.twimg.com/profile_images/` URL found in the stored payload or None, and `kind` is the
    author's `content_kind` ('news' | 'commentary'), 'commentary' for an author UCT does not know.
  * `raw_json` never leaves this module.

⛔ DARK: `NOTEBOOK_TWEET_IMPORT_ENABLED` unset means every tweet route answers 404. Read per call
through the one Notebook flag parse (`notebook_flags.flag_on`).
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from api.services import tweet_store, twitterapi_io
from api.services.notebook_flags import flag_on
from api.services.ticker_resolver import route_symbol
from api.services.tweet_ticker_extract import extract_tickers

logger = logging.getLogger(__name__)

GATE = "NOTEBOOK_TWEET_IMPORT_ENABLED"

#: The recent window, both scopes.
RECENT_HOURS = 168
#: How many posts `scope='all'` (and, for symmetry, a ticker) returns at most.
RECENT_LIMIT = 200

NOT_FOUND_SENTENCE = "That post could not be found. It may be deleted or private."
VENDOR_DOWN_SENTENCE = "X is not answering right now. Try again in a moment."
NOT_A_LINK_SENTENCE = "That is not a link to a post on X."

#: The host is EXACTLY x.com or twitter.com, optionally behind www. or mobile. -- the path
#: separator (or end of string) must follow, so `x.com.evil.test` and `notx.com` never match.
_STATUS_RE = re.compile(
    r"^(?:https?://)?(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)/"
    r"[A-Za-z0-9_]{1,15}/status(?:es)?/(\d{1,25})(?:[/?#].*)?$",
    re.IGNORECASE,
)
_AVATAR_RE = re.compile(r'https://pbs\.twimg\.com/profile_images/[^"\\\s]+')


class TweetCaptureError(Exception):
    """A refusal with the HTTP status the router answers and the sentence a member reads."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse."""
    return flag_on(GATE, False)


def parse_status_id(url: Any) -> Optional[str]:
    """The numeric status id of an x.com / twitter.com post link, or None."""
    if not isinstance(url, str):
        return None
    m = _STATUS_RE.match(url.strip())
    return m.group(1) if m else None


def _kinds() -> dict[str, str]:
    out: dict[str, str] = {}
    for a in tweet_store.list_accounts():
        h = str(a.get("handle") or "").lower()
        if h:
            out[h] = a.get("content_kind") or "commentary"
    return out


def _avatar(raw_json: Optional[str]) -> Optional[str]:
    if not raw_json:
        return None
    m = _AVATAR_RE.search(raw_json.replace("\\/", "/"))
    return m.group(0) if m else None


def _post(row: dict, kinds: dict[str, str]) -> dict[str, Any]:
    handle = str(row.get("author_handle") or "")
    return {
        "id": str(row["id"]),
        "name": row.get("author_name") or handle,
        "handle": handle,
        "avatarUrl": _avatar(row.get("raw_json")),
        "text": row.get("text") or "",
        "postedAt": int(row.get("created_at") or 0),
        "url": row.get("url") or "",
        "tickers": list(row.get("tickers") or []),
        "media": list(row.get("media") or []),
        "kind": kinds.get(handle.lower(), "commentary"),
    }


def recent(symbol: Optional[str], scope: str) -> list[dict[str, Any]]:
    """Posts UCT holds from the last 168 hours, newest first."""
    if scope == "ticker":
        sym = route_symbol(symbol.strip().lstrip("$")) if isinstance(symbol, str) else None
        if not sym:
            raise TweetCaptureError("Pick a ticker to see its recent posts.")
        rows = tweet_store.with_links(
            tweet_store.tweets_for_ticker(sym, hours=RECENT_HOURS)[:RECENT_LIMIT])
    elif scope == "all":
        rows = tweet_store.feed(hours=RECENT_HOURS, limit=RECENT_LIMIT)
    else:
        raise TweetCaptureError("Scope must be 'ticker' or 'all'.")
    kinds = _kinds()
    return [_post(r, kinds) for r in rows]


def resolve_link(url: Any) -> dict[str, Any]:
    """A pasted X link as a post. Store first; a miss asks the vendor by id. Never persists."""
    tweet_id = parse_status_id(url)
    if tweet_id is None:
        raise TweetCaptureError(NOT_A_LINK_SENTENCE)
    kinds = _kinds()
    row = tweet_store.get_tweet(tweet_id)
    if row is not None:
        return _post(row, kinds)
    try:
        fetched = twitterapi_io.get_tweets_by_ids([tweet_id])
    except twitterapi_io.TwitterApiError as e:
        # The sentence is the member's; the cause (never the key) goes to the log.
        logger.warning("[tweet_capture] vendor lookup failed: %s", type(e).__name__)
        raise TweetCaptureError(VENDOR_DOWN_SENTENCE, status=503) from e
    match = next((t for t in fetched if str(t.get("id")) == tweet_id), None)
    if match is None:
        raise TweetCaptureError(NOT_FOUND_SENTENCE, status=404)
    row = dict(match)
    row["tickers"] = sorted(extract_tickers(row.get("text") or ""))
    row["media"] = tweet_store._extract_media(row.get("raw_json"))
    return _post(row, kinds)
