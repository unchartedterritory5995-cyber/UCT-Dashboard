from fastapi import APIRouter, HTTPException
from api.services.engine import get_screener, get_candidates
from api.services import breadth_monitor as bm_svc

router = APIRouter()


@router.get("/api/screener")
def screener():
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/candidates")
def candidates():
    try:
        result = get_candidates()
        try:
            from api.routers.bars import warm_bars_async
            cands = result.get("candidates") or result
            tickers = []
            for group in cands.values():
                if isinstance(group, list):
                    for c in group:
                        sym = (c.get("sym") or c.get("ticker")) if isinstance(c, dict) else None
                        if sym:
                            tickers.append(sym.upper())
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=5000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/scanner/universe")
def scanner_universe():
    """Pool all breadth list fields (52W highs, Stage 2, HVC, etc.) into a unified scanner universe."""
    try:
        return bm_svc.get_universe_stocks()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
