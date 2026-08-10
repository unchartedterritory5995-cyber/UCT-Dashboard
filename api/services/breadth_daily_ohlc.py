"""Permanent daily OHLC for breadth metrics — the data behind candle WICKS.

The EOD `breadth_snapshots` store keeps ONE value per metric per day, so a breadth
candle can only be a body (open=high=low=close). A real wick needs the day's HIGH and
LOW of the breadth value, which only exists if the metric is sampled through the day.

This module keeps that. Two writers:
  1. LIVE accumulator (`update_intraday`) — hooked into the intraday breadth sampler
     that already runs every ~55s. Each sample rolls today's row: open = first sample,
     high = running max, low = running min, close = latest. → real wicks GOING FORWARD.
  2. RECONSTRUCTION (`set_ohlc`) — a backfill that estimates a past day's intraday
     high/low from stored daily stock bars (see breadth_ohlc_reconstruct).

`build_breadth_bars` reads this store for wicks where a day has a row and falls back to
close-to-close bodies for older days that predate it.

Permanent (no retention sweep — ~40 metrics × ~250 sessions/yr is tiny). Separate DB so
it never contends with the EOD snapshot writer.
"""
from __future__ import annotations

import math
import os
import sqlite3
import threading
from typing import Optional

_WRITE_LOCK = threading.Lock()


def _db_path() -> str:
    # Override escape hatch (mirrors BREADTH_MONITOR_DB / BREADTH_INTRADAY_DB) — also what
    # the test conftest pins so this never touches the shared /data (C:\data) volume.
    override = os.environ.get("BREADTH_OHLC_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_daily_ohlc.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "data", "breadth_daily_ohlc.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path(), timeout=5.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    return c


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
                    """CREATE TABLE IF NOT EXISTS breadth_daily_ohlc (
                        date    TEXT NOT NULL,   -- 'YYYY-MM-DD' (ET session)
                        metric  TEXT NOT NULL,   -- breadth metric key, e.g. pct_above_50sma
                        o REAL, h REAL, l REAL, c REAL,
                        source  TEXT DEFAULT 'live',   -- 'live' | 'reconstruct'
                        updated_at TEXT DEFAULT (datetime('now')),
                        PRIMARY KEY (date, metric)
                    )"""
                )
                c.execute("CREATE INDEX IF NOT EXISTS idx_bdo_metric ON breadth_daily_ohlc(metric, date)")
            _INIT_DONE = True
        except Exception:
            # Leave uninitialized; callers are all best-effort and no-op on failure.
            pass


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def update_intraday(session_date: str, metrics: dict) -> int:
    """Roll today's OHLC from one live sample. For each finite metric value: first sample
    of the day seeds o=h=l=c; later samples extend h/l and set c (o is frozen). LIVE rows
    never overwrite a 'reconstruct' row's open — but reconstruct only writes PAST days, so
    they never collide with today. Returns the number of metrics updated."""
    if not session_date or not isinstance(metrics, dict):
        return 0
    _ensure_init()
    rows = [(k, _finite(v)) for k, v in metrics.items()]
    rows = [(k, v) for (k, v) in rows if v is not None]
    if not rows:
        return 0
    n = 0
    with _WRITE_LOCK:
        try:
            with _conn() as c:
                for (metric, v) in rows:
                    cur = c.execute(
                        "SELECT o, h, l FROM breadth_daily_ohlc WHERE date=? AND metric=?",
                        (session_date, metric),
                    ).fetchone()
                    if cur is None:
                        c.execute(
                            "INSERT INTO breadth_daily_ohlc(date, metric, o, h, l, c, source, updated_at) "
                            "VALUES(?,?,?,?,?,?, 'live', datetime('now'))",
                            (session_date, metric, v, v, v, v),
                        )
                    else:
                        o, h, l = cur
                        nh = v if (h is None or v > h) else h
                        nl = v if (l is None or v < l) else l
                        c.execute(
                            "UPDATE breadth_daily_ohlc SET h=?, l=?, c=?, updated_at=datetime('now') "
                            "WHERE date=? AND metric=?",
                            (nh, nl, v, session_date, metric),
                        )
                    n += 1
        except Exception:
            return 0
    return n


def set_ohlc(date: str, metric: str, o: float, h: float, l: float, c: float,
             source: str = "reconstruct", overwrite_live: bool = False) -> bool:
    """Write one metric's OHLC for one PAST day (reconstruction). By default will NOT
    clobber a row already written by the live accumulator (`overwrite_live=False`), so a
    re-run can't stomp real intraday data with an estimate."""
    o, h, l, c = (_finite(o), _finite(h), _finite(l), _finite(c))
    if None in (o, h, l, c) or not date or not metric:
        return False
    _ensure_init()
    with _WRITE_LOCK:
        try:
            with _conn() as conn:
                if not overwrite_live:
                    ex = conn.execute(
                        "SELECT source FROM breadth_daily_ohlc WHERE date=? AND metric=?",
                        (date, metric),
                    ).fetchone()
                    if ex is not None and ex[0] == "live":
                        return False
                conn.execute(
                    "INSERT INTO breadth_daily_ohlc(date, metric, o, h, l, c, source, updated_at) "
                    "VALUES(?,?,?,?,?,?,?, datetime('now')) "
                    "ON CONFLICT(date, metric) DO UPDATE SET o=excluded.o, h=excluded.h, "
                    "l=excluded.l, c=excluded.c, source=excluded.source, updated_at=datetime('now')",
                    (date, metric, o, h, l, c, source),
                )
            return True
        except Exception:
            return False


