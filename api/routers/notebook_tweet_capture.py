"""Import a tweet: the routes (DARK behind NOTEBOOK_TWEET_IMPORT_ENABLED, 404 while off).

    GET   /api/j2/research-capture/tweets/recent?symbol=&scope=     posts UCT holds, last 168 h
    POST  /api/j2/research-capture/tweets/resolve                   a pasted X link -> a post
    POST  /api/j2/research-capture/tweets/save                      posts -> cited excerpts in a note

⛔ ITS OWN MODULE, NOT A THIRD ROUTER IN `notebook_research_capture.py`. The separation keeps
tweet code out of that router's module; the URL prefix is shared.

Service: `journal_two/tweet_capture.py`. Paid on every route, zero model calls.
"""
from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.journal_two import tweet_capture as tw


def _require_tweet_import() -> None:
    """Router-level: an off gate answers like no route (FastAPI's own unknown-route body),
    before the plan check, the body read or any work."""
    if not tw.enabled():
        raise HTTPException(status_code=404, detail="Not Found")


tweets_router = APIRouter(
    prefix="/api/j2/research-capture/tweets",
    tags=["journal-2-0", "notebook-research-capture"],
    dependencies=[Depends(_require_tweet_import)],
)

#: `POST /tweets/resolve` -- one vendor call per press, so its own bucket. PER-PROCESS state
#: (api/limiter.py's in-memory storage): a second web process doubles it (CLAUDE.md roster).
TWEET_RESOLVE_RATE = "30/minute"
SCOPE_TWEET_RESOLVE = "notebook-tweet-resolve"
TWEET_RESOLVE_RATE_SENTENCE = "That's a lot of links at once. Try again in a minute."
MAX_LINK_CHARS = 2048

#: `POST /tweets/save` -- each press can spend vendor reads, bar reads and image copies.
#: PER-PROCESS state, like the resolve bucket and `_SAVE_INFLIGHT` (CLAUDE.md roster).
TWEET_SAVE_RATE = "20/minute"
SCOPE_TWEET_SAVE = "notebook-tweet-save"
TWEET_SAVE_RATE_SENTENCE = "That's a lot of imports at once. Try again in a minute."
SAVE_RUNNING_SENTENCE = "An import is already running. Try again in a moment."

#: The members with a save running now: one at a time each. The route is a sync def, so
#: requests run on threadpool threads and the set needs a real lock.
_SAVE_INFLIGHT: set[str] = set()
_SAVE_INFLIGHT_LOCK = threading.Lock()


def _claim_save(user_id: str) -> bool:
    with _SAVE_INFLIGHT_LOCK:
        if user_id in _SAVE_INFLIGHT:
            return False
        _SAVE_INFLIGHT.add(user_id)
        return True


def _release_save(user_id: str) -> None:
    with _SAVE_INFLIGHT_LOCK:
        _SAVE_INFLIGHT.discard(user_id)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router module, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Importing tweets requires a paid plan")
    return user


# Bodies are never declared parameters: `_json` reads them capped, after the router's gate and
# after the plan check (tests/test_notebook_body_census.py). The largest is a save (20 ids and
# a note id) or one pasted link (`MAX_LINK_CHARS`), so 16 KiB leaves room for JSON escapes.
TOO_LARGE_SENTENCE = "Request too large"


def _body_max() -> int:
    return 16 * 1024


def _json(annotation):
    return body_cap.capped_json(annotation, _body_max, lambda: TOO_LARGE_SENTENCE, after=require_paid)


def _fail(e: tw.TweetCaptureError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


@tweets_router.get("/recent")
def recent_tweets(symbol: str | None = Query(None, max_length=32),
                  scope: str = Query("all", max_length=16),
                  user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Posts UCT already holds from the last 168 hours: `scope=ticker` needs `symbol`,
    `scope=all` is the curated feed. A plain read of `tweets.db`, plus one query for which of
    them this member has saved; no vendor call."""
    try:
        return {"posts": tw.recent(symbol, scope, str(user["id"]))}
    except tw.TweetCaptureError as e:
        raise _fail(e) from e


@tweets_router.post("/resolve")
def resolve_tweet(payload: dict[str, Any] = Depends(_json(dict[str, Any])),
                  user: dict = Depends(require_paid)) -> dict[str, Any]:
    """A pasted X link as a post. The server fetches by the link's numeric id only, never the
    link; a post fetched this way is not stored. 30/minute per member (a vendor call per press)."""
    from api.services.journal_two import public_note_payload as public
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    url = payload.get("url")
    if not isinstance(url, str) or not url.strip() or len(url) > MAX_LINK_CHARS:
        raise HTTPException(status_code=400, detail=tw.NOT_A_LINK_SENTENCE)
    # The limiter's own 429 is its own response: it is raised OUTSIDE the try below.
    public.enforce_rate(TWEET_RESOLVE_RATE, SCOPE_TWEET_RESOLVE, f"member:{user['id']}",
                        TWEET_RESOLVE_RATE_SENTENCE, public=False)
    try:
        return {"post": tw.resolve_link(url)}
    except tw.TweetCaptureError as e:
        raise _fail(e) from e


@tweets_router.post("/save")
def save_tweets(payload: dict[str, Any] = Depends(_json(dict[str, Any])),
                user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Posts by id into a note, as cited excerpts. A sync route (threadpool): each post is
    re-read server-side, and nothing the client sent about a post is stored. 20/minute per
    member, and one running at a time per member."""
    from api.services.journal_two import public_note_payload as public
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    uid = str(user["id"])
    # The limiter's own 429 is its own response: it is raised OUTSIDE the try below.
    public.enforce_rate(TWEET_SAVE_RATE, SCOPE_TWEET_SAVE, f"member:{uid}",
                        TWEET_SAVE_RATE_SENTENCE, public=False)
    if not _claim_save(uid):
        raise HTTPException(status_code=429, detail=SAVE_RUNNING_SENTENCE)
    try:
        return tw.save(uid, payload.get("noteId"), payload.get("tweetIds"))
    except tw.TweetCaptureError as e:
        raise _fail(e) from e
    finally:
        _release_save(uid)
