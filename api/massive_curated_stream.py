"""In-process pub/sub + DB tailer for the CURATED live-flow stream (2026-08-03).

The curated twin of api/massive_stream.py. That module streams the RAW tape
(every classified print) and the frontend uses it only in uncurated mode; the
CURATED feed had no stream and polled /recent every 20s (POLL_INTERVAL_MS),
so a fresh Alpha Gold waited up to 20s to surface. This tailer closes that gap
by pushing each NEW curated alert the instant the tailer sees it.

DELIVERY only — NOT a second curation engine. It reuses the EXACT server-side
functions the /recent curated build uses:
  * live_massive_router._row_to_alert  — classification (grade / tier / side)
  * live_massive_router._qualifies_curated — the curated gate (premium floors,
    stack confirmers, hide_sizeless / hide_block_only, unusual path, …)
so a streamed alert is the same object, decided by the same rule, as a polled
one. The 20s poll stays as the authoritative reconcile: this stream is a fast
preview that prepends; the poll owns the snapshot + the cross-alert refinements
(dedupe, two-way-flow demotion) that only make sense over the full set.

contract_totals / contract_types (day-cumulative, needed by _qualifies_curated's
rollup-rescue + hide_block_only) are accumulated from tailer start, reset at the
ET day boundary. A big print clears its tier floor on its OWN premium, so it
streams instantly regardless; the niche rescue/cross-print cases that need full-
day context simply appear on the next 20s poll instead — conservative, never a
false surface.

Inert unless MASSIVE_CURATED_STREAM_ENABLED=1 — dark by default, independent of
the raw stream's MASSIVE_STREAM_ENABLED flag so either can be armed alone.
"""
import asyncio
import logging
import os
import sqlite3
import time

log = logging.getLogger(__name__)

ENABLED = os.environ.get("MASSIVE_CURATED_STREAM_ENABLED", "0") == "1"
TAIL_SEC = float(os.environ.get("MASSIVE_CURATED_STREAM_TAIL_SEC", "1.5"))
# Cap a single broadcast so a burst can't fan out a huge payload; leftovers
# drain next tick (last-processed-id is remembered, same as the raw tailer).
TAIL_LIMIT = int(os.environ.get("MASSIVE_CURATED_STREAM_TAIL_LIMIT", "500"))
MAX_SUBSCRIBERS = int(os.environ.get("MASSIVE_CURATED_STREAM_MAX_SUBSCRIBERS", "300"))
_QUEUE_MAX = 500  # per-subscriber; drop-oldest so a slow client can't grow RSS
# Absolute SQL floor for WHITE rows — mirrors live_massive_router /recent so the
# stream scans the exact same candidate row set the snapshot classifies.
_WHITE_PREMIUM_FLOOR = 500_000

_subscribers: "set[asyncio.Queue]" = set()
_last_id = 0
_started = False
# Day-cumulative maps for _qualifies_curated (rollup rescue + hide_block_only),
# accumulated from tailer start, reset at the ET day boundary.
_day: str = ""
_contract_totals: "dict[str, float]" = {}
_contract_types: "dict[str, dict]" = {}
# telemetry (observability for the launch — flat broadcasts while subscribers>0
# during market hours = "curated stream silently stalled")
_broadcasts_total = 0
_alerts_streamed_total = 0
_last_broadcast_ts = 0.0
_last_tail_ts = 0.0


# ── pub/sub ──────────────────────────────────────────────────────────────────
def subscribe() -> "asyncio.Queue | None":
    """Register a client. Returns its queue, or None if the subscriber cap is hit
    (the caller should fall back to polling)."""
    if len(_subscribers) >= MAX_SUBSCRIBERS:
        return None
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    _subscribers.add(q)
    return q


def unsubscribe(q) -> None:
    _subscribers.discard(q)


def subscriber_count() -> int:
    return len(_subscribers)


def _broadcast(alerts: list) -> None:
    global _broadcasts_total, _alerts_streamed_total, _last_broadcast_ts
    if not alerts:
        return
    import time as _t
    _broadcasts_total += 1
    _alerts_streamed_total += len(alerts)
    _last_broadcast_ts = _t.time()
    for q in list(_subscribers):
        try:
            q.put_nowait(alerts)
        except asyncio.QueueFull:
            # drop-oldest: bound memory for a slow/stuck client
            try:
                q.get_nowait()
                q.put_nowait(alerts)
            except Exception:
                pass


# ── tailer ───────────────────────────────────────────────────────────────────
def _db_path() -> str:
    from api.live_massive_router import DB_PATH
    return DB_PATH


def _current_max_id() -> int:
    try:
        conn = sqlite3.connect(_db_path(), timeout=5)
        try:
            row = conn.execute("SELECT MAX(id) AS m FROM flow").fetchone()
            return int(row[0]) if row and row[0] is not None else 0
        finally:
            conn.close()
    except Exception as e:
        log.warning("[curated-stream] max-id probe failed: %s", e)
        return 0


