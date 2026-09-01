"""Historical market-sentiment series — the breadth metrics that CANNOT be
reconstructed from price/volume, imported from public archives so the Monitor's
deep-history rows carry them where they exist.

The 4:15pm collector only began storing `breadth_snapshots` on 2026-01-02, so
every reconstructed (pre-collector) Monitor row is missing the sentiment block
that the collector pushes live: AAII (weekly since 1987), NAAIM (weekly since
2006), CBOE equity put/call (daily, ~2003), CNN Fear & Greed (daily, ~2011).
This store holds whatever of those we could source publicly, keyed exactly by the
metric names the Monitor already uses (`aaii_bulls`, `naaim`, `cboe_putcall`,
`cnn_fear_greed`, …), so the merge just overlays them onto historical rows.

Long format `(date, key, value)` — one flexible table for every series, sparse by
nature (weekly series have ~1 row / 5 sessions). Reads forward-FILL: a weekly
survey value stands until the next one, so a daily Monitor row gets the survey in
effect that day. Separate DB so it never contends with the snapshot writer.
"""
from __future__ import annotations

import contextlib
import math
import os
import sqlite3
import threading
from bisect import bisect_right
from typing import Optional

_WRITE_LOCK = threading.Lock()

# The metric keys we import. AAII spread is DERIVED (bulls − bears) on import so
# the Monitor's stored key exists without a separate source column.
SENTIMENT_KEYS = (
    "aaii_bulls", "aaii_neutral", "aaii_bears", "aaii_spread",
    "naaim", "cboe_putcall", "cnn_fear_greed",
)

# A value carries forward at most this many calendar days. Weekly surveys (AAII/
# NAAIM) need ~7 (plus holidays); daily series (put/call, F&G) rarely gap. Beyond
# this we return nothing rather than let one reading paper over a real data hole.
_MAX_CARRY_DAYS = 12


