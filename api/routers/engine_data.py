"""The daily wire surface — breadth, themes, Leadership 20, the rundown, UCT20.

🔴 EVERY ROUTE HERE WAS ANONYMOUS until 2026-08-09. Measured in the auth/paywall
sweep: `/api/uct20/portfolio` **29,251 bytes** (NAV, open positions, entries,
STOPS, full trade history), `/api/uct20/backtest` **31,464 bytes**,
`/api/leadership` the Leadership 20 itself. This is the firm's product, not a
market-data relay — it is what the morning wire run produces — so it is PAID.

✋ TWO ROUTES ARE DELIBERATELY *NOT* PAID: `/api/rundown` and
`/api/rundown/speech-text`.

`FREE_PAGES = ['/morning-wire']` (AuthGuard.jsx / NavBar.jsx / MoreSheet.jsx, all
three in sync) — the Morning Wire is the free tier, by owner decision, and it is
the top of the funnel. These two routes ARE that page's content. Gating them on
`require_paid` would refuse every free member the one thing they were invited in
to read, so it would not be a paywall fix; it would be a funnel outage.

They are gated on `get_current_user` instead — which is exactly the boundary the
page already has, since `AuthGuard` renders nothing without a session, and it is
what every OTHER route on that page already uses (`/api/tweets/feed`,
`/api/catalysts/today`, `/api/wire-feedback/*` are all `get_current_user`). The
rundown was the odd one out: the only anonymous route on a logged-in-only page.
So this closes the crawler hole and changes nothing a member experiences.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
    is_paid_user,
)
from api.services.engine import get_breadth, get_themes, get_leadership, get_rundown, get_uct20_portfolio_data, get_uct20_backtest_data, get_analyst_actions, _load_wire_data
from api.services.cache import cache as _cache

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the daily wire surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The daily wire surface requires a paid plan")
    return user


def _expected_wire_date():
    """The most recent ET trading day whose wire run should have landed.

    The wire lands ~7:35 AM ET on weekdays; give it until 9:30 AM ET before
    expecting today's list. Weekends expect Friday's list. (Holiday-naive:
    a market holiday shows as one calendar day of 'stale' — acceptable.)
    """
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("America/New_York"))
    d = now.date()
    if now.weekday() < 5 and (now.hour, now.minute) < (9, 30):
        d = d - timedelta(days=1)
    while d.weekday() >= 5:          # roll weekend back to Friday
        d = d - timedelta(days=1)
    return d


def _leadership_status(stocks, wire_date_str):
    """Classify freshness of the leadership payload against the trading
    calendar (the old 26-hour rule cried stale every weekend).

    - "no_data" — no stocks and no wire timestamp
    - "fresh"   — the list is from the last expected trading-day run
    - "stale"   — a trading-day run was missed
    """
    if not stocks and not wire_date_str:
        return "no_data"
    if not wire_date_str:
        return "stale" if not stocks else "fresh"
    try:
        wire_d = datetime.fromisoformat(str(wire_date_str)[:10]).date()
    except (ValueError, TypeError):
        return "fresh" if stocks else "no_data"
    return "fresh" if wire_d >= _expected_wire_date() else "stale"


@router.get("/api/breadth")
def breadth(_user: dict = Depends(require_paid)):
    try:
        return get_breadth()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/themes")
def themes(period: str = Query("1W"),
           _user: dict = Depends(require_paid)):
    try:
        result = get_themes(period)
        try:
            from api.routers.bars import warm_bars_async
            from api.services.theme_performance import looks_like_ticker
            tickers: set[str] = set()
            for bucket in ("leaders", "laggards"):
                for theme in (result.get(bucket) or []):
                    etf = theme.get("ticker")
                    if etf and etf != "UCT20" and looks_like_ticker(etf.upper()):
                        tickers.add(etf.upper())
                    for h in (theme.get("holdings") or []):
                        sym = h if isinstance(h, str) else h.get("sym") if isinstance(h, dict) else None
                        if sym:
                            tickers.add(sym.upper())
            if tickers:
                warm_bars_async(list(tickers), tf="D", bars=8000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/leadership")
def leadership(_user: dict = Depends(require_paid)):
    try:
        result = get_leadership()
        # Backwards-compatible normalization: get_leadership() returns a list,
        # but historically downstream callers (and a buggy empty cache) could
        # surface a dict. Coerce into a list of stocks for the new wrapped shape.
        if isinstance(result, list):
            stocks = result
        elif isinstance(result, dict):
            stocks = result.get("list") or result.get("picks") or result.get("stocks") or []
        else:
            stocks = []

        try:
            from api.routers.bars import warm_bars_async
            tickers = [
                (p.get("sym") or p.get("ticker")).upper()
                for p in stocks if isinstance(p, dict) and (p.get("sym") or p.get("ticker"))
            ]
            if tickers:
                warm_bars_async(tickers, tf="D", bars=8000)
        except Exception:
            pass

        # Derive freshness from wire_data timestamp so the UI can show a
        # useful empty-state ("refreshes daily at 7:35 AM ET") instead of a
        # bare empty array when the morning wire push hasn't landed.
        wire = _load_wire_data() or {}
        wire_date = wire.get("date") or wire.get("generated_at") or None
        status = _leadership_status(stocks, wire_date)

        # Publish-gate status from the engine: a "held" run serves the last
        # known-good list — surface that honestly instead of implying fresh.
        meta = wire.get("leadership_meta") or {}
        if isinstance(meta, dict) and meta.get("status") in ("held", "degraded"):
            status = meta["status"]

        return {
            "stocks": stocks,
            "last_updated": wire_date,
            "status": status,
            "meta": meta if isinstance(meta, dict) else {},
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/rundown")
def rundown(type: Optional[str] = Query(None),
            _user: dict = Depends(get_current_user)):
    try:
        if type == "post_market":
            return {"html": "", "date": ""}  # post-market not yet implemented
        return get_rundown()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/rundown/speech-text")
def rundown_speech_text(_user: dict = Depends(get_current_user)):
    """Canonical Read-Aloud text for today's rundown: the briefing (Today's
    Focus + narrative), widgets stripped. The frontend speaks THIS so it matches
    the pre-warmed audio exactly; the `sentences` list drives follow-along
    highlighting. Returns empty strings (not an error) when no rundown is loaded."""
    from api.services.rundown_speech import extract_rundown_speech_text, split_sentences
    try:
        r = get_rundown()
    except Exception:
        r = None
    html = (r or {}).get("html", "") if isinstance(r, dict) else ""
    text = extract_rundown_speech_text(html)
    return {
        "date": (r or {}).get("date", "") if isinstance(r, dict) else "",
        "text": text,
        "sentences": split_sentences(text),
    }


@router.get("/api/uct20/portfolio")
def uct20_portfolio(_user: dict = Depends(require_paid)):
    try:
        return get_uct20_portfolio_data()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/uct20/backtest")
def uct20_backtest(_user: dict = Depends(require_paid)):
    try:
        return get_uct20_backtest_data()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/intraday-update")
def intraday_update(_user: dict = Depends(require_paid)):
    """Return the latest intraday update from autonomous_brain, if any."""
    data = _cache.get("intraday_update")
    return data or {}


@router.get("/api/analyst-actions")
def analyst_actions(_user: dict = Depends(require_paid)):
    try:
        return get_analyst_actions()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