def _contract_key(a: dict) -> str:
    return (f"{a.get('ticker','')}|{a.get('cp','')}|"
            f"{a.get('strike','')}|{a.get('exp','')}")


def _fetch_new_curated(after_id: int):
    """Rows with id > after_id, classified via _row_to_alert then filtered by
    _qualifies_curated — the SAME two functions /recent's curated build uses.

    Returns (curated_alerts, new_last_id). new_last_id advances to the true row
    frontier when caught up, or to the last row processed when a burst hit
    TAIL_LIMIT — so nothing is silently skipped (mirrors the raw tailer).
    """
    global _day, _contract_totals, _contract_types
    from api.live_massive_router import (
        _row_to_alert, _qualifies_curated, _load_thresholds, _today_mdyyyy,
    )

    # Reset the day-cumulative maps at the ET day boundary so yesterday's
    # per-contract totals never leak into today's curated gate.
    try:
        today = _today_mdyyyy()
    except Exception:
        today = _day
    if today != _day:
        _day = today
        _contract_totals = {}
        _contract_types = {}

    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        frontier_row = conn.execute(
            "SELECT MAX(id) AS m FROM flow WHERE id > ?", (after_id,)
        ).fetchone()
        frontier = int(frontier_row["m"]) if frontier_row and frontier_row["m"] is not None else after_id
        if frontier <= after_id:
            return [], after_id
        cur = conn.execute(
            """
            SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                   Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
              FROM flow
             WHERE source = 'stocks'
               AND id > ?
               AND (Color IN ('MAGENTA', 'YELLOW')
                    OR (Color = 'WHITE' AND CAST(Premium AS INTEGER) >= ?))
             ORDER BY id ASC
             LIMIT ?
            """,
            (after_id, _WHITE_PREMIUM_FLOOR, TAIL_LIMIT),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    if len(rows) >= TAIL_LIMIT:
        # burst larger than one broadcast — resume from the last row we saw so
        # the tail drains next tick without dropping prints.
        new_last = int(rows[-1]["id"])
    else:
        new_last = frontier

    try:
        thresholds = _load_thresholds()
    except Exception:
        thresholds = {}

    curated = []
    for r in rows:
        try:
            a = _row_to_alert(dict(r))
        except Exception:
            # one malformed row must never stall the tail
            continue
        if a is None:
            continue
        # Update the day-cumulative maps BEFORE gating so this alert's own
        # premium/type is reflected in its contract's aggregate (matches the
        # /recent build, which sums over the full set before filtering).
        k = _contract_key(a)
        _contract_totals[k] = _contract_totals.get(k, 0) + (a.get("alertPremium") or 0)
        _at = (a.get("_type") or "").upper()
        ct = _contract_types.setdefault(k, {"sweep": False, "block": False})
        if "SWEEP" in _at:
            ct["sweep"] = True
        if "BLOCK" in _at:
            ct["block"] = True
        try:
            ok = _qualifies_curated(a, thresholds,
                                    contract_totals=_contract_totals,
                                    contract_types=_contract_types)
        except Exception:
            ok = False
        if ok:
            curated.append(a)
    return curated, new_last


async def _tail_loop():
    global _last_id, _last_tail_ts
    _last_id = await asyncio.to_thread(_current_max_id)
    log.info("[curated-stream] tailer armed at id=%s (tail=%.1fs)", _last_id, TAIL_SEC)
    while True:
        try:
            if _subscribers:  # no readers → skip the DB work entirely
                _last_tail_ts = time.time()
                curated, new_last = await asyncio.to_thread(_fetch_new_curated, _last_id)
                if new_last > _last_id:
                    _last_id = new_last
                if curated:
                    _broadcast(curated)
        except Exception as e:
            log.warning("[curated-stream] tail loop error: %s", e)
        await asyncio.sleep(TAIL_SEC)


def stats() -> dict:
    """Observability snapshot for /curated-stream-status and monitors."""
    import time as _t
    now = _t.time()
    return {
        "enabled": ENABLED,
        "started": _started,
        "subscribers": len(_subscribers),
        "last_id": _last_id,
        "tail_sec": TAIL_SEC,
        "day": _day,
        "tracked_contracts": len(_contract_totals),
        "broadcasts_total": _broadcasts_total,
        "alerts_streamed_total": _alerts_streamed_total,
        "last_broadcast_age_sec": round(now - _last_broadcast_ts, 1) if _last_broadcast_ts else None,
        "last_tail_age_sec": round(now - _last_tail_ts, 1) if _last_tail_ts else None,
    }


def start() -> None:
    """Launch the tailer on the running loop. Idempotent; no-op unless enabled."""
    global _started
    if _started or not ENABLED:
        return
    _started = True
    try:
        asyncio.get_running_loop().create_task(_tail_loop())
        log.info("[curated-stream] started (ENABLED=1)")
    except RuntimeError:
        _started = False
        log.warning("[curated-stream] start() called with no running loop")
