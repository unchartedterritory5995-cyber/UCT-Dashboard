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
