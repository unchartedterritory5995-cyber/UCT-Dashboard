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

from fastapi import APIRouter, HTTPException, Query, Depends
# 2026-07-20 security pass: these were UNAUTHENTICATED + internet-reachable.
# /bulk-fetch is called by the Live Flow page (any logged-in user); the rest are
# admin/maintenance jobs that hit the paid Schwab API and mutate OI snapshots.
from api.flow_admin_auth import require_flow_admin, require_flow_user
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timedelta
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
def run_snapshot(_auth: dict = Depends(require_flow_admin)):
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
def cancel_run(_auth: dict = Depends(require_flow_admin)):
    """Force-mark any active 'running' run as failed. Use to unstick an
    orphan run after a Railway restart killed an in-flight job."""
    oi_snapshots.init_db()
    cancelled = oi_snapshots.cancel_active_runs()
    return {"cancelled": cancelled}


@router.post("/run-sync")
def run_snapshot_sync(_auth: dict = Depends(require_flow_admin)):
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
def confirm_trades(trades: List[ConfirmRequest],
                   _auth: dict = Depends(require_flow_admin)):
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
    """Normalize expiration date to M/D/YYYY format (what snapshot keys use).

    Accepts multiple input formats since the frontend may send either:
      - ISO: '2026-08-07'
      - MDY: '8/7/2026' or '08/07/2026'
      - Short MDY: '8/7/26' (assumes 20xx)
    """
    if not exp_iso:
        return None
    s = exp_iso.strip()
    # Already MDY format with slashes
    if "/" in s:
        parts = s.split("/")
        if len(parts) != 3:
            return None
        try:
            m = int(parts[0])
            d = int(parts[1])
            y = int(parts[2])
            if y < 100:  # '26' -> '2026'
                y += 2000
            return f"{m}/{d}/{y}"
        except (ValueError, IndexError):
            return None
    # ISO format with dashes
    if "-" in s:
        parts = s.split("-")
        if len(parts) != 3:
            return None
        try:
            return f"{int(parts[1])}/{int(parts[2])}/{int(parts[0])}"
        except (ValueError, IndexError):
            return None
    return None


@router.post("/bulk-fetch", response_model=BulkFetchOIResponse)
async def bulk_fetch_oi(contracts: List[BulkFetchOIContract],
                        _auth: dict = Depends(require_flow_user)):
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
    cache_hit_persist: List[tuple] = []  # [(ck, oi, source), ...] for backfill
    cache_hits = 0
    dropped_bad_format = 0
    dropped_examples = []  # capture first few for diagnosis

    # Stage 1: DB-first lookup
    for c in contracts:
        exp_mdy = _iso_to_mdy(c.exp)
        if not exp_mdy:
            dropped_bad_format += 1
            if len(dropped_examples) < 3:
                dropped_examples.append(
                    f"{c.ticker} {c.cp}{c.strike} exp={c.exp!r}"
                )
            continue
        ck = oi_snapshots.make_key(c.ticker, c.cp, c.strike, exp_mdy)
        existing = oi_snapshots.get_snapshot(ck, today_iso)
        if existing:
            results.append(BulkFetchOIResult(
                ticker=c.ticker, cp=c.cp, strike=c.strike, exp=c.exp,
                oi=existing[0],
            ))
            cache_hits += 1
            # Queue for flow.OI backfill even for cache hits — the OI
            # value is in contract_oi_snapshots but the flow.OI column
            # on today's alert rows may still be empty.
            cache_hit_persist.append((ck, existing[0], "cache"))
        else:
            schwab_needed.append((c, ck, exp_mdy))

    if dropped_bad_format:
        logger.warning(
            "[oi-snapshot bulk-fetch] dropped %d contracts due to "
            "unparseable exp format. Examples: %s",
            dropped_bad_format, "; ".join(dropped_examples)
        )

    logger.info(
        "[oi-snapshot bulk-fetch] in: %d contracts, cache_hits: %d, "
        "schwab_needed: %d, dropped: %d",
        len(contracts), cache_hits, len(schwab_needed), dropped_bad_format
    )

    schwab_calls = 0

    # Backfill flow.OI for ALL resolved contracts (both cache-hit and
    # freshly-fetched). Without this, the /api/live/massive/recent
    # endpoint reads flow.OI directly and sees the old empty values,
    # causing the "appear then disappear" UI flicker.
    all_to_backfill = list(cache_hit_persist)
    if schwab_needed:
        payload = [(c.ticker, c.cp, c.strike, exp_mdy)
                   for c, _, exp_mdy in schwab_needed]
        try:
            schwab_results = await oi_snapshots._fetch_oi_all_async(payload)
            schwab_calls = len(payload)
        except Exception as e:
            logger.exception(f"[oi-snapshot bulk-fetch] Schwab call failed: {e}")
            # Still backfill cache hits before returning
            if all_to_backfill:
                _backfill_flow_oi(all_to_backfill)
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
            all_to_backfill.extend(to_persist)

    # Final step: backfill flow.OI on today's rows for all resolved contracts
    if all_to_backfill:
        rows_updated = _backfill_flow_oi(all_to_backfill)
        if rows_updated:
            logger.info(
                f"[oi-snapshot bulk-fetch] backfilled OI on "
                f"{rows_updated} flow rows"
            )

    return BulkFetchOIResponse(
        results=results,
        cache_hits=cache_hits,
        schwab_calls=schwab_calls,
    )



