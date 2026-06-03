"""api/routers/breadth_monitor.py

GET  /api/breadth-monitor         — history (last 90 rows)
GET  /api/breadth-monitor/latest  — most recent row
POST /api/breadth-monitor/push    — store new snapshot (auth required)
"""

import os
from fastapi import APIRouter, HTTPException, Request
from api.services import breadth_monitor as svc
from api.services.breadth_analogues import find_analogues, invalidate_cache as invalidate_analogues_cache

router = APIRouter()

_PUSH_SECRET = os.environ.get("PUSH_SECRET", "")


def _check_auth(request: Request) -> None:
    if not _PUSH_SECRET:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {_PUSH_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Init DB on import ──────────────────────────────────────────────────────────
try:
    svc.init_db()
except Exception as _e:
    print(f"[breadth_monitor] DB init warning: {_e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/breadth-monitor")
def get_breadth_history(days: int = 90):
    try:
        return {"rows": svc.get_history(days), "days": days}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/analogues")
def get_breadth_analogues():
    """Return top 5 historical dates most similar to current breadth regime."""
    try:
        result = find_analogues()
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/latest")
def get_breadth_latest():
    row = svc.get_latest()
    if row is None:
        raise HTTPException(status_code=404, detail="No breadth data yet")
    return row


@router.post("/api/breadth-monitor/push")
async def push_breadth_snapshot(request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    date_str = body.get("date")
    metrics = body.get("metrics") or body  # accept flat payload too

    if not date_str:
        raise HTTPException(status_code=400, detail="'date' field required")

    ok = svc.store_snapshot(date_str, metrics)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to store snapshot")

    invalidate_analogues_cache()

    # Warm bars for every ticker in every _list field of this snapshot so
    # Breadth drill charts load instantly for the new day's data.
    try:
        from api.routers.bars import warm_bars_async
        seen: set[str] = set()
        for k, v in metrics.items():
            if not k.endswith("_list") or not isinstance(v, list):
                continue
            for item in v:
                sym = item.get("t") if isinstance(item, dict) else None
                if sym:
                    seen.add(sym.upper())
        if seen:
            warm_bars_async(list(seen), tf="D", bars=8000)
    except Exception:
        pass

    return {"status": "ok", "date": date_str, "keys": len(metrics)}


@router.delete("/api/breadth-monitor/{date_str}")
async def delete_breadth_snapshot(date_str: str, request: Request):
    _check_auth(request)
    ok = svc.delete_snapshot(date_str)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "deleted", "date": date_str}


@router.get("/api/breadth-monitor/{date_str}/drill/{metric_key}")
def get_drill_list(date_str: str, metric_key: str):
    items = svc.get_drill_list(date_str, metric_key)
    if items is None:
        raise HTTPException(status_code=404, detail=f"No data for {date_str}/{metric_key}")
    # Fire-and-forget: warm Daily bars for the first 30 tickers in the list.
    # By the time the user navigates to any of them (usually >5 s away), the
    # Massive API call will have completed and the chart loads instantly.
    try:
        from api.routers.bars import warm_bars_async
        tickers = [i["t"] for i in items if isinstance(i, dict) and i.get("t")]
        if tickers:
            warm_bars_async(tickers, tf="D", bars=8000)
    except Exception:
        pass
    return {"date": date_str, "metric": metric_key, "items": items}


@router.post("/api/breadth/industries")
async def breadth_industries(request: Request):
    """Map a list of tickers → industry for the drill-down "group by" view.

    Backed by the universe-wide industry_map (Finviz-seeded, persisted) so the
    whole market is classified — not just the lazy catalyst cache. Non-blocking:
    returns the persisted map instantly; rare stragglers come back null and are
    warmed in the background. Read-only, same posture as the drill GET.

    Body: {"tickers": ["NVDA", ...]}  →  {"industries": {"NVDA": "Semiconductors", ...}}
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    tickers = body.get("tickers") or []
    if not isinstance(tickers, list):
        raise HTTPException(status_code=400, detail="tickers must be a list")
    tickers = [str(t).upper() for t in tickers if t][:500]  # cap per call
    try:
        from api.services import industry_map
        groups = industry_map.get_groups(tickers)
        industries = {t: g.get("industry") for t, g in groups.items()}
        sectors = {t: g.get("sector") for t, g in groups.items()}
    except Exception as e:
        # Never break the drill modal over enrichment — degrade to ungrouped.
        import logging
        logging.getLogger(__name__).warning("[breadth] industries lookup failed: %s", e)
        industries = {t: None for t in tickers}
        sectors = {t: None for t in tickers}
    # `industries` kept as the back-compat key; `sectors` added for the
    # Sector ⇄ Industry dimension toggle.
    return {"industries": industries, "sectors": sectors}


@router.get("/api/breadth/industries/status")
def breadth_industries_status():
    """Coverage diagnostics for the universe industry map."""
    try:
        from api.services import industry_map
        return industry_map.status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/breadth/industries/refresh")
def breadth_industries_refresh(request: Request):
    """Force a full Finviz bulk refresh of the industry map (admin)."""
    _check_auth(request)
    try:
        from api.services import industry_map
        n = industry_map.bulk_refresh_from_finviz()
        return {"refreshed": n}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/breadth-monitor/{date_str}/field")
async def patch_breadth_field(date_str: str, request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    key = body.get("key")
    value = body.get("value")
    if not key:
        raise HTTPException(status_code=400, detail="'key' required")
    ok = svc.patch_field(date_str, key, value)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "ok", "date": date_str, "key": key, "value": value}
