"""Token-gated public data for the headless render pages (/r/catalysts, /r/calendar).

The Morning Wire → Substack renderer screenshots the /r/* pages in a logged-OUT
headless browser. `/api/calendar` and `/api/ticker-logo` are already public, but
`/api/catalysts/today` is auth-gated — so this exposes the SAME catalyst rows
behind a shared render token (CHART_RENDER_TOKEN, the backend twin of the
frontend's VITE_CHART_RENDER_TOKEN). Read-only, no side effects.
"""

from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from api.services.catalyst import store as catalyst_store

router = APIRouter(prefix="/api", tags=["render"])


def _et_today() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _check_token(token: str) -> None:
    want = os.environ.get("CHART_RENDER_TOKEN", "")
    if not want or token != want:
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/r/catalysts")
def render_catalysts(token: str = "", n: int = 3, date: str = ""):
    """Top-N ranked Stock Catalysts for today (or `date`) — token-gated public read."""
    _check_token(token)
    md = date or _et_today()
    rows = catalyst_store.get_for_date(md) or []
    if not rows and not date:  # weekend / pre-first-run: walk back to the last day with data
        from datetime import date as _d, timedelta
        base = _d.fromisoformat(md)
        for back in range(1, 6):
            prev = (base - timedelta(days=back)).isoformat()
            rows = catalyst_store.get_for_date(prev) or []
            if rows:
                md = prev
                break
    n = max(1, min(int(n or 3), 80))  # up to 80 so the newsletter can build a movers→news map
    return {"market_date": md, "rows": rows[:n]}


@router.get("/r/tweets")
def render_tweets(token: str = "", n: int = 5, hours: int = 18):
    """Top-N recent notable tweets that mention tickers — token-gated public read.

    Prefers tweets carrying cashtags (ticker links), newest first; the newsletter
    screenshots /r/tweets into a 'Top Tweets' panel.
    """
    _check_token(token)
    try:
        from api.services import tweet_store
        rows = tweet_store.feed(hours=int(hours or 18), limit=60) or []
    except Exception:  # noqa: BLE001
        rows = []
    with_tickers = [t for t in rows if t.get("tickers")]
    picked = (with_tickers or rows)[: max(1, min(int(n or 5), 10))]
    out = [{
        "author_handle": t.get("author_handle"),
        "author_name": t.get("author_name"),
        "text": t.get("text"),
        "tickers": t.get("tickers", []),
        "created_at": t.get("created_at"),
        "like_count": t.get("like_count"),
    } for t in picked]
    return {"tweets": out}
