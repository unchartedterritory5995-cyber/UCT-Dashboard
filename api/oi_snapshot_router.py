"""
oi_snapshot_router.py — FastAPI router for OI snapshot operations.

Endpoints:
    POST /api/oi-snapshot/run         — Manually trigger today's snapshot run
    GET  /api/oi-snapshot/status      — How many snapshots captured per day (last N)
    GET  /api/oi-snapshot/lookup      — Get OI for a specific (contract, date)
    GET  /api/oi-snapshot/history     — Full OI trajectory for one contract
    POST /api/oi-snapshot/confirm     — Apply confirmation logic to a list of B-side trades

Integration in main.py:
    from api.oi_snapshot_router import router as oi_snapshot_router
    app.include_router(oi_snapshot_router)
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import threading
import logging
from api import oi_snapshots

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/oi-snapshot", tags=["oi-snapshot"])


def _run_snapshot_background():
    """Background worker. State tracking is via DB so multiple workers see
    the same picture."""
    try:
        oi_snapshots.daily_snapshot_job()
    except Exception:
        # Exceptions are already logged + recorded in oi_snapshot_runs by the job itself
        pass


@router.post("/run")
def run_snapshot():
    """Kick off today's snapshot in the background and return immediately.
    Long jobs (60-180s) would exceed Cloudflare's 100s edge timeout if we
    waited inline. Poll /run-status to see when it finishes.

    Run state persists in the oi_snapshot_runs DB table so status is
    visible from any worker."""
    oi_snapshots.init_db()  # ensure tables exist
    active = oi_snapshots.is_run_active()
    if active:
        return {"status": "already_running", **active}

    # Fire-and-forget. The job itself logs the start in oi_snapshot_runs.
    threading.Thread(target=_run_snapshot_background, daemon=True).start()

    return {
        "status": "started",
        "message": "Snapshot running in background. Poll /api/oi-snapshot/run-status in ~2-3 min.",
    }


@router.get("/run-status")
def run_status():
    """Inspect the latest run (in progress or most recent). Reads from DB
    so works across all uvicorn workers."""
    oi_snapshots.init_db()
    last = oi_snapshots.get_last_run()
    if not last:
        return {"has_run": False}
    return {"has_run": True, **last}


@router.post("/cancel")
def cancel_run():
    """Force-mark any active 'running' run as failed. Use to unstick an
    orphan run after a Railway restart killed an in-flight job."""
    oi_snapshots.init_db()
    cancelled = oi_snapshots.cancel_active_runs()
    return {"cancelled": cancelled}


@router.post("/run-sync")
def run_snapshot_sync():
    """Synchronous version — blocks until job finishes. Use only when called
    from inside the network (admin server-to-server, not via Cloudflare)."""
    try:
        result = oi_snapshots.daily_snapshot_job()
        return result
    except Exception as e:
        logger.exception("OI snapshot run failed")
        raise HTTPException(500, f"Snapshot job failed: {e}")


@router.get("/status")
def status(days: int = Query(7, ge=1, le=90)):
    """Snapshot counts per day for last N days."""
    return {"recent": oi_snapshots.get_status(days)}


@router.get("/lookup")
def lookup(
    sym: str,
    cp: str,
    strike: float,
    exp: str,
    snap_date: Optional[str] = None,
):
    """Look up OI for a contract on a specific date.
    If snap_date omitted, uses today."""
    if not snap_date:
        snap_date = date.today().isoformat()
    ck = oi_snapshots.make_key(sym, cp, strike, exp)
    result = oi_snapshots.get_snapshot(ck, snap_date)
    if not result:
        return {"found": False, "contract_key": ck, "date": snap_date}
    return {
        "found": True,
        "contract_key": ck,
        "date": snap_date,
        "oi": result[0],
        "source": result[1],
    }


@router.get("/history")
def history(
    sym: str,
    cp: str,
    strike: float,
    exp: str,
    days: int = Query(30, ge=1, le=180),
):
    """OI evolution for one contract over the past N days."""
    ck = oi_snapshots.make_key(sym, cp, strike, exp)
    return {"contract_key": ck, "history": oi_snapshots.get_history(ck, days)}


class ConfirmRequest(BaseModel):
    """One B-side trade to confirm."""
    trade_date: str           # 'YYYY-MM-DD'
    sym: str
    cp: str                   # 'C' / 'P' or 'CALL' / 'PUT'
    strike: float
    exp: str                  # original expiration string, e.g. '6/18/2026'
    volume: int
    side: str                 # 'B' or 'BB'
    color: str                # 'YELLOW' or 'MAGENTA'
    next_trading_day: Optional[str] = None  # optional override


class ConfirmResponse(BaseModel):
    inferred_direction: Optional[str]  # 'BULL' / 'BEAR' or None


@router.post("/confirm", response_model=List[ConfirmResponse])
def confirm_trades(trades: List[ConfirmRequest]):
    """Apply confirmation logic to a batch of B-side trades. Returns inferred
    direction for each (or None if not yet confirmable)."""
    out = []
    for t in trades:
        ck = oi_snapshots.make_key(t.sym, t.cp, t.strike, t.exp)
        d = oi_snapshots.confirm_trade_direction(
            trade_date=t.trade_date,
            contract_key=ck,
            volume=t.volume,
            side=t.side,
            color=t.color,
            cp=t.cp,
            next_trading_day=t.next_trading_day,
        )
        out.append(ConfirmResponse(inferred_direction=d))
    return out


# ── Bulk on-demand fetch ─────────────────────────────────────────────────
# Powers the "Fetch OI" button in LiveFlow.jsx (added 2026-06-24). When the
# operator views historical alerts where most rows have priorOI=null, this
# endpoint fills them in by:
#   1. Checking contract_oi_snapshots for any recent matches (last 5 days)
#   2. For misses, calling Schwab in a single batch via _fetch_oi_all_async
#   3. Persisting all results with source='ondemand-bulk'
#
# Returns a map keyed by ticker|cp|strike|exp (ISO) so the frontend can
# match results back to displayed rows. Schwab batch endpoint groups by
# ticker internally — so 50 contracts on 10 tickers = 10 API calls.
class BulkFetchOIContract(BaseModel):
    """One contract to fetch OI for. Matches what LiveFlow alerts contain."""
    ticker: str
    cp: str
    strike: float
    exp: str  # ISO 'YYYY-MM-DD'


class BulkFetchOIResult(BaseModel):
    """OI lookup result for one contract. Returned as structured object instead
    of string-keyed dict to avoid Python-vs-JS number formatting mismatch:
    Python f'{450.0}' → '450.0' but JS `${450}` → '450', breaking key lookups.
    JSON round-trip through JS Number normalizes the strike value so the
    frontend can match results back to alerts cleanly.
    """
    ticker: str
    cp: str
    strike: float
    exp: str
    oi: int


class BulkFetchOIResponse(BaseModel):
    results: List[BulkFetchOIResult]
    cache_hits: int
    schwab_calls: int


def _iso_to_mdy(exp_iso: str) -> Optional[str]:
    if not exp_iso or "-" not in exp_iso:
        return None
    parts = exp_iso.split("-")
    if len(parts) != 3:
        return None
    try:
        return f"{int(parts[1])}/{int(parts[2])}/{int(parts[0])}"
    except (ValueError, IndexError):
        return None


@router.post("/bulk-fetch", response_model=BulkFetchOIResponse)
async def bulk_fetch_oi(contracts: List[BulkFetchOIContract]):
    """On-demand OI fetch for a batch of contracts (operator-triggered).

    Two-stage like the worker's _enrich_with_oi:
      1. DB cache check (today's snapshot) — instant, no API
      2. Schwab batch for the misses — single options chain call per
         distinct ticker, OI per strike returned
    Persists Schwab results to contract_oi_snapshots so future page loads
    show OI without needing a re-fetch.

    Hard cap: 100 contracts per request. Beyond that, frontend should
    paginate or split into multiple calls.
    """
    if len(contracts) > 100:
        raise HTTPException(400, "Max 100 contracts per request")

    oi_snapshots.init_db()
    today_iso = date.today().isoformat()

    results: List[BulkFetchOIResult] = []
    schwab_needed: List[tuple] = []  # [(c, ck, exp_mdy), ...]
    cache_hits = 0

    # Stage 1: DB-first lookup
    for c in contracts:
        exp_mdy = _iso_to_mdy(c.exp)
        if not exp_mdy:
            continue
        ck = oi_snapshots.make_key(c.ticker, c.cp, c.strike, exp_mdy)
        existing = oi_snapshots.get_snapshot(ck, today_iso)
        if existing:
            results.append(BulkFetchOIResult(
                ticker=c.ticker, cp=c.cp, strike=c.strike, exp=c.exp,
                oi=existing[0],
            ))
            cache_hits += 1
        else:
            schwab_needed.append((c, ck, exp_mdy))

    logger.info(
        "[oi-snapshot bulk-fetch] in: %d contracts, cache_hits: %d, "
        "schwab_needed: %d",
        len(contracts), cache_hits, len(schwab_needed)
    )

    # Stage 2: Schwab batch fetch for misses
    schwab_calls = 0
    if schwab_needed:
        payload = [(c.ticker, c.cp, c.strike, exp_mdy)
                   for c, _, exp_mdy in schwab_needed]
        try:
            schwab_results = await oi_snapshots._fetch_oi_all_async(payload)
            schwab_calls = len(payload)
        except Exception as e:
            logger.exception(f"[oi-snapshot bulk-fetch] Schwab call failed: {e}")
            return BulkFetchOIResponse(
                results=results, cache_hits=cache_hits, schwab_calls=0
            )

        # Diagnostic: log what came back from _fetch_oi_all_async
        # (which now includes Massive fallback automatically)
        resolved_count = sum(
            1 for _, oi in schwab_results if oi is not None and oi > 0
        )
        logger.info(
            "[oi-snapshot bulk-fetch] _fetch_oi_all_async returned: "
            "%d resolved of %d requested",
            resolved_count, len(schwab_results)
        )

        # Persist + accumulate
        to_persist = []
        for (orig_c, ck, _), (_, oi) in zip(schwab_needed, schwab_results):
            if oi is not None and oi > 0:
                results.append(BulkFetchOIResult(
                    ticker=orig_c.ticker, cp=orig_c.cp,
                    strike=orig_c.strike, exp=orig_c.exp, oi=oi,
                ))
                to_persist.append((ck, oi, "ondemand-bulk"))

        if to_persist:
            try:
                oi_snapshots.record_batch(to_persist, today_iso)
                logger.info(
                    f"[oi-snapshot bulk-fetch] persisted {len(to_persist)} OI values"
                )
            except Exception as e:
                logger.warning(f"[oi-snapshot bulk-fetch] persist failed: {e}")

    return BulkFetchOIResponse(
        results=results,
        cache_hits=cache_hits,
        schwab_calls=schwab_calls,
    )


# ── Diagnostic endpoint for Massive OI integration ───────────────────────
# Hits Massive's snapshot endpoint directly and returns the raw response
# (truncated). Use to verify URL/auth/response shape when troubleshooting
# why the Massive fallback isn't filling Schwab gaps.
#
# Usage from browser:
#   /api/oi-snapshot/test-massive/QCOM
@router.get("/test-massive/{ticker}")
async def test_massive_oi(ticker: str):
    """Diagnostic: directly hit Massive's snapshot endpoint and return
    the raw response. Bypasses all integration code so we can see exactly
    what Massive returns without parser/integration layers in the way.

    Returns:
      - url: exact URL called
      - status_code: HTTP response code
      - body_preview: first 3000 chars of response body
      - parsed_top_level_keys: top-level JSON keys (if parseable)
      - parsed_results_count: number of entries in 'results' array
      - parsed_oi_present_count: how many had 'open_interest' field
      - first_contract_sample: full first entry (so we see schema)
    """
    import os
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        return {"error": "MASSIVE_API_KEY env var not set"}

    base_url = os.environ.get(
        "MASSIVE_REST_BASE", "https://api.massive.com"
    ).rstrip("/")
    url = f"{base_url}/v3/snapshot/options/{ticker}"

    try:
        import httpx
    except ImportError:
        return {"error": "httpx not installed"}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15.0,
            )
    except Exception as e:
        return {
            "url": url,
            "error": str(e),
            "error_type": type(e).__name__,
        }

    body_text = resp.text
    result = {
        "url": url,
        "status_code": resp.status_code,
        "body_length": len(body_text),
        "body_preview": body_text[:3000],
    }

    # Try to parse JSON and extract diagnostic info
    try:
        data = resp.json()
        results_list = data.get("results", []) if isinstance(data, dict) else []
        oi_present = sum(
            1 for r in results_list
            if isinstance(r, dict) and r.get("open_interest") is not None
        )
        result["parsed_top_level_keys"] = (
            list(data.keys()) if isinstance(data, dict) else None
        )
        result["parsed_results_count"] = len(results_list)
        result["parsed_oi_present_count"] = oi_present
        if results_list:
            result["first_contract_sample"] = results_list[0]
    except Exception as e:
        result["parse_error"] = str(e)

    return result
