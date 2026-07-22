"""Single-stock leveraged/inverse ETF family map.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md.
Shape mirrors industry_map.py (bulk Finviz export -> /data SQLite) with
deliberate divergences: fail-closed validation gates, per-run meta record,
no empty-table self-heal cooldown bypass, and auth-token log redaction.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Exact header names asserted on EVERY rebuild (spec §3.4 gate 1).
EXPECTED_HEADERS = ["Ticker", "Company", "Sector", "Industry", "Average Volume", "Price"]
_EXPORT_COLS = "1,2,3,4,63,65"  # ids config; headers are the runtime contract


def _num(v) -> Optional[float]:
    """Finviz numeric: '1,234,567' | '12.34' | '-' | '' -> float | None.
    Unparseable NEVER coerces to 0 — zeros feed the liquidity gate (spec §3.4)."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "n/a", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _fetch_finviz_market() -> list[dict]:
    """Whole-market export (~11k rows) — ETF rows + stock membership in one call.
    Token passed via params and NEVER logged (redaction test-pinned)."""
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        logger.warning("[ssetf] FINVIZ_API_KEY not set — fetch skipped")
        return []
    url = "https://elite.finviz.com/export.ashx"
    try:
        r = httpx.get(
            url,
            params={"v": "152", "c": _EXPORT_COLS, "auth": token},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
            timeout=90.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        return list(csv.DictReader(io.StringIO(r.text)))
    except httpx.HTTPStatusError as e:
        logger.warning("[ssetf] Finviz fetch failed: HTTP %s (url redacted)",
                       e.response.status_code)
        return []
    except Exception as e:
        logger.warning("[ssetf] Finviz fetch failed: %s", type(e).__name__)
        return []


# ── Store ────────────────────────────────────────────────────────────────────

def _resolve_db_path() -> str:
    override = os.environ.get("SSETF_DB_PATH")
    if override:
        return override
    if os.path.isdir("/data"):
        return "/data/single_stock_etfs.db"
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    return os.path.join(here, "single_stock_etfs.db")


_WRITE_LOCK = threading.Lock()
_REBUILD_LOCK = threading.Lock()          # single-flight across ALL triggers
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS etfs (
  etf_ticker TEXT PRIMARY KEY, underlying TEXT NOT NULL, direction TEXT NOT NULL,
  factor REAL NOT NULL, name TEXT NOT NULL, price REAL, avg_volume REAL,
  avg_dollar_vol REAL, vol_source TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_etfs_underlying ON etfs(underlying);
CREATE TABLE IF NOT EXISTS overrides (
  etf_ticker TEXT PRIMARY KEY, action TEXT NOT NULL,
  underlying TEXT, direction TEXT, factor REAL, note TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS quarantine (
  etf_ticker TEXT PRIMARY KEY, name TEXT, reason TEXT, seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def _db_path() -> str:
    return _resolve_db_path()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    with _INIT_LOCK:
        if _INIT_DONE and os.path.exists(_db_path()):
            return
        parent = os.path.dirname(_db_path())
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


@contextlib.contextmanager
def _write_conn():
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        yield c
        c.commit()


def _meta_set(k: str, v) -> None:
    with _write_conn() as c:
        c.execute("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                  (k, json.dumps(v)))


def _meta_get(k: str, default=None):
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["v"])
    except Exception:
        return default


# ── Lookup (hot path: every chart symbol change) ────────────────────────

_LOOKUP_CACHE: dict[str, tuple[float, dict]] = {}
_LOOKUP_TTL = 600.0
_EMPTY_FAMILY = {"underlying": None, "long": [], "short": [], "best_long": None, "best_short": None}


def invalidate_cache() -> None:
    _LOOKUP_CACHE.clear()


def _row_out(r) -> dict:
    return {"ticker": r["etf_ticker"], "name": r["name"], "factor": r["factor"],
            "avg_dollar_vol": r["avg_dollar_vol"]}


def lookup(symbol: str) -> dict:
    sym = (symbol or "").strip().upper()
    if not sym:
        return dict(_EMPTY_FAMILY)
    hit = _LOOKUP_CACHE.get(sym)
    now = time.time()
    if hit and now - hit[0] < _LOOKUP_TTL:
        return hit[1]
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT underlying FROM etfs WHERE etf_ticker=?", (sym,)).fetchone()
        underlying = row["underlying"] if row else sym
        try:
            rows = c.execute(
                "SELECT * FROM etfs WHERE underlying=? "
                "ORDER BY avg_dollar_vol DESC NULLS LAST, etf_ticker",
                (underlying,),
            ).fetchall()
        except sqlite3.OperationalError:
            # Fallback for SQLite < 3.30 that doesn't support NULLS LAST
            rows = c.execute(
                "SELECT * FROM etfs WHERE underlying=? "
                "ORDER BY avg_dollar_vol IS NULL, avg_dollar_vol DESC, etf_ticker",
                (underlying,),
            ).fetchall()
    if not rows:
        out = dict(_EMPTY_FAMILY)
    else:
        longs = [_row_out(r) for r in rows if r["direction"] == "long"]
        shorts = [_row_out(r) for r in rows if r["direction"] == "short"]
        out = {"underlying": underlying, "long": longs, "short": shorts,
               "best_long": longs[0]["ticker"] if longs else None,
               "best_short": shorts[0]["ticker"] if shorts else None}
    _LOOKUP_CACHE[sym] = (now, out)
    _maybe_self_heal()
    return out


def status() -> dict:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        etf_count = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0]
        family_count = c.execute("SELECT COUNT(DISTINCT underlying) FROM etfs").fetchone()[0]
        quarantine = [dict(r) for r in c.execute(
            "SELECT etf_ticker, name, reason, seen_at FROM quarantine ORDER BY etf_ticker").fetchall()]
    out = {"etf_count": etf_count, "family_count": family_count, "quarantine": quarantine}
    for k in ("last_attempt_at", "last_success_at", "last_status", "last_error",
              "last_counts", "last_diff", "refusals_consecutive", "last_refusal"):
        out[k] = _meta_get(k)
    return out


def _maybe_self_heal() -> None:
    pass
