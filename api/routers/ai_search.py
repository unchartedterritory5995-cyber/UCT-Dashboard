"""AI Search widget — ask anything about markets, get a cited answer.

POST /api/ai-search  { query, mode? }  ->  { answer, citations, model, elapsed_ms, ... }

Backed by Perplexity (web-search-grounded), so answers use current data + sources.

Usage guard: every non-cached query bills Perplexity, and /charts is a FREE-tier
page — so the endpoint enforces a per-user daily cap plus a global daily budget
(both env-tunable). Cached answers are free and never count against either.
Counters are in-memory (reset on redeploy — lenient by design, never user-hostile).
"""
from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import perplexity_search

router = APIRouter(prefix="/api/ai-search", tags=["ai-search"])

_WIDGET_SYSTEM = (
    "You are a sharp, decisive markets & trading research assistant for a senior "
    "swing trader. Answer the question directly and specifically. Cite concrete "
    "numbers, dates, and firm names. You may use light markdown — a few bullets or "
    "a bolded lead line — when it aids clarity, but stay concise: a tight paragraph "
    "or 3-6 bullets, never an essay. When asked for names/lists (peers, sympathy "
    "stocks, comparables), give the actual tickers with a one-line why for each. If "
    "sources disagree or the data is thin, say so plainly. No hedging, no filler, no "
    "restating the question.\n\n"
    "CRITICAL FORMATTING: whenever you mention a publicly traded stock — by COMPANY "
    "NAME or by TICKER — wrap it as a clickable link in this EXACT markdown format: "
    "[Display Text]($TICKER). Examples: [Apple]($AAPL), [$MSFT]($MSFT), "
    "[Nvidia]($NVDA), [Berkshire Hathaway]($BRK.A). Always include the correct "
    "$TICKER as the link target so it can be clicked. Do this for every stock "
    "mention, company names included."
)

# ── Daily usage limits (ET day; env-tunable) ─────────────────────────────────
_ET_OFFSET_FALLBACK = timedelta(hours=-5)


def _user_daily_limit() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_DAILY_LIMIT", "40"))
    except ValueError:
        return 40


def _global_daily_limit() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_GLOBAL_DAILY_LIMIT", "2000"))
    except ValueError:
        return 2000


def _et_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.now(timezone.utc) + _ET_OFFSET_FALLBACK).strftime("%Y-%m-%d")


_usage_lock = threading.Lock()
_usage_day = ""
_usage_by_user: dict = {}
_usage_global = 0


def _check_limits(user_id) -> None:
    """Raise 429 if the user or the whole app is over budget for today."""
    global _usage_day, _usage_by_user, _usage_global
    with _usage_lock:
        day = _et_day()
        if day != _usage_day:
            _usage_day, _usage_by_user, _usage_global = day, {}, 0
        if _usage_global >= _global_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="AI research is cooling down for the day — try again tomorrow.",
            )
        if _usage_by_user.get(user_id, 0) >= _user_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="You've hit today's research limit — it resets at midnight ET.",
            )


def _record_billed(user_id) -> None:
    global _usage_global
    with _usage_lock:
        _usage_by_user[user_id] = _usage_by_user.get(user_id, 0) + 1
        _usage_global += 1


class AiSearchIn(BaseModel):
    query: str
    # Cheapest tier by default while we test (base "sonar"). "fast" (sonar-pro) and
    # "reasoning" (sonar-reasoning-pro) are available but cost more — opt in later.
    mode: str = "lite"


@router.post("")
def ai_search(body: AiSearchIn, user: dict = Depends(get_current_user)):
    user_id = user.get("id")
    _check_limits(user_id)
    mode = body.mode if body.mode in ("lite", "fast", "reasoning") else "lite"
    result = perplexity_search.web_search(
        body.query,
        max_tokens=700,
        system=_WIDGET_SYSTEM,
        mode=mode,
        domain_pack="finance",
        related=True,   # Perplexity returns 3-4 related follow-up questions
    )
    # Cached answers cost nothing — only bill the quota for live searches.
    if not result.get("cached"):
        _record_billed(user_id)
    return result