def _backfill_flow_oi(resolved_contracts: List[tuple],
                      target_date: str = None) -> int:
    """Update flow.OI column for contracts with newly-resolved OI. Mirrors
    what the worker's _color_refresh_sync does after on-demand OI fetches.

    resolved_contracts: [(contract_key, oi, source), ...]
        contract_key format: 'SYM|C/P|float_strike|M/D/YYYY'
    target_date: M/D/YYYY to target a PAST day's rows (historical backfill).
        Defaults to None → today (ET), the live bulk-fetch behavior.

    Returns total number of flow rows updated.
    """
    import sqlite3
    from api.flow_db import FlowDB

    # Which CreatedDate to match. Live path = today (ET); a historical
    # backfill passes target_date explicitly.
    # CRITICAL: use ET date, not UTC. Railway runs in UTC. After 8pm ET
    # (midnight UTC), date.today() returns tomorrow's date. But flow.CreatedDate
    # is stored as ET date. So we'd search for CreatedDate='7/1/2026' when
    # the rows have CreatedDate='6/30/2026'. Zero matches.
    if target_date:
        today_mdY = target_date
    else:
        try:
            from zoneinfo import ZoneInfo
            et_now = datetime.now(ZoneInfo('America/New_York'))
        except ImportError:
            # Fallback: approximate ET as UTC-4 (EDT). Off during winter but
            # close enough for the CreatedDate matching to work.
            et_now = datetime.utcnow() + timedelta(hours=-4)
        today_mdY = f"{et_now.month}/{et_now.day}/{et_now.year}"

    db = FlowDB()
    rows_updated = 0
    per_contract_log = []  # for diagnostic

    try:
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            for ck, oi, _src in resolved_contracts:
                try:
                    sym, cp_letter, strike_str, exp_mdy = ck.split("|", 3)
                    strike = float(strike_str)
                except (ValueError, AttributeError):
                    continue
                cp_full = 'CALL' if cp_letter == 'C' else 'PUT'

                # Try multiple strike formats since flow.Strike is stored
                # as various strings depending on original insertion path
                # (Massive vs backfill vs manual upload).
                strike_candidates = set()
                if strike == int(strike):
                    strike_candidates.add(str(int(strike)))         # '290'
                    strike_candidates.add(f"{int(strike)}.0")        # '290.0'
                strike_candidates.add(str(float(strike)))            # '290.0'
                strike_candidates.add(f"{strike:.1f}")               # '290.0'
                strike_candidates.add(f"{strike:.2f}")               # '290.00'
                strike_candidates.add(f"{strike:g}")                 # '290'

                # Also try multiple exp formats
                exp_candidates = {exp_mdy}
                # Normalized MDY: '8/7/2026' vs '08/07/2026'
                try:
                    m, d, y = exp_mdy.split("/")
                    exp_candidates.add(f"{int(m):02d}/{int(d):02d}/{y}")
                    exp_candidates.add(f"{int(m)}/{int(d)}/{y}")
                    # ISO format: '2026-08-07'
                    exp_candidates.add(f"{y}-{int(m):02d}-{int(d):02d}")
                except ValueError:
                    pass

                contract_updated = 0
                for strike_s in strike_candidates:
                    for exp_s in exp_candidates:
                        upd = conn.execute(
                            "UPDATE flow SET OI=? WHERE Symbol=? AND "
                            "CallPut=? AND Strike=? AND ExpirationDate=? AND "
                            "CreatedDate=? AND (OI='0' OR OI='' OR OI IS NULL)",
                            (str(oi), sym, cp_full, strike_s, exp_s,
                             today_mdY),
                        )
                        if upd.rowcount > 0:
                            contract_updated += upd.rowcount

                if contract_updated == 0:
                    # Diagnostic: capture what we tried so we can see the
                    # mismatch pattern in logs
                    per_contract_log.append(
                        f"{sym} {cp_letter}{strike} {exp_mdy}: 0 rows "
                        f"(tried strikes={list(strike_candidates)}, "
                        f"exps={list(exp_candidates)})"
                    )
                rows_updated += contract_updated

            conn.commit()
    except Exception as e:
        logger.warning(
            f"[oi-snapshot bulk-fetch] flow.OI backfill failed: {e}"
        )
        return 0

    # Log unmatched contracts for diagnosis (first 3 only)
    if per_contract_log:
        logger.warning(
            "[oi-snapshot bulk-fetch] %d contracts did not match any "
            "flow rows. Samples: %s",
            len(per_contract_log),
            " | ".join(per_contract_log[:3])
        )

    return rows_updated


