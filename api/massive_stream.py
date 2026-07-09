"""In-process pub/sub + DB tailer for the live options-flow stream (2026-07-08).

The "instant tape" backend. DECOUPLED from the OPRA write path (Ravi's
massive_ws_worker): a single background tailer reads flow.db for rows with
id > last_seen every ~1s and broadcasts the newly-classified alerts to every
connected SSE client. One cheap query/sec total, independent of client count —
it only READS what the consumer writes, never touches the ingest code.

Serialization goes through live_massive_router._row_to_alert (the SAME path
/recent uses) so streamed alerts are byte-identical in shape to snapshot alerts.

Everything here is inert unless MASSIVE_STREAM_ENABLED=1 — dark by default.
"""
import asyncio
import logging
import os
import sqlite3

log = logging.getLogger(__name__)

ENABLED = os.environ.get("MASSIVE_STREAM_ENABLED", "0") == "1"
TAIL_SEC = float(os.environ.get("MASSIVE_STREAM_TAIL_SEC", "1.0"))
# Cap a single broadcast so a burst (or a cold first tick) can't fan out a huge
# payload; leftovers drain on the next tick (last-processed-id is remembered).
TAIL_LIMIT = int(os.environ.get("MASSIVE_STREAM_TAIL_LIMIT", "500"))
MAX_SUBSCRIBERS = int(os.environ.get("MASSIVE_STREAM_MAX_SUBSCRIBERS", "300"))
_QUEUE_MAX = 500  # per-subscriber; drop-oldest so a slow client can't grow RSS
# Absolute SQL floor for WHITE rows — mirrors live_massive_router /recent so the
# stream and the snapshot classify the exact same row set.
_WHITE_PREMIUM_FLOOR = 500_000

_subscribers: "set[asyncio.Queue]" = set()
_last_id = 0
_started = False


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
    if not alerts:
        return
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
        log.warning("[massive-stream] max-id probe failed: %s", e)
        return 0


def _fetch_new_alerts(after_id: int):
    """Rows with id > after_id, classified via _row_to_alert (same as /recent).

    Returns (alerts, new_last_id). new_last_id advances to the true row frontier
    when we've caught up, or to the last row we actually processed when a burst
    hit TAIL_LIMIT — so nothing is ever silently skipped.
    """
    from api.live_massive_router import _row_to_alert

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
        # burst larger than one broadcast — resume from the last row we saw,
        # NOT the frontier, so the tail drains next tick without dropping prints.
        new_last = int(rows[-1]["id"])
    else:
        new_last = frontier

    alerts = []
    for r in rows:
        try:
            a = _row_to_alert(dict(r))
            if a is not None:
                alerts.append(a)
        except Exception:
            # one malformed row must never stall the tail
            continue
    return alerts, new_last


async def _tail_loop():
    global _last_id
    _last_id = await asyncio.to_thread(_current_max_id)
    log.info("[massive-stream] tailer armed at id=%s (tail=%.1fs)", _last_id, TAIL_SEC)
    while True:
        try:
            if _subscribers:  # no readers → skip the DB work entirely
                alerts, new_last = await asyncio.to_thread(_fetch_new_alerts, _last_id)
                if new_last > _last_id:
                    _last_id = new_last
                if alerts:
                    _broadcast(alerts)
        except Exception as e:
            log.warning("[massive-stream] tail loop error: %s", e)
        await asyncio.sleep(TAIL_SEC)


def start() -> None:
    """Launch the tailer on the running loop. Idempotent; no-op unless enabled."""
    global _started
    if _started or not ENABLED:
        return
    _started = True
    try:
        asyncio.get_running_loop().create_task(_tail_loop())
        log.info("[massive-stream] started (ENABLED=1)")
    except RuntimeError:
        _started = False
        log.warning("[massive-stream] start() called with no running loop")
