"""Admin-only management of the curated Twitter accounts list.

Auth: api.middleware.auth_middleware.require_admin — same dependency
used by admin_chart_health.py. Returns 403 for non-admin users.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path

from api.middleware.auth_middleware import require_admin
from api.services import tweet_store, twitterapi_io, tweet_poller

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin-twitter"])

# Self-heal cadence — mirrors COT pattern (cot_service._maybe_auto_refresh_if_stale)
_LAST_AUTO_REFRESH_AT: Optional[int] = None
_AUTO_REFRESH_COOLDOWN_SEC = 30 * 60  # 30 min


def _maybe_auto_refresh_if_stale() -> None:
    """If no successful poll in last 30 min, kick a background refresh.
    Mirrors api/services/cot_service.py:_maybe_auto_refresh_if_stale."""
    global _LAST_AUTO_REFRESH_AT
    now = int(time.time())
    if _LAST_AUTO_REFRESH_AT and (now - _LAST_AUTO_REFRESH_AT) < _AUTO_REFRESH_COOLDOWN_SEC:
        return
    try:
        accounts = tweet_store.list_accounts(enabled_only=True)
        if not accounts:
            return
        stale = True
        for a in accounts:
            state = tweet_store.get_poll_state(a["handle"]) or {}
            if state.get("last_poll_status") == "ok" and \
               (state.get("last_poll_at") or 0) > now - 30 * 60:
                stale = False
                break
        if stale:
            import threading
            threading.Thread(target=tweet_poller.poll_all_accounts,
                             daemon=True, name="tweet-self-heal").start()
            _LAST_AUTO_REFRESH_AT = now
            logger.info("[twitter-admin] self-heal poll triggered")
    except Exception:
        logger.exception("[twitter-admin] self-heal check failed")


@router.get("/twitter-accounts")
def list_accounts(user=Depends(require_admin)):
    accounts = tweet_store.list_accounts(enabled_only=False)
    for a in accounts:
        a["poll_state"] = tweet_store.get_poll_state(a["handle"])
    return accounts


@router.post("/twitter-accounts")
def add_account(body: dict = Body(...), user=Depends(require_admin)):
    handle = (body.get("handle") or "").strip().lstrip("@")
    notes = body.get("notes")
    if not handle or not handle.replace("_", "").isalnum() or len(handle) > 32:
        raise HTTPException(400, "invalid handle")

    # Validate handle exists by calling TwitterAPI.io once
    try:
        tweets = twitterapi_io.get_user_last_tweets(handle)
    except twitterapi_io.TwitterApiError as e:
        raise HTTPException(422, f"could not validate handle: {e}")
    except Exception as e:
        # Unexpected: log full trace + surface real error so admin sees it
        logger.exception("[twitter-admin] add_account: unexpected error during validate")
        raise HTTPException(500, f"unexpected during validate: {type(e).__name__}: {e}")

    display_name = None
    try:
        if tweets:
            display_name = tweets[0].get("author_name") or handle
    except Exception as e:
        logger.exception("[twitter-admin] add_account: failed to parse first tweet")
        raise HTTPException(500, f"response shape unexpected: {type(e).__name__}: {e}; "
                                 f"first item type={type(tweets[0]).__name__ if tweets else 'empty'}")

    try:
        tweet_store.add_account(handle, display_name=display_name,
                                added_by_user_id=user.get("id"), notes=notes)
    except Exception as e:
        logger.exception("[twitter-admin] add_account: tweet_store.add_account failed")
        raise HTTPException(500, f"store insert failed: {type(e).__name__}: {e}")

    return tweet_store.list_accounts()


@router.patch("/twitter-accounts/{handle}")
def update_account(handle: str = Path(...),
                   body: dict = Body(...),
                   user=Depends(require_admin)):
    if "enabled" in body:
        tweet_store.set_account_enabled(handle, bool(body["enabled"]))
    if "notes" in body:
        tweet_store.update_account_notes(handle, body["notes"])
    return tweet_store.list_accounts()


@router.delete("/twitter-accounts/{handle}")
def delete_account(handle: str = Path(...), user=Depends(require_admin)):
    # Soft-disable to preserve history
    tweet_store.set_account_enabled(handle, False)
    return {"ok": True}


@router.post("/twitter-accounts/{handle}/force-poll")
def force_poll(handle: str = Path(...), user=Depends(require_admin)):
    summary = tweet_poller.poll_account(handle)
    return summary


@router.get("/twitter-stats")
def twitter_stats(user=Depends(require_admin)):
    _maybe_auto_refresh_if_stale()

    total = tweet_store.count_tweets()
    per_account = []
    total_billed = 0
    for a in tweet_store.list_accounts(enabled_only=False):
        state = tweet_store.get_poll_state(a["handle"]) or {}
        per_account.append({
            "handle": a["handle"],
            "enabled": a["enabled"],
            "last_poll_at": state.get("last_poll_at"),
            "last_poll_status": state.get("last_poll_status"),
            "last_error": state.get("last_error"),
            "total_tweets_seen": state.get("total_tweets_seen", 0),
        })
        total_billed += state.get("total_tweets_seen", 0)

    # $0.15 per 1,000 tweets per TwitterAPI.io pricing (2026-05-25)
    mtd_cost = round(total_billed * 0.00015, 2)

    return {
        "total_tweets": total,
        "per_account": per_account,
        "mtd_estimated_cost_usd": mtd_cost,
    }
