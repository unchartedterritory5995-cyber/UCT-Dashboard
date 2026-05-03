from fastapi import APIRouter, HTTPException
from api.services.massive import get_movers, get_extended_movers

router = APIRouter()


@router.get("/api/movers")
def movers():
    try:
        result = get_movers()
        try:
            from api.routers.bars import warm_bars_async
            tickers = []
            for bucket in ("ripping", "drilling"):
                for item in (result.get(bucket) or []):
                    sym = item.get("sym") if isinstance(item, dict) else None
                    if sym:
                        tickers.append(sym.upper())
            if tickers:
                warm_bars_async(tickers, tf="D", bars=8000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/extended-movers")
def extended_movers():
    try:
        return get_extended_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