def _db_path() -> str:
    override = os.environ.get("BREADTH_SENTIMENT_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_sentiment_history.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "data",
                         "breadth_sentiment_history.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


def _raw_conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path(), timeout=5.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    return c


@contextlib.contextmanager
def _conn():
    """A connection that COMMITS then CLOSES on exit — closing matters on Windows,
    where a leaked WAL handle blocks a temp-dir teardown (the `contextlib.closing`
    lesson from the tweet store)."""
    conn = _raw_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


_INIT_DONE = False


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _WRITE_LOCK:
        if _INIT_DONE:
            return
        try:
            with _conn() as c:
                c.execute(
                    """CREATE TABLE IF NOT EXISTS breadth_sentiment (
                        date  TEXT NOT NULL,   -- 'YYYY-MM-DD' the reading is dated to
                        key   TEXT NOT NULL,   -- metric key, e.g. aaii_bulls / naaim
                        value REAL,
                        source TEXT DEFAULT 'import',
                        updated_at TEXT DEFAULT (datetime('now')),
                        PRIMARY KEY (date, key)
                    )"""
                )
                c.execute("CREATE INDEX IF NOT EXISTS idx_bsent_key ON breadth_sentiment(key, date)")
            _INIT_DONE = True
        except Exception:
            pass


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _days_between(a: str, b: str) -> int:
    """Calendar days from ISO `a` to ISO `b` (a ≤ b). Cheap ordinal diff."""
    import datetime as _dt
    try:
        da = _dt.date.fromisoformat(a)
        db = _dt.date.fromisoformat(b)
        return (db - da).days
    except Exception:
        return 10 ** 9


def upsert_many(rows) -> int:
    """Bulk upsert [(date, key, value[, source])]. Non-finite values skipped.
    Returns the number written."""
    _ensure_init()
    clean = []
    for r in rows:
        try:
            if len(r) == 4:
                d, k, v, src = r
            else:
                d, k, v = r
                src = "import"
        except (TypeError, ValueError):
            continue
        fv = _finite(v)
        if not d or not k or fv is None:
            continue
        clean.append((d, k, fv, src))
    if not clean:
        return 0
    with _WRITE_LOCK:
        try:
            with _conn() as c:
                c.executemany(
                    "INSERT INTO breadth_sentiment(date, key, value, source, updated_at) "
                    "VALUES(?,?,?,?, datetime('now')) "
                    "ON CONFLICT(date, key) DO UPDATE SET value=excluded.value, "
                    "source=excluded.source, updated_at=datetime('now')",
                    clean,
                )
            return len(clean)
        except Exception:
            return 0


def values_asof(dates) -> dict:
    """{ 'YYYY-MM-DD': {key: value} } — for each requested date, the most-recent
    reading of each series on-or-before it (forward-fill), capped at
    `_MAX_CARRY_DAYS` so a value never covers a real gap. Weekly surveys thus land
    on every trading day they were in effect. Empty on any error / empty store."""
    if not dates:
        return {}
    _ensure_init()
    want = sorted(set(dates))
    hi = want[-1]
    out: dict = {d: {} for d in want}
    try:
        with _conn() as c:
            for key in SENTIMENT_KEYS:
                series = c.execute(
                    "SELECT date, value FROM breadth_sentiment "
                    "WHERE key=? AND date <= ? ORDER BY date ASC",
                    (key, hi),
                ).fetchall()
                if not series:
                    continue
                sdates = [s[0] for s in series]
                svals = [s[1] for s in series]
                for d in want:
                    i = bisect_right(sdates, d) - 1  # rightmost sdate <= d
                    if i < 0:
                        continue
                    if _days_between(sdates[i], d) <= _MAX_CARRY_DAYS:
                        out[d][key] = svals[i]
    except Exception:
        return {}
    return out


def bounds() -> dict:
    """First/last dated reading across all series (YYYY-MM-DD) or None."""
    _ensure_init()
    try:
        with _conn() as c:
            row = c.execute("SELECT MIN(date), MAX(date) FROM breadth_sentiment").fetchone()
            return {"min": row[0], "max": row[1]} if row else {"min": None, "max": None}
    except Exception:
        return {"min": None, "max": None}


_SEED_CSV = os.path.join(os.path.dirname(__file__), "..", "data",
                         "breadth_sentiment_history.csv")


def seed_from_bundled_csv(force: bool = False) -> dict:
    """Load the versioned historical seed (`api/data/breadth_sentiment_history.csv`)
    into the store. Idempotent (upsert) and guarded by a row-count check so a warm
    volume re-seeds only when the bundled file grew. Best-effort — returns a
    summary, never raises. Called once at web-pod startup."""
    import csv as _csv
    _ensure_init()
    path = os.path.abspath(_SEED_CSV)
    if not os.path.exists(path):
        return {"ok": False, "reason": "seed csv not found"}
    rows = []
    try:
        with open(path, newline="", encoding="utf-8") as f:
            for r in _csv.DictReader(f):
                rows.append((r["date"], r["key"], r["value"], "seed"))
    except Exception as e:
        return {"ok": False, "reason": f"read error: {e}"}
    if not force:
        have = stats().get("total", 0)
        if have >= len(rows):
            return {"ok": True, "skipped": True, "have": have, "csv_rows": len(rows)}
    n = upsert_many(rows)
    return {"ok": True, "seeded": n, "csv_rows": len(rows)}


def stats() -> dict:
    """Coverage per series for the admin/status surface."""
    _ensure_init()
    out = {"total": 0, "by_key": {}}
    try:
        with _conn() as c:
            out["total"] = c.execute("SELECT COUNT(*) FROM breadth_sentiment").fetchone()[0]
            for (k, n, mn, mx) in c.execute(
                "SELECT key, COUNT(*), MIN(date), MAX(date) FROM breadth_sentiment GROUP BY key"
            ).fetchall():
                out["by_key"][k] = {"rows": n, "first": mn, "last": mx}
    except Exception:
        pass
    return out
