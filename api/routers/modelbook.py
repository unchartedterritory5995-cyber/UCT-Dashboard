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
    company_desc: Optional[str] = None
    run_story: Optional[str] = None


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
    # Auto-generate the company/story descriptions on first view (background).
    if not stock.get("company_desc") and _is_final_year(stock.get("year", 0)):
        _gen_desc_async(stock)
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

    stats = {"open_close_pct": None, "low_high_pct": None, "avg_vol": None}
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
            vols = [b["v"] for b in yb if b.get("v") is not None]
            if o:
                stats["open_close_pct"] = round((c - o) / o * 100, 1)
            if lows and highs and min(lows):
                stats["low_high_pct"] = round((max(highs) - min(lows)) / min(lows) * 100, 1)
            if vols:
                stats["avg_vol"] = round(sum(vols) / len(vols))
    except Exception:
        pass

    cache.set(ckey, stats, ttl=86400)  # 24h; full-year stats don't change
    return stats


def _is_final_year(year: int) -> bool:
    """Past calendar years are closed — their stats never change, so they can be
    persisted permanently. The current/future year must be recomputed."""
    from datetime import datetime, timezone
    return int(year) < datetime.now(timezone.utc).year


import threading as _threading
_warm_lock = _threading.Lock()
_warming_years = set()  # years with a background warm in flight (dedupe)


def _persist_stats_for(stocks, max_workers=2):
    """Compute + persist stats for the given stock rows that lack them.
    Low concurrency to avoid bars-SQLite write contention on the web pod.
    Only valid (non-None) results are persisted, so transient fetch failures
    retry on the next pass instead of sticking as a blank '—' forever."""
    import concurrent.futures
    # Recompute when the gain OR the (newer) avg_vol stat is missing — so adding
    # a new stat backfills existing rows instead of leaving them blank.
    pending = [s for s in stocks if s.get("oc_pct") is None or s.get("avg_vol") is None]
    if not pending:
        return

    def _work(s):
        try:
            st = _compute_year_stats(s["symbol"], s["year"])
            oc = st.get("open_close_pct")
            if oc is not None:  # don't persist failures
                svc.save_stats(s["id"], oc, st.get("low_high_pct"), st.get("avg_vol"))
        except Exception:
            pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, pending))


def _warm_year_async(year: int):
    """Kick off a deduped background warm for one year. Non-blocking."""
    with _warm_lock:
        if year in _warming_years:
            return
        _warming_years.add(year)

    def _run():
        try:
            _persist_stats_for(svc.get_stocks_for_year(year))
        finally:
            with _warm_lock:
                _warming_years.discard(year)
    _threading.Thread(target=_run, daemon=True, name=f"mb-warm-{year}").start()


@router.get("/year-stats")
def year_stats(year: int = Query(...), _user: dict = Depends(get_current_user)):
    """Per-stock year price stats (open→close %, low→high %), keyed by symbol.

    ALWAYS instant: returns whatever is persisted on the stock rows (a plain DB
    read). Anything not yet computed comes back null and is filled by a deduped
    background warm — the frontend polls until it lands, then it's persisted
    permanently (closed-year stats never change)."""
    stocks = svc.get_stocks_for_year(year)
    final = _is_final_year(year)
    out = {}
    needWarm = False
    for s in stocks:
        oc = s.get("oc_pct")
        if oc is not None:
            out[s["symbol"]] = {"open_close_pct": oc, "low_high_pct": s.get("lh_pct")}
        else:
            out[s["symbol"]] = {"open_close_pct": None, "low_high_pct": None}
        if oc is None or s.get("avg_vol") is None:  # backfill gain and/or volume
            needWarm = True
    if needWarm and final:
        _warm_year_async(year)
    return {"year": year, "stats": out}


# ── AI-generated descriptions (company one-liner + "why it ran that year") ────

