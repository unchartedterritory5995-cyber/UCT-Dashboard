"""Per-ticker metadata enrichment: sector, market_cap, avg 30d volume.

Backed by yfinance with a 24h SQLite cache to bound external calls.
Used by sources.py to enrich candidates with the fields that
get_batch_rich_snapshots doesn't provide.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)

_DB_PATH = os.environ.get("CATALYST_METADATA_DB_PATH", "/data/catalyst_metadata.db")
_WRITE_LOCK = threading.Lock()

# 24h cache TTL — sector/cap/ADV don't change meaningfully day-to-day.
_TTL_SECONDS = 24 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ticker_metadata (
  ticker          TEXT PRIMARY KEY,
  sector          TEXT,
  industry        TEXT,
  market_cap      REAL,
  avg_volume_30d  INTEGER,
  fetched_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meta_fetched ON ticker_metadata(fetched_at);
"""


_INIT_DONE = False
_INIT_LOCK = threading.Lock()


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


def _ensure_init():
    """Lazy init — called by every public function."""
    if not _INIT_DONE:
        _init_db()


def _get_cached(ticker: str) -> Optional[dict]:
    _ensure_init()
    cutoff = int(time.time()) - _TTL_SECONDS
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM ticker_metadata WHERE ticker = ? AND fetched_at >= ?",
            (ticker.upper(), cutoff),
        ).fetchone()
        return dict(row) if row else None


def _put_cache(ticker: str, sector: Optional[str], industry: Optional[str],
               market_cap: Optional[float], avg_volume_30d: Optional[int]) -> None:
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO ticker_metadata
               (ticker, sector, industry, market_cap, avg_volume_30d, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                 sector = excluded.sector,
                 industry = excluded.industry,
                 market_cap = excluded.market_cap,
                 avg_volume_30d = excluded.avg_volume_30d,
                 fetched_at = excluded.fetched_at""",
            (ticker.upper(), sector, industry, market_cap, avg_volume_30d,
             int(time.time())),
        )
        c.commit()


def _fetch_via_yfinance(ticker: str) -> dict:
    """Hit yfinance Ticker(t).info. Returns the fields we want or empties on error."""
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info or {}
        return {
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "market_cap": float(info.get("marketCap")) if info.get("marketCap") else None,
            # yfinance gives several avg-volume variants; averageVolume = 10-day avg by default
            "avg_volume_30d": (int(info.get("averageVolume10days")
                                   or info.get("averageVolume")
                                   or info.get("averageDailyVolume10Day")
                                   or 0) or None),
        }
    except Exception as e:
        logger.warning("[ticker_metadata] yfinance failed for %s: %s", ticker, e)
        return {"sector": None, "industry": None, "market_cap": None,
                "avg_volume_30d": None}


def get_metadata(ticker: str) -> dict:
    """Returns dict with sector, industry, market_cap, avg_volume_30d.
    Uses cache when fresh; else fetches fresh + caches.
    Never raises — returns empty fields on any error."""
    if not ticker:
        return {"sector": None, "industry": None, "market_cap": None,
                "avg_volume_30d": None}

    cached = _get_cached(ticker)
    if cached:
        return {
            "sector": cached.get("sector"),
            "industry": cached.get("industry"),
            "market_cap": cached.get("market_cap"),
            "avg_volume_30d": cached.get("avg_volume_30d"),
        }

    fresh = _fetch_via_yfinance(ticker)
    _put_cache(ticker, fresh["sector"], fresh["industry"],
               fresh["market_cap"], fresh["avg_volume_30d"])
    return fresh


def get_metadata_batch(tickers: list[str]) -> dict[str, dict]:
    """Returns {ticker: metadata_dict} for a list of tickers.
    Cache-hits are instant; misses hit yfinance sequentially (yfinance bulk
    calls aren't reliable, and we only enrich ~30-50 tickers per refresh).
    """
    return {t.upper(): get_metadata(t) for t in tickers}


# ── Non-blocking industry lookup (breadth drill grouping) ───────────────────
# Drill lists can hold 90+ tickers; get_metadata() blocks on cold yfinance
# .info calls (~1-2s each, rate-limited). For the breadth "group by industry"
# view we read cache-only and warm misses on a bounded background pool so the
# drill modal never stalls. Mirrors api/routers/ticker_search.py's name
# backfill. Misses resolve on the next modal open (frontend also retries once).
_INDUSTRY_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ind-bf")
_INDUSTRY_INFLIGHT: set = set()
_INDUSTRY_BF_LOCK = threading.Lock()
_INDUSTRY_BF_CAP = 8  # max in-flight backfills at once


def _enqueue_industry_backfill(ticker: str) -> None:
    """Fire-and-forget: warm the metadata cache so the next lookup sees an industry."""
    with _INDUSTRY_BF_LOCK:
        if ticker in _INDUSTRY_INFLIGHT or len(_INDUSTRY_INFLIGHT) >= _INDUSTRY_BF_CAP:
            return
        _INDUSTRY_INFLIGHT.add(ticker)

    def _job():
        try:
            get_metadata(ticker)  # fetches + caches; safe + idempotent
        except Exception as e:
            logger.info("[ticker_metadata] industry backfill %s failed: %s", ticker, e)
        finally:
            with _INDUSTRY_BF_LOCK:
                _INDUSTRY_INFLIGHT.discard(ticker)

    try:
        _INDUSTRY_POOL.submit(_job)
    except Exception:
        with _INDUSTRY_BF_LOCK:
            _INDUSTRY_INFLIGHT.discard(ticker)


def get_industries_nonblocking(tickers: list[str]) -> dict[str, Optional[str]]:
    """Return {TICKER: industry|None} for a list of tickers WITHOUT blocking.

    Reads cache only — cache-misses come back None and are queued to a bounded
    background pool that warms them for the next call. Safe to call on large
    drill lists; never hits the network on the request path.
    """
    out: dict[str, Optional[str]] = {}
    for raw in tickers:
        if not raw:
            continue
        t = str(raw).upper()
        if t in out:
            continue
        cached = _get_cached(t)
        if cached:
            out[t] = cached.get("industry")
        else:
            out[t] = None
            _enqueue_industry_backfill(t)
    return out
