"""api/routers/cot.py — COT Data API endpoints.

Routes:
    GET  /api/cot/symbols         → grouped symbol list
    GET  /api/cot/status          → last_updated, next refresh, record count
    POST /api/cot/refresh         → manual refresh (background task)
    GET  /api/cot/{symbol}        → weekly records for a symbol
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from api.services import cot_service

router = APIRouter(prefix="/api/cot", tags=["cot"])


@router.get("/symbols")
def get_symbols():
    """Return full grouped symbol list with display names."""
    return {
        "groups": {
            group: [
                {"symbol": s, "name": cot_service.SYMBOL_NAMES.get(s, s)}
                for s in syms
            ]
            for group, syms in cot_service.SYMBOL_GROUPS.items()
        }
    }


@router.get("/status")
def get_status():
    """Return last refresh timestamp, next scheduled Friday, and total record count."""
    return cot_service.get_status()


@router.post("/refresh")
def manual_refresh(background_tasks: BackgroundTasks):
    """Trigger a COT data refresh in the background. Returns immediately."""
    background_tasks.add_task(cot_service.refresh_from_current)
    return {"status": "refresh started"}


@router.get("/{symbol}")
def get_cot(symbol: str, weeks: int = 52):
    """Return the last `weeks` weekly COT records for `symbol`, ascending by date."""
    sym = symbol.upper()
    if sym not in cot_service.SYMBOL_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown COT symbol: {sym}")
    if not 1 <= weeks <= 520:
        raise HTTPException(status_code=400, detail="weeks must be between 1 and 520")
    return cot_service.get_cot_data(sym, weeks)