import os as _os
_DESC_ENABLED = _os.environ.get("MODELBOOK_DESC_ENABLED", "1") == "1"
_DESC_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")
_gen_lock = _threading.Lock()
_generating = set()  # stock ids with a description generation in flight


def _generate_descriptions(symbol, company, year, gain_pct):
    """Claude → {company_desc, run_story}. One sentence on what the company does +
    a brief, factual reason it made its big move that year. Returns None on failure."""
    if not _DESC_ENABLED:
        return None
    import json as _json
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        gain_txt = f"about {round(gain_pct)}%" if gain_pct is not None else "a large amount"
        system = ("You write concise, factual stock study notes for a trader's model book. "
                  "Output JSON only — no preamble, no markdown fences.")
        prompt = (
            f"Stock: {symbol} ({company or symbol}). Calendar year: {year}. "
            f"The stock rose {gain_txt} that year.\n\n"
            'Return JSON exactly: {"company_desc": "...", "run_story": "..."}\n'
            "- company_desc: ONE plain sentence on what the company does.\n"
            "- run_story: 2-3 sentences on WHY the stock made its big move that year — "
            "the specific catalysts/drivers, or the broader market theme it rode. "
            "Be factual and specific to that year; if unsure of specifics, describe the "
            "dominant theme/driver. No price targets, no buy/sell advice."
        )
        msg = client.messages.create(
            model=_DESC_MODEL, max_tokens=400, temperature=0.4,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        s, e = text.find("{"), text.rfind("}")
        if s == -1 or e == -1:
            return None
        obj = _json.loads(text[s:e + 1])
        cd = (obj.get("company_desc") or "").strip()
        rs = (obj.get("run_story") or "").strip()
        return {"company_desc": cd, "run_story": rs} if (cd or rs) else None
    except Exception:
        return None


def _generate_descriptions_for(stocks, max_workers=3):
    pending = [s for s in stocks if not s.get("company_desc")]
    if not pending:
        return
    import concurrent.futures

    def _work(s):
        d = _generate_descriptions(s["symbol"], s.get("company"), s["year"], s.get("oc_pct"))
        if d:
            try:
                svc.save_descriptions(s["id"], d["company_desc"], d["run_story"])
            except Exception:
                pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(_work, pending))


def _gen_desc_async(stock):
    """Deduped background generation of one stock's descriptions."""
    sid = stock.get("id")
    if not sid or not _DESC_ENABLED:
        return
    with _gen_lock:
        if sid in _generating:
            return
        _generating.add(sid)

    def _run():
        try:
            d = _generate_descriptions(stock["symbol"], stock.get("company"),
                                       stock["year"], stock.get("oc_pct"))
            if d:
                svc.save_descriptions(sid, d["company_desc"], d["run_story"])
        finally:
            with _gen_lock:
                _generating.discard(sid)
    _threading.Thread(target=_run, daemon=True, name=f"mb-desc-{sid}").start()


def warm_all_stats() -> None:
    """Background pre-warm at startup: compute + persist price stats AND generate
    AI descriptions for every curated stock in a closed year that lacks them. Low
    concurrency + a delay past the startup bars-resync window. Re-checks once more
    after a longer delay to catch transients."""
    import time as _time
    for delay in (35, 120):
        _time.sleep(delay)
        try:
            stocks = [s for s in svc.get_all_stocks() if _is_final_year(s["year"])]
        except Exception:
            continue
        stats_done = all(s.get("oc_pct") is not None and s.get("avg_vol") is not None for s in stocks)
        desc_done = all(s.get("company_desc") for s in stocks) or not _DESC_ENABLED
        if stats_done and desc_done:
            return  # fully warmed
        if not stats_done:
            _persist_stats_for(stocks, max_workers=2)
            try:
                stocks = [s for s in svc.get_all_stocks() if _is_final_year(s["year"])]
            except Exception:
                pass
        _generate_descriptions_for(stocks)


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
