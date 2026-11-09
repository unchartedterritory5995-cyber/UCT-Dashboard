"""Import a tweet: the routes (DARK behind NOTEBOOK_TWEET_IMPORT_ENABLED, 404 while off).

    GET   /api/j2/research-capture/tweets/recent?symbol=&scope=     posts UCT holds, last 168 h
    POST  /api/j2/research-capture/tweets/resolve                   a pasted X link -> a post
    POST  /api/j2/research-capture/tweets/save                      posts -> cited excerpts in a note

⛔ ITS OWN MODULE, NOT A THIRD ROUTER IN `notebook_research_capture.py`. Saving a post reads its
price through the member bars door, and transcript capture carries a rail that its router's
import graph never reaches AlphaVantage (`tests/test_notebook_transcript_capture.py`). The URL
prefix is shared; the import graph is not.

Service: `journal_two/tweet_capture.py`. Paid on every route, zero model calls.
"""
from __future__ import annotations

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
    `scope=all` is the curated feed. A plain read of `tweets.db`; no vendor call."""
    try:
        return {"posts": tw.recent(symbol, scope)}
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
    re-read server-side, and nothing the client sent about a post is stored."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    try:
        return tw.save(str(user["id"]), payload.get("noteId"), payload.get("tweetIds"))
    except tw.TweetCaptureError as e:
        raise _fail(e) from e
