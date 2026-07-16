"""AI Search widget — ask anything about markets, get a cited answer.

POST /api/ai-search  { query, mode? }  ->  { answer, citations, model, elapsed_ms, ... }

Backed by Perplexity (web-search-grounded), so answers use current data + sources.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import perplexity_search

router = APIRouter(prefix="/api/ai-search", tags=["ai-search"])

_WIDGET_SYSTEM = (
    "You are a sharp, decisive markets & trading research assistant for a senior "
    "swing trader. Answer the question directly and specifically. Cite concrete "
    "numbers, dates, tickers, and firm names. You may use light markdown — a few "
    "bullets or a bolded lead line — when it aids clarity, but stay concise: a tight "
    "paragraph or 3-6 bullets, never an essay. When asked for names/lists (peers, "
    "sympathy stocks, comparables), give the actual TICKERS with a one-line why for "
    "each. If sources disagree or the data is thin, say so plainly. No hedging, no "
    "filler, no restating the question."
)


class AiSearchIn(BaseModel):
    query: str
    # Cheapest tier by default while we test (base "sonar"). "fast" (sonar-pro) and
    # "reasoning" (sonar-reasoning-pro) are available but cost more — opt in later.
    mode: str = "lite"


@router.post("")
def ai_search(body: AiSearchIn, user: dict = Depends(get_current_user)):
    mode = body.mode if body.mode in ("lite", "fast", "reasoning") else "lite"
    return perplexity_search.web_search(
        body.query,
        max_tokens=700,
        system=_WIDGET_SYSTEM,
        mode=mode,
        domain_pack="finance",
        related=True,   # Perplexity returns 3-4 related follow-up questions
    )
