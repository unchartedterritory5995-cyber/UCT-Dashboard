from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from api.services.engine import get_breadth, get_themes, get_leadership, get_rundown, get_uct20_portfolio_data, get_uct20_backtest_data, get_analyst_actions
from api.services.cache import cache as _cache

router = APIRouter()


@router.get("/api/breadth")
def breadth():
    try:
        return get_breadth()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/themes")
def themes(period: str = Query("1W")):
    try:
        return get_themes(period)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/leadership")
def leadership():
    try:
        result = get_leadership()
        try:
            from api.routers.bars import warm_bars_async
            picks = result if isinstance(result, list) else (result.get("list") or result.get("picks") or [])
            tickers = [
                (p.get("sym") or p.get("ticker")).upper()
                for p in picks if isinstance(p, dict) and (p.get("sym") or p.get("ticker"))
            ]
            if tickers:
                warm_bars_async(tickers, tf="D", bars=5000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/rundown")
def rundown(type: Optional[str] = Query(None)):
    try:
        if type == "post_market":
            return {"html": "", "date": ""}  # post-market not yet implemented
        return get_rundown()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/uct20/portfolio")
def uct20_portfolio():
    try:
        return get_uct20_portfolio_data()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/uct20/backtest")
def uct20_backtest():
    try:
        return get_uct20_backtest_data()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/intraday-update")
def intraday_update():
    """Return the latest intraday update from autonomous_brain, if any."""
    data = _cache.get("intraday_update")
    return data or {}


@router.get("/api/analyst-actions")
def analyst_actions():
    try:
        return get_analyst_actions()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
