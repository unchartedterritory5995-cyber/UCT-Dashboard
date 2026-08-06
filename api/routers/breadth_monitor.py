"""api/routers/breadth_monitor.py

GET  /api/breadth-monitor         — history (last 90 rows)
GET  /api/breadth-monitor/latest  — most recent row
POST /api/breadth-monitor/push    — store new snapshot (auth required)
"""

import os
import threading

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


@router.get("/api/breadth-monitor/live")
def get_breadth_live(force: bool = False):
    """Breadth as of right now — provisional, never stored.

    Returns the live-computable metrics plus `carried`: the fields the daily
    row holds that cannot be derived intraday (sentiment surveys, the EOD
    put/call print, UCT exposure), taken verbatim from the newest stored row
    and stamped with that row's date. Keeping them in a separate bag is the
    point — a carried-forward number must never read as a live one.
    """
    from api.services import breadth_live as live

    try:
        payload = live.compute_live(force=force)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not payload.get("ok"):
        raise HTTPException(status_code=503, detail=payload.get("reason", "unavailable"))

    recent = svc.get_history(11)
    latest = recent[0] if recent else {}
    carried = {k: latest[k] for k in live.NOT_LIVE if latest.get(k) is not None}
    payload["carried"] = carried
    payload["carried_from"] = latest.get("date")

    # Once the collector has written today's row there is nothing provisional
    # left to say — the authoritative number replaces the estimate rather than
    # sitting beside it.
    payload["superseded"] = bool(latest.get("date")
                                 and latest["date"] >= payload["session_date"])

    # The row a surface renders: live metrics + carried fields, run through the
    # same derivation every stored row gets.
    payload["row"] = svc.derive_live_row({**carried, **payload["metrics"],
                                          "date": payload["session_date"]}, recent)

    # Record the session's shape HERE rather than inside compute_live, because
    # `breadth_score` and the rolling ratios only exist once the row has been
    # derived — recording the raw metrics would leave the headline number with
    # no path at all. Sitting outside the compute cache is fine: `record()`
    # enforces its own minimum interval, so a cache hit costs one cheap guard.
    #
    # Only a live, anchored, non-degraded, not-yet-superseded sample is kept. A
    # degraded reading measured a different population; one taken after the
    # collector has written describes a day that already has an authoritative
    # answer; and requiring `anchored` means every sample in a path shares one
    # basis, so the line cannot step when coverage drifts mid-session.
    try:
        from api.services import breadth_intraday
        if (payload.get("session_live") and payload.get("anchored")
                and not payload.get("degraded") and not payload["superseded"]):
            breadth_intraday.record(payload["session_date"], payload["row"])
        payload["path"] = breadth_intraday.session_path(payload["session_date"])
        payload["open"] = breadth_intraday.session_open(payload["session_date"])
        # A store that fails silently for a whole session is how you discover at
        # 4pm that no path was ever written. Publishing its health costs nothing
        # and makes that visible from the same payload the surfaces already read.
        payload["store"] = breadth_intraday.health()
    except Exception as e:
        # A store that cannot write must still let the live read through.
        print(f"[breadth_monitor] intraday store unavailable: {e}")
        payload["path"], payload["open"] = {}, {}
        payload["store"] = {"ok": False, "last_error": f"{type(e).__name__}: {e}"}

    return payload


@router.get("/api/breadth-monitor/live/reconcile")
def reconcile_breadth_live(date: str, request: Request,
                           dividend_basis: int | None = None):
    """Replay the live path for a past session and diff it against the stored row.

    This is the gate: no live value goes on screen until it passes.

    `?dividend_basis=1|0` forces the price-basis arm instead of reading the
    `BREADTH_DIVIDEND_BASIS` flag, so both bases can be measured against the
    same stored rows in ONE deploy. Comparing arms across two deploys would
    mean comparing numbers produced by different processes, on a universe and
    a bars.db that both moved in between.
    """
    _check_auth(request)
    from api.services import breadth_live as live

    try:
        return live.reconcile(
            date, None if dividend_basis is None else bool(dividend_basis))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/breadth-monitor/live/dividends")
def breadth_dividends_status():
    """What the dividend store holds, and whether the last sweep truncated.

    `truncated` is the field that matters: a sweep that ran out of PAGES rather
    than out of data leaves only the recent tail, which does not fail — it
    quietly under-adjusts the oldest part of every 52-week window.
    """
    from api.services import breadth_dividends as bdiv
    from api.services import breadth_live as live

    h = bdiv.health()
    h["basis_enabled"] = live.dividend_basis_enabled()
    return h


@router.post("/api/breadth-monitor/live/dividends/refresh")
def breadth_dividends_refresh(request: Request, background: bool = True):
    """Sweep dividends. ~9 minutes for the full market, so it defaults to
    detached — a synchronous call would hold a request thread for the whole
    sweep on a single-process web pod."""
    _check_auth(request)
    from api.services import breadth_dividends as bdiv

    if not background:
        return bdiv.refresh()

    threading.Thread(target=bdiv.refresh, name="breadth-dividends-refresh",
                     daemon=True).start()
    return {"started": True, **bdiv.health()}


@router.get("/api/breadth-monitor/live/store")
def breadth_live_store(request: Request, selftest: bool = False):
    """What the intraday store holds, and whether it can actually write.

    `?selftest=1` writes a probe row, reads it back and removes it — so
    "can this pod persist an intraday sample?" is answerable the evening before
    a session rather than at 09:31 with everyone watching.
    """
    _check_auth(request)
    from api.services import breadth_intraday
    out = breadth_intraday.status()
    if selftest:
        out["self_test"] = breadth_intraday.self_test()
    return out


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
