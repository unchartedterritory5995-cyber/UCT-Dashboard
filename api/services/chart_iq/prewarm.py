"""Chart IQ group pre-warm: the first chart of an industry each trading day is slow on the web pod.

Why: a read's group context (the industry's median 3-month return, share over the 50SMA, the stock's rank) needs the last 70 daily
closes of every member. On the pod's bars.db that is ~0.5-1 s per member query, so the first chart of a large industry each new
trading day took 5-25 s (measured 2026-11-02). The rows cache (engine/_db.py) makes every later read in that industry fast, but
its keys carry the day, so each new session starts cold.

What: every successful read records its ticker (record_view, one tiny upsert). After the close, warm() takes the industries of the
tickers read in the last VIEW_DAYS days and runs the engine's own group() for one ticker of each, for the new session: exactly the
queries a member's first read would make, so they land in the rows cache. Only industries members actually open; one query at a
time; a pause between industries; a hard time cap. Memory: a handful of row lists.

Gate: CHART_IQ_PREWARM_ENABLED=1 (and Chart IQ itself on). Never raises. Never imports the engine at boot.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time

VIEW_DAYS = 5
PAUSE_S = 2.0
MAX_RUN_S = 45 * 60
_LOCK = threading.Lock()
_INIT: set = set()
log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("CHART_IQ_PREWARM_ENABLED", "0") == "1" and os.environ.get("CHART_IQ_ENABLED", "0") == "1"


def _path() -> str:
    return os.environ.get("CHART_IQ_ROW_CACHE_DB") or os.path.join(os.environ.get("DATA_DIR", "/data"), "chart_iq_rows.db")


def _conn() -> sqlite3.Connection:
    p = _path()
    c = sqlite3.connect(p, timeout=2)
    c.execute("PRAGMA busy_timeout=2000")
    if p not in _INIT:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE IF NOT EXISTS viewed (ticker TEXT PRIMARY KEY, at REAL NOT NULL)")
        _INIT.add(p)
    return c


_PENDING: dict = {}
_FLUSHER = []


def record_view(ticker: str) -> None:
    """Remember that a chart was read: an in-memory note, written in batches by a background thread (a synchronous write on the
    pod's network disk cost a member's read up to a second, measured 2026-11-02). Never raises, never blocks on the disk."""
    try:
        with _LOCK:
            _PENDING[str(ticker).upper()] = time.time()
            if not _FLUSHER:
                t = threading.Thread(target=_flush_loop, name="chart-iq-views", daemon=True)
                _FLUSHER.append(t)
                t.start()
    except Exception:  # noqa: BLE001
        pass


def _flush_loop():
    while True:
        time.sleep(30)
        flush()


def flush() -> int:
    """Write the pending views now. Returns how many were written. Never raises."""
    with _LOCK:
        batch = list(_PENDING.items()); _PENDING.clear()
    if not batch:
        return 0
    try:
        c = _conn()
        try:
            c.executemany("INSERT INTO viewed (ticker, at) VALUES (?, ?) ON CONFLICT(ticker) DO UPDATE SET at=excluded.at", batch)
            c.commit()
        finally:
            c.close()
        return len(batch)
    except Exception:  # noqa: BLE001
        return 0


def recent_tickers(now: float | None = None) -> list[str]:
    now = time.time() if now is None else now
    flush()
    try:
        c = _conn()
        try:
            return [r[0] for r in c.execute("SELECT ticker FROM viewed WHERE at >= ? ORDER BY at DESC", (now - VIEW_DAYS * 86400,))]
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        return []


def warm(sleep=time.sleep, clock=time.time) -> dict:
    """Warm the rows cache for the latest session, one industry at a time. Returns a small report."""
    if not enabled():
        return {"skipped": "disabled"}
    if os.environ.get("CHART_IQ_PACK_ENABLED", "0") == "1":
        return {"skipped": "the nightly pack reads every stock already"}
    started = clock()
    try:
        from api.services.chart_iq import pipeline
        from api.services.chart_iq.engine import context as CX
        day = pipeline.latest_day()
        if not day:
            return {"skipped": "no daily bars"}
        dint = int(day.replace("-", ""))
        seen, done, failed = set(), 0, 0
        for t in recent_tickers():
            if clock() - started > MAX_RUN_S:
                break
            if t not in CX.IM or t in CX.FUNDS:
                continue
            ind = CX.IM[t][1]
            if ind in seen:
                continue
            seen.add(ind)
            try:
                CX.group(t, dint)
                done += 1
            except Exception:  # noqa: BLE001
                failed += 1
            sleep(PAUSE_S)
        rep = {"day": day, "industries": done, "failed": failed, "seconds": round(clock() - started, 1)}
        log.info("[chart_iq_prewarm] %s", rep)
        return rep
    except Exception as e:  # noqa: BLE001
        log.warning("[chart_iq_prewarm] failed: %s", e)
        return {"error": type(e).__name__}
