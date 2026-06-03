"""Universe-wide ticker → sector / industry map.

The breadth drill-down "group by industry" view needs EVERY mover classified,
not just the handful that happen to be in the lazy catalyst yfinance cache.

Primary source: a single Finviz Elite screener export
(`export.ashx?v=152&c=1,2,3,4`) returns Ticker / Company / Sector / Industry
for the ENTIRE market (~11k rows, 100% industry coverage incl. ETFs) in one
request. We persist that to a SQLite map on the Railway volume, prewarm it on
startup, and self-heal if it's ever empty/stale. Per-ticker fallbacks
(yfinance → Finnhub) cover the rare straggler not in the Finviz set.

Sector/industry barely changes, so a weekly refresh is plenty.
"""
from __future__ import annotations

import contextlib
import csv
import io
import logging
import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _resolve_db_path() -> str:
    override = os.environ.get("INDUSTRY_MAP_DB_PATH")
    if override:
        return override
    if os.path.isdir("/data"):
        return "/data/industry_map.db"
    # Local dev fallback — repo-local data dir.
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    return os.path.join(here, "industry_map.db")


_DB_PATH = _resolve_db_path()
_WRITE_LOCK = threading.Lock()
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

# Refresh cadence + self-heal cooldown.
_STALE_SECONDS = 7 * 24 * 3600
_REFRESH_COOLDOWN = 30 * 60
_LAST_REFRESH_AT = 0.0
_REFRESH_LOCK = threading.Lock()
_REFRESH_INFLIGHT = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS industry_map (
  ticker      TEXT PRIMARY KEY,
  sector      TEXT,
  industry    TEXT,
  source      TEXT,
  fetched_at  INTEGER NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    global _INIT_DONE
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        parent = os.path.dirname(_DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


def _ensure_init() -> None:
    if not _INIT_DONE:
        _init_db()


# ── Bulk source: Finviz Elite export ────────────────────────────────────────

def _fetch_finviz_universe() -> list[dict]:
    """Fetch the whole-market Ticker/Company/Sector/Industry CSV from Finviz Elite.

    Returns a list of {Ticker, Company, Sector, Industry} dicts (possibly empty
    on error / missing token). Follows the 301 redirect Finviz issues.
    """
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        logger.warning("[industry_map] FINVIZ_API_KEY not set — bulk refresh skipped")
        return []
    url = f"https://elite.finviz.com/export.ashx?v=152&c=1,2,3,4&auth={token}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}
    try:
        r = httpx.get(url, headers=headers, timeout=90.0, follow_redirects=True)
        r.raise_for_status()
        return list(csv.DictReader(io.StringIO(r.text)))
    except Exception as e:
        logger.warning("[industry_map] Finviz universe fetch failed: %s", e)
        return []


def _upsert_many(rows: list[tuple]) -> None:
    """rows = [(ticker, sector, industry, source, fetched_at), ...]"""
    if not rows:
        return
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.executemany(
            """INSERT INTO industry_map (ticker, sector, industry, source, fetched_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                 sector = excluded.sector,
                 industry = excluded.industry,
                 source = excluded.source,
                 fetched_at = excluded.fetched_at""",
            rows,
        )
        c.commit()


def bulk_refresh_from_finviz() -> int:
    """Refresh the entire map from one Finviz export. Returns rows written."""
    rows = _fetch_finviz_universe()
    if not rows:
        return 0
    now = int(time.time())
    out = []
    for row in rows:
        t = (row.get("Ticker") or "").strip().upper()
        if not t:
            continue
        sector = (row.get("Sector") or "").strip() or None
        industry = (row.get("Industry") or "").strip() or None
        out.append((t, sector, industry, "finviz", now))
    _upsert_many(out)
    global _LAST_REFRESH_AT
    _LAST_REFRESH_AT = time.time()
    logger.info("[industry_map] bulk refresh from Finviz wrote %d rows", len(out))
    return len(out)


# ── Per-ticker fallback (rare stragglers not in the Finviz set) ──────────────

_FALLBACK_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ind-fallback")
_FALLBACK_INFLIGHT: set = set()
_FALLBACK_LOCK = threading.Lock()
_FALLBACK_CAP = 8


def _fetch_fallback(ticker: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (sector, industry, source) for a ticker Finviz didn't cover.
    Tries yfinance (finest, GICS-style industry) then Finnhub. Never raises."""
    # yfinance
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info or {}
        ind = (info.get("industry") or "").strip() or None
        sec = (info.get("sector") or "").strip() or None
        if ind:
            return sec, ind, "yfinance"
    except Exception as e:
        logger.info("[industry_map] yfinance fallback %s failed: %s", ticker, e)
    # Finnhub
    try:
        key = os.environ.get("FINNHUB_API_KEY", "")
        if key:
            r = httpx.get(
                "https://finnhub.io/api/v1/stock/profile2",
                params={"symbol": ticker, "token": key},
                timeout=10.0,
            )
            if r.status_code == 200:
                j = r.json() or {}
                ind = (j.get("finnhubIndustry") or "").strip() or None
                if ind:
                    return None, ind, "finnhub"
    except Exception as e:
        logger.info("[industry_map] finnhub fallback %s failed: %s", ticker, e)
    return None, None, None


def _enqueue_fallback(ticker: str) -> None:
    with _FALLBACK_LOCK:
        if ticker in _FALLBACK_INFLIGHT or len(_FALLBACK_INFLIGHT) >= _FALLBACK_CAP:
            return
        _FALLBACK_INFLIGHT.add(ticker)

    def _job():
        try:
            sec, ind, src = _fetch_fallback(ticker)
            if ind:
                _upsert_many([(ticker, sec, ind, src, int(time.time()))])
        finally:
            with _FALLBACK_LOCK:
                _FALLBACK_INFLIGHT.discard(ticker)

    try:
        _FALLBACK_POOL.submit(_job)
    except Exception:
        with _FALLBACK_LOCK:
            _FALLBACK_INFLIGHT.discard(ticker)


# ── Public API ──────────────────────────────────────────────────────────────

def _count() -> int:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) FROM industry_map").fetchone()[0]


def _newest_fetched_at() -> int:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT MAX(fetched_at) FROM industry_map").fetchone()
        return int(row[0]) if row and row[0] else 0


def _maybe_self_heal() -> None:
    """If the map is empty or stale, kick a guarded background bulk refresh."""
    global _REFRESH_INFLIGHT
    try:
        empty = _count() == 0
        stale = (int(time.time()) - _newest_fetched_at()) > _STALE_SECONDS
    except Exception:
        return
    if not (empty or stale):
        return
    with _REFRESH_LOCK:
        if _REFRESH_INFLIGHT:
            return
        if (time.time() - _LAST_REFRESH_AT) < _REFRESH_COOLDOWN and not empty:
            return
        _REFRESH_INFLIGHT = True

    def _job():
        global _REFRESH_INFLIGHT
        try:
            bulk_refresh_from_finviz()
        finally:
            with _REFRESH_LOCK:
                _REFRESH_INFLIGHT = False

    threading.Thread(target=_job, daemon=True, name="industry-map-heal").start()


def get_industries(tickers: list[str]) -> dict[str, Optional[str]]:
    """Return {TICKER: industry|None} for a list of tickers, non-blocking.

    Reads the persisted universe map (instant). Any ticker still missing gets a
    bounded background fallback warm so it resolves on the next call, and an
    empty/stale map triggers a guarded background Finviz refresh.
    """
    _ensure_init()
    want = []
    seen = set()
    for raw in tickers:
        if not raw:
            continue
        t = str(raw).upper()
        if t not in seen:
            seen.add(t)
            want.append(t)
    if not want:
        return {}

    found: dict[str, Optional[str]] = {}
    with contextlib.closing(_connect()) as c:
        # chunk the IN clause to stay well under SQLite's variable limit
        for i in range(0, len(want), 400):
            chunk = want[i:i + 400]
            q = "SELECT ticker, industry FROM industry_map WHERE ticker IN (%s)" % (
                ",".join("?" * len(chunk)))
            for row in c.execute(q, chunk).fetchall():
                found[row["ticker"]] = row["industry"]

    out: dict[str, Optional[str]] = {}
    for t in want:
        ind = found.get(t)
        out[t] = ind
        if not ind:
            _enqueue_fallback(t)

    _maybe_self_heal()
    return out


def _cap_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", "cap_universe.json")


def _classified_tickers() -> set:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT ticker FROM industry_map WHERE industry IS NOT NULL AND industry != ''"
        ).fetchall()
    return {r[0] for r in rows}


def warm_universe_gaps(limit: int = 1500, sleep_s: float = 0.4) -> int:
    """Fill industries for cap_universe tickers the Finviz bulk didn't cover.

    Finviz's whole-market export silently omits a small slice of real symbols
    (~1-2%, e.g. BK / HOLX / PSTG). This walks the cap_universe, finds those
    gaps, and resolves each via the per-ticker fallback (yfinance → Finnhub) so
    the map reaches ~100% of our universe. Slow by design — runs in the startup
    background thread; persists as it goes so reboots are near-instant.
    """
    try:
        import json
        with open(_cap_universe_path(), encoding="utf-8") as fh:
            uni = [str(t).upper() for t in json.load(fh) if t]
    except Exception as e:
        logger.warning("[industry_map] cap_universe load failed: %s", e)
        return 0
    have = _classified_tickers()
    gaps = [t for t in uni if t not in have][:limit]
    if not gaps:
        logger.info("[industry_map] no universe gaps to warm")
        return 0
    filled = 0
    for t in gaps:
        sec, ind, src = _fetch_fallback(t)
        if ind:
            _upsert_many([(t, sec, ind, src, int(time.time()))])
            filled += 1
        time.sleep(sleep_s)
    logger.info("[industry_map] warmed %d/%d universe gaps via fallback", filled, len(gaps))
    return filled


def prewarm() -> None:
    """Startup hook: bulk-refresh from Finviz if empty/stale, then fill the
    cap_universe gaps Finviz misses so the map is ~100% complete."""
    _ensure_init()
    try:
        if _count() == 0 or (int(time.time()) - _newest_fetched_at()) > _STALE_SECONDS:
            n = bulk_refresh_from_finviz()
            logger.info("[industry_map] prewarm bulk complete — %d rows", n)
        else:
            logger.info("[industry_map] prewarm bulk skipped — fresh (%d rows)", _count())
        warm_universe_gaps()
    except Exception as e:
        logger.warning("[industry_map] prewarm failed: %s", e)


def status() -> dict:
    _ensure_init()
    return {
        "rows": _count(),
        "newest_fetched_at": _newest_fetched_at(),
        "stale": (int(time.time()) - _newest_fetched_at()) > _STALE_SECONDS,
    }
