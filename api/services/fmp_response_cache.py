"""fmp_response_cache — one on-disk cache in front of every FMP GET, keyed by path + params.

WHY (2026-11-13): FMP cut the account off ("Bandwidth Limit Reach", 150.18 GB of the Ultimate plan's
150 GB in a trailing 30 days). FMP's own usage page, last 30 days:

    /stable/income-statement   3.4M calls  57.6 GB
    /stable/profile           14.3M calls  23.3 GB
    /stable/earnings-calendar  114K calls  14.8 GB
    /stable/earnings           5.3M calls  13.8 GB
    /stable/analyst-estimates  756K calls   7.6 GB  (transcripts 7.0, grades 6.3, ...)

~113K income statements and ~475K profiles a DAY for a few thousand symbols. The callers DO cache (6 h,
12 h, 30 days), but in the shared app TTLCache, an LRU of 1,000 entries that also holds news, snapshots and
per-user bars keys: a 30-day entry is evicted within minutes and the same statement is bought again all
day (bars_sanitize found the same thing on 11/12 and got its own cache). Two web replicas and every deploy
multiply it.

WHAT: the raw 200 body of an FMP GET, stored in SQLite on the volume (DATA_DIR), shared by every caller and
surviving restarts, for a TTL chosen per endpoint from how often the data can change. Everything above it
(the callers' own caches, their fresh paths, their parsing) is unchanged: they still ask, and only the
repeat download is gone. Live feeds (news, quotes, latest-* lists) are never cached here.

OFF switch: FMP_RESPONSE_CACHE=0 (the test suite runs with it off; its own tests turn it on). Never raises:
any cache failure is a miss, and the GET goes out as before.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date

_log = logging.getLogger(__name__)

#: path -> seconds a 200 body is reused. Absent: never cached (live data).
TTL = {
    "/stable/income-statement": 6 * 3600,        # changes once a quarter (the callers' fresh paths read /earnings)
    "/stable/balance-sheet-statement": 6 * 3600,
    "/stable/cash-flow-statement": 6 * 3600,
    "/stable/profile": 24 * 3600,
    "/stable/splits": 24 * 3600,
    "/stable/earnings": 3600,                     # a report adds a row: an hour at most behind
    "/stable/analyst-estimates": 6 * 3600,
    "/stable/grades": 3600,
    "/stable/grades-consensus": 3600,
    "/stable/grades-historical": 6 * 3600,
    "/stable/price-target-consensus": 3600,
    "/stable/price-target-summary": 3600,
    "/stable/earning-call-transcript": 7 * 86400,  # a published transcript does not change
    "/stable/earning-call-transcript-dates": 3600,
    "/stable/key-metrics-ttm": 6 * 3600,
    "/stable/ratios-ttm": 6 * 3600,
    "/stable/shares-float": 24 * 3600,
    "/stable/key-executives": 7 * 86400,
    "/stable/governance-executive-compensation": 7 * 86400,
    "/stable/revenue-product-segmentation": 24 * 3600,
    "/stable/revenue-geographic-segmentation": 24 * 3600,
    "/stable/earnings-calendar": 15 * 60,         # a range that ended before today: PAST_RANGE_TTL
}
PAST_RANGE_TTL = 24 * 3600     # a calendar range wholly before today does not change
EMPTY_TTL = 30 * 60            # an empty answer ([] / {}) is retried sooner: data may land later
MAX_BODY = 8 * 1024 * 1024     # a bigger body is not stored (bulk files have their own paths)

_lock = threading.Lock()
_conn: dict = {}               # path -> sqlite3.Connection
_stats = {"hit": 0, "miss": 0, "stored": 0, "bytes_saved": 0}


def enabled() -> bool:
    return os.environ.get("FMP_RESPONSE_CACHE", "1").strip() not in ("0", "false", "off", "")


def db_path() -> str:
    return os.environ.get("FMP_RESPONSE_CACHE_PATH") or os.path.join(
        os.environ.get("DATA_DIR", "/data"), "fmp_response_cache.db")


def _db():
    path = db_path()
    c = _conn.get(path)
    if c is None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        c = sqlite3.connect(path, timeout=5, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE IF NOT EXISTS r (k TEXT PRIMARY KEY, body TEXT NOT NULL, expires REAL NOT NULL)")
        _conn[path] = c
    return c


def _key(path: str, params: dict) -> str:
    clean = {k: str(v) for k, v in (params or {}).items() if k != "apikey"}
    return path + "?" + json.dumps(clean, sort_keys=True)


def ttl_for(path: str, params: dict, body, today: date | None = None) -> int:
    """Seconds to keep this body; 0 = do not store."""
    base = TTL.get(path)
    if not base:
        return 0
    if body is None or (isinstance(body, dict) and body.get("Error Message")):
        return 0
    if isinstance(body, (list, dict)) and not body:
        return min(base, EMPTY_TTL)
    if path == "/stable/earnings-calendar":
        to = str((params or {}).get("to") or "")
        try:
            if to and date.fromisoformat(to[:10]) < (today or date.today()):
                return PAST_RANGE_TTL
        except ValueError:
            pass
    return base


def get(path: str, params: dict, now: float | None = None):
    """The stored body, or None (a miss: not cached, expired, off, or any error)."""
    if not enabled() or path not in TTL:
        return None
    now = time.time() if now is None else now
    try:
        with _lock:
            row = _db().execute("SELECT body, expires FROM r WHERE k = ?", (_key(path, params),)).fetchone()
        if not row or row[1] <= now:
            _stats["miss"] += 1
            return None
        _stats["hit"] += 1
        _stats["bytes_saved"] += len(row[0])
        return json.loads(row[0])
    except Exception as e:
        _log.warning("[fmp-cache] read failed for %s: %s", path, type(e).__name__)
        return None


def put(path: str, params: dict, body, now: float | None = None) -> None:
    """Store a 200 body for its TTL. Never raises."""
    if not enabled():
        return
    try:
        ttl = ttl_for(path, params, body)
        if ttl <= 0:
            return
        text = json.dumps(body, separators=(",", ":"))
        if len(text) > MAX_BODY:
            return
        now = time.time() if now is None else now
        with _lock:
            c = _db()
            c.execute("INSERT OR REPLACE INTO r (k, body, expires) VALUES (?, ?, ?)",
                      (_key(path, params), text, now + ttl))
            c.commit()
            _stats["stored"] += 1
            if _stats["stored"] % 500 == 0:          # expired rows go now and then, never on the hot path's every call
                c.execute("DELETE FROM r WHERE expires <= ?", (now,))
                c.commit()
    except Exception as e:
        _log.warning("[fmp-cache] write failed for %s: %s", path, type(e).__name__)


def stats() -> dict:
    return dict(_stats)
