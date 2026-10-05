"""Exchange Breadth V1 — the per-session population-count buffer behind `exch_session`.

⛔⛔ WHY THIS EXISTS (validation 2026-10-05). The grind kept the counts in a bare dict that the
5-minute pump flushed with `for d, c in list(_counts.items()): …; commit(); _counts.clear()`.
The main thread's `resolve_universes` adds the NEXT session while that flush is writing, and the
trailing `clear()` then discards it. The v1 historical run lost exactly four rows that way
(2010-09-16, 2021-03-02, 2022-11-07, 2025-06-27), each committed on a pump tick.

THE INVARIANT: a count handed to `put` is either persisted by a `flush` or still pending in the
buffer — never neither. `drain` SWAPS the pending dict out under the lock, so a `put` that lands
during the write goes into the fresh dict and is flushed next time; a write that fails puts its
batch back (without overwriting a newer value for the same session).
"""
from __future__ import annotations

import json
import threading

CREATE_SQL = "CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT)"
INSERT_SQL = "INSERT OR REPLACE INTO exch_session VALUES(?,?)"


class SessionCounts:
    def __init__(self):
        self._lock = threading.Lock()
        self._pending: dict = {}

    def put(self, date: str, counts: dict) -> None:
        with self._lock:
            self._pending[date] = counts

    def drain(self) -> dict:
        """Take ownership of everything pending; the buffer is empty afterwards."""
        with self._lock:
            batch, self._pending = self._pending, {}
        return batch

    def restore(self, batch: dict) -> None:
        """Return an unpersisted batch; a newer `put` for the same session wins."""
        with self._lock:
            for d, c in batch.items():
                self._pending.setdefault(d, c)

    def pending(self) -> dict:
        with self._lock:
            return dict(self._pending)


def flush(buf: SessionCounts, conn) -> int:
    """Persist everything pending into `exch_session` (idempotent rows). Returns rows written."""
    conn.execute(CREATE_SQL)
    batch = buf.drain()
    try:
        for d, c in sorted(batch.items()):
            conn.execute(INSERT_SQL, (d, json.dumps(c, sort_keys=True)))
        conn.commit()
    except BaseException:
        buf.restore(batch)
        raise
    return len(batch)