_TRUSTED_SOURCES = ("live",)  # ONLY real intraday-sampled rows produce accurate wicks


def history(metric: str, limit: int = 6000) -> dict:
    """{ 'YYYY-MM-DD': {o,h,l,c} } for a metric, newest `limit` days — TRUSTED sources
    only. A breadth metric's true intraday high/low can only come from sampling the actual
    value through the day (the live accumulator); daily-bar 'reconstruct' rows assume every
    stock hits its extreme at once and are wildly too wide, so they are NOT served. Empty on
    any error (callers fall back to close-to-close bodies)."""
    if not metric:
        return {}
    _ensure_init()
    out: dict = {}
    qmarks = ",".join("?" * len(_TRUSTED_SOURCES))
    try:
        with _conn() as c:
            for (d, o, h, l, cl) in c.execute(
                f"SELECT date, o, h, l, c FROM breadth_daily_ohlc "
                f"WHERE metric=? AND source IN ({qmarks}) ORDER BY date DESC LIMIT ?",
                (metric, *_TRUSTED_SOURCES, int(limit)),
            ).fetchall():
                out[d] = {"o": o, "h": h, "l": l, "c": cl}
    except Exception:
        return {}
    return out


def backfill_from_intraday(days: int = 8) -> dict:
    """Aggregate REAL intraday breadth samples into daily OHLC — the ACCURATE historical
    wick source. `breadth_intraday` stores the full-universe live snapshot (all metrics)
    every ~55s with ~7-day retention; per session_date we take open=first sample, high=max,
    low=min, close=last, over the actual sampled values. Written source='live' (real data).
    Cheap: a few thousand JSON rows, no recompute. Returns a summary."""
    import json as _json
    from collections import defaultdict
    _ensure_init()
    try:
        from api.services import breadth_intraday as bi
        with bi._conn() as ic:
            rows = ic.execute(
                "SELECT session_date, as_of, metrics FROM breadth_intraday ORDER BY session_date, as_of"
            ).fetchall()
    except Exception as e:
        return {"ok": False, "reason": f"intraday unreadable: {e}"}

    per_day = defaultdict(list)   # date -> [(as_of, metrics_dict)]
    for (d, as_of, mjson) in rows:
        try:
            per_day[d].append((int(as_of), _json.loads(mjson)))
        except Exception:
            continue
    target = sorted(per_day.keys())
    if days:
        target = target[-days:]

    written_days, written_rows, done = 0, 0, []
    for d in target:
        agg = {}   # metric -> [o, h, l, c]
        for (_as_of, m) in sorted(per_day[d], key=lambda x: x[0]):
            for k, v in m.items():
                fv = _finite(v)
                if fv is None:
                    continue
                a = agg.get(k)
                if a is None:
                    agg[k] = [fv, fv, fv, fv]
                else:
                    if fv > a[1]:
                        a[1] = fv
                    if fv < a[2]:
                        a[2] = fv
                    a[3] = fv
        n = 0
        for metric, (o, h, l, c) in agg.items():
            if set_ohlc(d, metric, o, h, l, c, source="live", overwrite_live=True):
                n += 1
        if n:
            written_days += 1
            written_rows += n
            done.append(d)
    return {"ok": True, "days": written_days, "rows": written_rows, "dates": done[-10:]}


def purge_reconstructed() -> int:
    """Delete all daily-bar 'reconstruct' rows (they were inaccurate). Returns the count."""
    _ensure_init()
    with _WRITE_LOCK:
        try:
            with _conn() as c:
                cur = c.execute("DELETE FROM breadth_daily_ohlc WHERE source='reconstruct'")
                return cur.rowcount or 0
        except Exception:
            return 0


def stats() -> dict:
    """Coverage summary for the admin/status surface."""
    _ensure_init()
    try:
        with _conn() as c:
            total = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
            days = c.execute("SELECT COUNT(DISTINCT date) FROM breadth_daily_ohlc").fetchone()[0]
            live = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE source='live'").fetchone()[0]
            rng = c.execute("SELECT MIN(date), MAX(date) FROM breadth_daily_ohlc").fetchone()
        return {"rows": total, "days": days, "live_rows": live,
                "recon_rows": total - live, "first": rng[0], "last": rng[1]}
    except Exception:
        return {"rows": 0, "days": 0}