@router.post("/backfill-flow-oi")
def backfill_flow_oi_for_date(
    target_date: str = Query(..., description="M/D/YYYY. Write OI from contract_oi_snapshots into this PAST date's flow.OI rows."),
    _auth: dict = Depends(require_flow_admin),
):
    """One-shot: populate flow.OI for a HISTORICAL date from contract_oi_snapshots.

    The live /bulk-fetch path only backfills TODAY's rows, so gap-filled days
    (e.g. 7/8) land at OI=0 and /api/admin/massive/rebuild-color can't upgrade
    them (no OI for cumulative volume to exceed). This reads the latest snapshot
    (snap_date <= target_date, oi > 0) for every contract whose Symbol has an
    empty-OI row on target_date, then writes OI into those rows.

    Idempotent — only fills rows where OI is '0'/''/NULL. Follow with
    POST /api/admin/massive/rebuild-color?target_date=<same date> so the newly
    populated OI produces the MAGENTA/YELLOW upgrades.
    """
    import sqlite3
    from api.flow_db import FlowDB

    # M/D/YYYY → ISO for snap_date comparison (snap_date stored 'YYYY-MM-DD').
    try:
        m, d, y = target_date.split("/")
        target_iso = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except (ValueError, AttributeError):
        raise HTTPException(400, "target_date must be M/D/YYYY")

    db = FlowDB()
    with sqlite3.connect(db.db_path, timeout=30) as conn:
        try:
            from api.oi_snapshots import attach_oi_snapshots
            attach_oi_snapshots(conn)
        except Exception:
            pass
        # 1) Symbols with empty-OI rows on this date — bounds the snapshot scan.
        sym_rows = conn.execute(
            "SELECT DISTINCT Symbol FROM flow "
            "WHERE CreatedDate = ? AND (OI = '0' OR OI = '' OR OI IS NULL)",
            (target_date,),
        ).fetchall()
        symbols = {r[0] for r in sym_rows if r[0]}
        if not symbols:
            return {"ok": True, "target_date": target_date, "rows_updated": 0,
                    "note": "No empty-OI rows on this date — nothing to backfill."}

        # 2) Latest snapshot per contract_key (snap_date <= target, oi > 0),
        #    kept only for the symbols that need it. contract_key format is
        #    'SYM|C/P|float_strike|M/D/YYYY' — the same shape _backfill_flow_oi
        #    parses and reverses into flow-row strike/exp candidates.
        snap_by_key = {}
        cur = conn.execute(
            "SELECT contract_key, snap_date, oi FROM contract_oi_snapshots "
            "WHERE snap_date <= ? ORDER BY contract_key, snap_date",
            (target_iso,),
        )
        for ck, sd, oi_val in cur.fetchall():
            oi_val = int(oi_val or 0)
            if oi_val <= 0:
                continue
            if ck.split("|", 1)[0] not in symbols:
                continue
            prev = snap_by_key.get(ck)
            if prev is None or sd > prev[0]:
                snap_by_key[ck] = (sd, oi_val)

    if not snap_by_key:
        return {"ok": True, "target_date": target_date, "rows_updated": 0,
                "symbols_with_empty_oi": len(symbols),
                "note": "No snapshots (snap_date <= date, oi > 0) for this "
                        "date's symbols."}

    resolved = [(ck, oi, "snapshot-backfill")
                for ck, (_sd, oi) in snap_by_key.items()]
    rows_updated = _backfill_flow_oi(resolved, target_date=target_date)

    return {
        "ok": True,
        "target_date": target_date,
        "symbols_with_empty_oi": len(symbols),
        "snapshot_contracts_matched": len(resolved),
        "rows_updated": rows_updated,
        "next": f"POST /api/admin/massive/rebuild-color?target_date={target_date}",
    }


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
    url = f"{base_url}/v3/snapshot/options/{ticker}?limit=250"

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
