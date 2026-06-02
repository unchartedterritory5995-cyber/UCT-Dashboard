"""api/routers/modelbook.py — Model Book API.

A curated library of the best stocks in history, organized by year, with the
firm's playbook setups labeled on each stock's chart.

Reads are open to any logged-in user (Model Book is a FREE_PAGE). Writes
(curating stocks + labeling setups) are admin-only — mirrors the auth pattern
in api/routers/catalysts.py (get_current_user vs require_admin).

Routes:
    GET    /api/modelbook/years                    → [2025, 2024, ...]
    GET    /api/modelbook/stocks?year=2025          → curated stocks for a year
    GET    /api/modelbook/stock/{stock_id}          → stock + its setups[]
    POST   /api/modelbook/stocks                     → add stock          (admin)
    PUT    /api/modelbook/stock/{stock_id}          → edit stock         (admin)
    DELETE /api/modelbook/stock/{stock_id}          → remove stock       (admin)
    POST   /api/modelbook/stock/{stock_id}/setups   → label a setup      (admin)
    PUT    /api/modelbook/setup/{setup_id}          → edit a setup       (admin)
    DELETE /api/modelbook/setup/{setup_id}          → remove a setup     (admin)
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import modelbook_service as svc

router = APIRouter(prefix="/api/modelbook", tags=["modelbook"])

_GRADES = {"A+", "A", "B", "C", "F"}
_TIMEFRAMES = {"D", "W"}
_MARKER_SIDES = {"aboveBar", "belowBar"}
_MARKER_SHAPES = {"arrowUp", "arrowDown", "circle", "square"}
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ── Pydantic payloads ─────────────────────────────────────────────────────────

class StockIn(BaseModel):
    year: int
    symbol: str
    company: Optional[str] = None
    sort_order: Optional[int] = 0
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None


class StockPatch(BaseModel):
    year: Optional[int] = None
    symbol: Optional[str] = None
    company: Optional[str] = None
    sort_order: Optional[int] = None
    thesis: Optional[str] = None
    gain_pct: Optional[float] = None


class SetupIn(BaseModel):
    setup_type: str
    label_date: str
    timeframe: Optional[str] = "D"
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    marker_side: Optional[str] = "belowBar"
    marker_shape: Optional[str] = "arrowUp"


class SetupPatch(BaseModel):
    setup_type: Optional[str] = None
    label_date: Optional[str] = None
    timeframe: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    marker_side: Optional[str] = None
    marker_shape: Optional[str] = None


def _validate_setup(d: dict) -> None:
    """Validate the enum/format fields present in a setup payload → 400 on bad."""
    if d.get("label_date") is not None and not _ISO_DATE.match(d["label_date"]):
        raise HTTPException(400, "label_date must be YYYY-MM-DD")
    if d.get("timeframe") is not None and d["timeframe"] not in _TIMEFRAMES:
        raise HTTPException(400, f"timeframe must be one of {sorted(_TIMEFRAMES)}")
    if d.get("grade") not in (None, "") and d["grade"] not in _GRADES:
        raise HTTPException(400, f"grade must be one of {sorted(_GRADES)}")
    if d.get("marker_side") is not None and d["marker_side"] not in _MARKER_SIDES:
        raise HTTPException(400, f"marker_side must be one of {sorted(_MARKER_SIDES)}")
    if d.get("marker_shape") is not None and d["marker_shape"] not in _MARKER_SHAPES:
        raise HTTPException(400, f"marker_shape must be one of {sorted(_MARKER_SHAPES)}")


# ── Reads (any logged-in user) ────────────────────────────────────────────────

@router.get("/years")
def get_years(_user: dict = Depends(get_current_user)):
    return {"years": svc.list_years()}


@router.get("/stocks")
def get_stocks(year: int = Query(...), _user: dict = Depends(get_current_user)):
    return {"year": year, "stocks": svc.get_stocks_for_year(year)}


@router.get("/stock/{stock_id}")
def get_stock(stock_id: int, _user: dict = Depends(get_current_user)):
    stock = svc.get_stock_detail(stock_id)
    if not stock:
        raise HTTPException(404, "Stock not found")
    return stock


def _compute_year_stats(symbol: str, year: int) -> dict:
    """For a (symbol, year): % move from year open→close, and from year
    low→high. Computed from daily bars and cached (closed-year stats are
    static). Returns {open_close_pct, low_high_pct} (None when unavailable)."""
    import json
    from api.services.cache import cache
    from api.services import bars_fetch

    ckey = f"modelbook_yearstats_{symbol.upper()}_{year}"
    cached = cache.get(ckey)
    if cached is not None:
        return cached

    stats = {"open_close_pct": None, "low_high_pct": None}
    try:
        resp = bars_fetch._get_bars_inner(symbol, "D", 5000)
        body = getattr(resp, "body", None)
        data = json.loads(body) if body is not None else (resp if isinstance(resp, dict) else {})
        ystr = str(year)
        yb = [b for b in data.get("bars", []) if str(b.get("t", "")).startswith(ystr)]
        yb.sort(key=lambda b: b.get("t", ""))  # 'YYYY-MM-DD' sorts chronologically
        if yb:
            o = yb[0].get("o")
            c = yb[-1].get("c")
            lows = [b["l"] for b in yb if b.get("l") is not None]
            highs = [b["h"] for b in yb if b.get("h") is not None]
            if o:
                stats["open_close_pct"] = round((c - o) / o * 100, 1)
            if lows and highs and min(lows):
                stats["low_high_pct"] = round((max(highs) - min(lows)) / min(lows) * 100, 1)
    except Exception:
        pass

    cache.set(ckey, stats, ttl=86400)  # 24h; full-year stats don't change
    return stats


def _is_final_year(year: int) -> bool:
    """Past calendar years are closed — their stats never change, so they can be
    persisted permanently. The current/future year must be recomputed."""
    from datetime import datetime, timezone
    return int(year) < datetime.now(timezone.utc).year


@router.get("/year-stats")
def year_stats(year: int = Query(...), _user: dict = Depends(get_current_user)):
    """Per-stock year price stats (open→close %, low→high %), keyed by symbol.

    Fast path: closed-year stats persisted on the stock row are returned instantly.
    Cold path: compute the missing ones in PARALLEL (not one-by-one) and persist."""
    import concurrent.futures

    stocks = svc.get_stocks_for_year(year)
    final = _is_final_year(year)
    out = {}
    to_compute = []
    for s in stocks:
        if final and s.get("oc_pct") is not None:
            out[s["symbol"]] = {"open_close_pct": s["oc_pct"], "low_high_pct": s.get("lh_pct")}
        else:
            to_compute.append(s)

    if to_compute:
        def _work(s):
            return s, _compute_year_stats(s["symbol"], year)
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(to_compute))) as ex:
            for s, st in ex.map(_work, to_compute):
                out[s["symbol"]] = st
                if final:
                    try:
                        svc.save_stats(s["id"], st.get("open_close_pct"), st.get("low_high_pct"))
                    except Exception:
                        pass

    return {"year": year, "stats": out}


def warm_all_stats() -> None:
    """Background pre-warm: compute + persist year stats for every curated stock
    in a closed year that doesn't have them yet, in parallel. Run at startup so
    the gallery's gain column is instant for users instead of ~30s on first open.
    A short delay lets the bars infrastructure settle first."""
    import concurrent.futures
    import time as _time
    _time.sleep(20)
    try:
        stocks = svc.get_all_stocks()
    except Exception:
        return
    pending = [s for s in stocks if _is_final_year(s["year"]) and s.get("oc_pct") is None]
    if not pending:
        return

    def _work(s):
        try:
            st = _compute_year_stats(s["symbol"], s["year"])
            svc.save_stats(s["id"], st.get("open_close_pct"), st.get("low_high_pct"))
        except Exception:
            pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(_work, pending))


# ── Writes (admin only) ───────────────────────────────────────────────────────

@router.post("/stocks")
def add_stock(payload: StockIn, _admin: dict = Depends(require_admin)):
    if not payload.symbol.strip():
        raise HTTPException(400, "symbol is required")
    return svc.create_stock(payload.model_dump())


@router.put("/stock/{stock_id}")
def edit_stock(stock_id: int, payload: StockPatch, _admin: dict = Depends(require_admin)):
    stock = svc.update_stock(stock_id, payload.model_dump(exclude_unset=True))
    if not stock:
        raise HTTPException(404, "Stock not found")
    return stock


@router.delete("/stock/{stock_id}")
def remove_stock(stock_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_stock(stock_id):
        raise HTTPException(404, "Stock not found")
    return {"deleted": stock_id}


@router.post("/stock/{stock_id}/setups")
def add_setup(stock_id: int, payload: SetupIn, _admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    _validate_setup(data)
    setup = svc.create_setup(stock_id, data)
    if setup is None:
        raise HTTPException(404, "Stock not found")
    return setup


@router.put("/setup/{setup_id}")
def edit_setup(setup_id: int, payload: SetupPatch, _admin: dict = Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    _validate_setup(data)
    setup = svc.update_setup(setup_id, data)
    if not setup:
        raise HTTPException(404, "Setup not found")
    return setup


@router.delete("/setup/{setup_id}")
def remove_setup(setup_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_setup(setup_id):
        raise HTTPException(404, "Setup not found")
    return {"deleted": setup_id}
