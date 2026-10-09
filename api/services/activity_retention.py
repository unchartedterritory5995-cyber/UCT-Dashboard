"""Activity data retention: member activity records are kept for one year.

Owner ruling 2026-10-09: rows in ``activity_log`` and ``page_views`` (the
"Activity data" the Privacy page describes) are kept for 365 days, then deleted
automatically. Before this module nothing ever deleted them.

``RETENTION_DAYS`` is a code constant on purpose, not an env var: the Privacy
page states one number, and a variable would be a second authority over it.

The timestamp format is the whole risk here. Every writer of both tables
(``auth_service.log_activity``, ``auth_service.log_page_view``,
``session_guard``) leaves ``created_at`` to the column default
``CURRENT_TIMESTAMP``, which SQLite stores as UTC TEXT ``YYYY-MM-DD HH:MM:SS``
(a SPACE between date and time). The cutoff is formatted the same way so a
plain string comparison is a correct time comparison and still uses the
``created_at`` indexes. An ISO cutoff (``...T...+00:00``) would compare wrong
within the cutoff day, because ``' '`` sorts before ``'T'``; a unix-seconds
cutoff would compare a number with text and match every row or none.
``tests/test_activity_retention.py`` pins rows on both sides of the cutoff,
seconds apart, in the stored format.

Deletes run in bounded batches (``rowid IN (SELECT ... LIMIT ?)``), one commit
per batch, so the auth.db write lock that every sign-in and note save needs is
never held for long.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

RETENTION_DAYS = 365

# The tables this ruling covers. Table names are interpolated into SQL, so they
# come only from this tuple, never from a caller.
TABLES = ("activity_log", "page_views")

# How CURRENT_TIMESTAMP stores a value: UTC, space separator, whole seconds.
_STORED_FORMAT = "%Y-%m-%d %H:%M:%S"


def cutoff_for(now: datetime | None = None, days: int = RETENTION_DAYS) -> str:
    """The oldest ``created_at`` that is kept, in the stored text format.

    Rows with ``created_at`` strictly older than this string are deleted. A
    naive ``now`` is read as UTC, because that is what CURRENT_TIMESTAMP writes.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)
    return (now - timedelta(days=days)).strftime(_STORED_FORMAT)


def _purge_table(conn: sqlite3.Connection, table: str, cutoff: str,
                 batch: int, max_batches: int) -> tuple[int, int, bool]:
    """Delete old rows from one table. Returns (deleted, batches, capped)."""
    sql = (f"DELETE FROM {table} WHERE rowid IN "
           f"(SELECT rowid FROM {table} WHERE created_at < ? LIMIT ?)")
    deleted = 0
    batches = 0
    while batches < max_batches:
        cur = conn.execute(sql, (cutoff, batch))
        conn.commit()
        batches += 1
        n = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
        deleted += n
        if n < batch:
            return deleted, batches, False
    # The cap was reached on a full batch: there may be more left. The next
    # daily run continues from here.
    return deleted, batches, True


def purge_old_activity(conn: sqlite3.Connection | None = None, *,
                       days: int = RETENTION_DAYS, batch: int = 5000,
                       max_batches: int = 200,
                       now: datetime | None = None) -> dict:
    """Delete activity rows older than ``days`` from both tables.

    ``max_batches`` applies per table. Never raises: any failure is logged and
    reported in the ``error`` field, with the counts deleted before it.
    """
    result: dict = {
        "ok": False,
        "days": days,
        "cutoff": None,
        "deleted": {t: 0 for t in TABLES},
        "batches": {t: 0 for t in TABLES},
        "capped": [],
        "error": None,
    }
    if not isinstance(days, int) or isinstance(days, bool) or days < 1:
        result["error"] = f"refused: days must be a positive int, got {days!r}"
        return result
    if not isinstance(batch, int) or batch < 1 or not isinstance(max_batches, int) or max_batches < 1:
        result["error"] = f"refused: batch={batch!r} max_batches={max_batches!r}"
        return result

    owns_conn = conn is None
    try:
        cutoff = cutoff_for(now, days)
        result["cutoff"] = cutoff
        if owns_conn:
            from api.services.auth_db import get_connection
            conn = get_connection()
        for table in TABLES:
            deleted, batches, capped = _purge_table(conn, table, cutoff, batch, max_batches)
            result["deleted"][table] = deleted
            result["batches"][table] = batches
            if capped:
                result["capped"].append(table)
        result["ok"] = True
    except Exception as e:  # never raise into the scheduler
        result["error"] = f"{type(e).__name__}: {e}"
        log.exception("[activity-retention] purge failed: %s", e)
        try:
            if conn is not None:
                conn.rollback()
        except Exception:
            pass
    finally:
        if owns_conn and conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return result


def run_scheduled() -> dict | None:
    """The daily scheduler job. Wrapped so nothing can propagate to APScheduler."""
    try:
        r = purge_old_activity()
        msg = (f"[activity-retention] cutoff={r['cutoff']} deleted "
               f"activity_log={r['deleted']['activity_log']} "
               f"page_views={r['deleted']['page_views']}"
               + (f" capped={r['capped']}" if r["capped"] else "")
               + (f" ERROR={r['error']}" if r["error"] else ""))
        print(msg)
        return r
    except Exception as e:
        print(f"[activity-retention] job error: {e}")
        return None
