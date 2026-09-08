"""Company News API.

The client asks UCT for a company's news and gets normalized stories back. It
never learns a provider exists.

    GET /api/company-news/{symbol}

⚠️ THE CORE GUARANTEE: this route reads our own SQLite store and makes ZERO
external provider requests. Ingestion is scheduled and global; user count does
not move provider request volume.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import (
    get_current_user_with_plan, is_paid_user, require_admin)
from api.services.news import sources as news_sources
from api.services.news import store

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/company-news", tags=["company-news"])

def require_member(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Member gate for the Company Panel's News tab.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    (Same rail as `fundamentals.require_paid`.)

    Why gated at all: the store is our own curated, filtered corpus, built from
    plans we pay for. Left open it is a free scraping endpoint for the exact
    product the panel sells. This is NOT an extra paywall inside News — it is
    the same gate Overview, Financials and Earnings already apply, so a member
    who can open the panel can read every tab in it.

    ⛔ The DECISION is `is_paid_user`, never a local re-derivation. This gate
    originally hand-rolled its own plan check and refused real signed-in
    members, because it did not know about admin, 'comped' and trial accounts.
    `meets_plan_gate`'s own docstring warns about exactly this: "two copies of
    one membership predicate drift the moment either one changes and nothing
    catches it."
    """
    if not is_paid_user(user):
        raise HTTPException(
            status_code=402,
            detail="Company Panel news requires an active UCT membership.")
    return user


_ALLOWED_SENTIMENT = {"", "all", "bullish", "bearish"}

# What the panel needs per row. Deliberately not the whole record: §51 says do
# not ship article bodies the collapsed feed will not render.
_SNIPPET_CHARS = 320


def _shape(row: dict[str, Any]) -> dict[str, Any]:
    desc = (row.get("description") or "").strip()
    if len(desc) > _SNIPPET_CHARS:
        desc = desc[:_SNIPPET_CHARS].rsplit(" ", 1)[0] + "…"
    return {
        "id": row.get("id"),
        "headline": row.get("headline") or "",
        "description": desc,
        "source": row.get("source_display") or "",
        "source_class": row.get("source_class") or "",
        "url": row.get("url") or "",
        "published_at": row.get("published_at") or "",
        "category": row.get("category") or "other",
        "sentiment": row.get("sentiment") or "",
        "sentiment_reason": row.get("sentiment_reason") or "",
        "image_url": row.get("image_url") or "",
        "media_type": row.get("media_type") or "",
        "embed_url": row.get("embed_url") or "",
        "form_type": row.get("form_type") or "",
        "author": row.get("author") or "",
        "event_key": row.get("event_key") or "",
        "relevance": row.get("rel") or row.get("relevance") or "",
    }


@router.get("/{symbol}")
def company_news(
    symbol: str,
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None, description="opaque continuation token"),
    sentiment: str = Query("", description="all | bullish | bearish"),
    q: str = Query("", description="full-text search over stored history"),
    category: str = Query("", description="comma-separated categories"),
    source_class: str = Query("", description="comma-separated source classes"),
    _user: dict = Depends(require_member),
) -> dict[str, Any]:
    """One company's feed: reverse chronological, cursor-paginated, from our DB."""
    sym = (symbol or "").upper().strip()
    if not sym or len(sym) > 12:
        raise HTTPException(status_code=400, detail="bad symbol")

    sent = (sentiment or "").lower().strip()
    if sent not in _ALLOWED_SENTIMENT:
        raise HTTPException(status_code=400, detail="bad sentiment filter")
    if sent == "all":
        sent = ""

    cats = [c.strip().lower() for c in (category or "").split(",") if c.strip()]
    classes = [c.strip().lower() for c in (source_class or "").split(",") if c.strip()]

    try:
        page = store.feed(sym, limit=limit, cursor=cursor, sentiment=sent,
                          categories=cats, source_classes=classes,
                          query=(q or "").strip())
    except Exception as e:                            # noqa: BLE001
        _log.exception("company-news feed failed for %s", sym)
        raise HTTPException(status_code=503, detail="news unavailable") from e

    items = [_shape(r) for r in page["items"]]
    return {
        "symbol": sym,
        "items": items,
        "next_cursor": page["next_cursor"],
        "has_more": page["has_more"],
        "query": (q or "").strip(),
        "sentiment": sent or "all",
        "count": len(items),
    }


@router.get("/{symbol}/related/{news_id}")
def related_coverage(symbol: str, news_id: int,
                     _user: dict = Depends(require_member)) -> dict[str, Any]:
    """Other outlets that covered the same event — for the expanded row."""
    sym = (symbol or "").upper().strip()
    if not sym:
        raise HTTPException(status_code=400, detail="bad symbol")
    try:
        page = store.feed(sym, limit=1, cursor=None)
        row = next((r for r in page["items"] if int(r["id"]) == int(news_id)), None)
        key = row.get("event_key") if row else ""
        if not key:
            import contextlib
            with contextlib.closing(store._connect()) as c:   # noqa: SLF001
                r = c.execute("SELECT event_key FROM news_items WHERE id=?",
                              (int(news_id),)).fetchone()
                key = r["event_key"] if r else ""
        return {"items": store.related_for_event(key, int(news_id)) if key else []}
    except HTTPException:
        raise
    except Exception:                                 # noqa: BLE001
        return {"items": []}


@router.get("/{symbol}/summary")
def summary(symbol: str,
            _user: dict = Depends(require_member)) -> dict[str, Any]:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise HTTPException(status_code=400, detail="bad symbol")
    try:
        return {"symbol": sym, **store.counts_for(sym),
                "newest": store.newest_published(sym)}
    except Exception:                                 # noqa: BLE001
        return {"symbol": sym, "total": 0, "bullish": 0, "bearish": 0, "newest": ""}


# ---------------------------------------------------------------------------
# operations (§43, §44) — not member-facing
# ---------------------------------------------------------------------------
# ⛔ ADMIN ONLY. Two of these trigger provider ingestion and one exposes
# internal source health, publisher mix and database paths. Left open,
# `POST /ingest` is an unauthenticated way for anyone on the internet to spend
# our FMP and SEC budget.
ops_router = APIRouter(prefix="/api/company-news-ops", tags=["company-news"],
                       dependencies=[Depends(require_admin)])


@ops_router.get("/health")
def health() -> dict[str, Any]:
    """Content health, not just HTTP health.

    A provider can fail semantically while returning 200 — Massive's publisher
    mix changed underneath us across 13 quarters. `publisher_mix` is here so a
    feed that silently loses Reuters is visible.
    """
    snap = store.health_snapshot()
    snap["registry"] = news_sources.known_publishers()
    return snap


@ops_router.post("/ingest")
def trigger_ingest(symbols: str = Query("", description="comma-separated")) -> dict[str, Any]:
    from api.services.news import ingest
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    return ingest.run_all(syms or None)


@ops_router.post("/warm/{symbol}")
def warm(symbol: str) -> dict[str, Any]:
    from api.services.news import ingest
    return ingest.ensure_symbol(symbol)


@ops_router.get("/verify-latest")
def verify_latest() -> dict[str, Any]:
    """§4: is FMP's global `-latest` ingestion path available?"""
    from api.services.news.adapters import fmp_news
    fmp_news.reset_latest_cache()
    return fmp_news.probe_latest(fmp_news.RequestBudget(4, "verify"))
