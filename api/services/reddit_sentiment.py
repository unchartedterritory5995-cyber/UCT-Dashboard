"""Reddit sentiment for a ticker via PRAW.

Searches r/wallstreetbets, r/stocks, r/options, r/investing, r/thetagang for
mentions of the ticker over the last 24h, counts bullish/bearish language
markers, returns sentiment + sample posts.

Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET env vars (free Reddit app
at https://www.reddit.com/prefs/apps — create as 'script' type).

If credentials aren't set, tool returns a graceful "not configured" error
so voice degrades to an "I don't have Reddit data" answer.
"""

import logging
import os
import re
from typing import Any

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_CACHE = TTLCache()
_CACHE_TTL = 600  # 10 min

# Keyword regex for bullish/bearish language scoring
_BULL = re.compile(r"\b(bull|moon|rip|breakout|long|calls?|buy|squeeze|tendies)\b|🚀|💎|🌙", re.I)
_BEAR = re.compile(r"\b(bear|dump|short|tank|puts?|crash|drilling|sell|rugpull|bag)\b|📉|💀", re.I)

_DEFAULT_SUBS = ("wallstreetbets", "stocks", "options", "investing", "thetagang")


def _get_client():
    try:
        import praw
    except ImportError as e:
        raise RuntimeError("praw not installed — add to requirements.txt") from e
    cid = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    csec = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    if not cid or not csec:
        raise RuntimeError("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set")
    return praw.Reddit(
        client_id=cid,
        client_secret=csec,
        user_agent="uct-intelligence/1.0 by u/uctintelligence",
    )


def sentiment_for_ticker(ticker: str, hours: int = 24, limit: int = 40) -> dict[str, Any]:
    """Aggregate Reddit sentiment + samples for a ticker."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    cache_key = f"reddit::{sym}::{hours}::{limit}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        r = _get_client()
    except RuntimeError as e:
        return {
            "error": str(e),
            "ticker": sym,
            "hint": "Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET on Railway (free Reddit app).",
        }

    bull = bear = 0
    samples: list[dict] = []
    posts_seen = 0
    per_sub = max(2, limit // len(_DEFAULT_SUBS))

    # PRAW supports time_filter='day' for last 24h
    time_filter = "day" if hours <= 24 else "week" if hours <= 168 else "month"

    try:
        for sub_name in _DEFAULT_SUBS:
            sub = r.subreddit(sub_name)
            # Use search instead of stream — predictable + works against historical
            for s in sub.search(f"${sym}", time_filter=time_filter, limit=per_sub):
                text = (s.title or "") + " " + (s.selftext or "")
                text = text[:3000]
                b = len(_BULL.findall(text))
                br = len(_BEAR.findall(text))
                bull += b
                bear += br
                posts_seen += 1
                if len(samples) < 6 and (b + br) > 0:
                    samples.append({
                        "title": (s.title or "")[:220],
                        "subreddit": sub_name,
                        "score": s.score,
                        "comments": s.num_comments,
                        "bull_markers": b,
                        "bear_markers": br,
                        "url": f"https://reddit.com{s.permalink}",
                    })
    except Exception as e:
        _log.warning("reddit fetch failed: %s", e)
        return {"error": f"reddit fetch failed: {e}", "ticker": sym}

    total = bull + bear
    score = (bull - bear) / total if total else 0.0
    verdict = (
        "bullish" if score > 0.2 else
        "bearish" if score < -0.2 else
        "mixed" if total > 0 else "no_chatter"
    )
    result = {
        "ticker": sym,
        "posts_seen": posts_seen,
        "bullish_markers": bull,
        "bearish_markers": bear,
        "net_score": round(score, 3),
        "verdict": verdict,
        "window_hours": hours,
        "samples": samples,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
