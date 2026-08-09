"""Durable store for generated call recaps, plus the spend ledger.

Why this exists: the recap took ~39s to generate and lived in an in-process
`TTLCache`, so it was lost on every redeploy — and this repo has seen eight
deploys in one evening. That made "cached 24h" untrue in practice and put the
39s back in front of a user over and over.

Requirement driving the design: **every ticker must open in under 2-3 seconds,
even for the first user.** Nothing generated on the request path can meet that,
so the request path only ever READS, and a scheduled warmer does the writing.

Keyed by (symbol, quarter) because a recap is about one specific call — a new
quarter is a new artifact, not a refresh of the old one.

Cost is recorded HERE rather than against the catalyst engine's cap. Previously
`get_call_recap` checked `catalyst.cost_guard.may_synthesize` but never called
`record` on the grounded path, so recap spend was simultaneously blockable by
catalyst *and* invisible — the worst of both.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_WRITE_LOCK = threading.Lock()
_ET = ZoneInfo("America/New_York")

DB_PATH = os.environ.get(
    "CALL_RECAP_DB_PATH",
    os.path.join(os.environ.get("DATA_DIR", "/data"), "call_recaps.db"),
)

# Its own cap, in its own currency of truth. Sonnet 5 at ~$0.108/recap measured,
# so the default funds roughly 90 fresh recaps a day.
DAILY_CAP_USD = float(os.environ.get("CALL_RECAP_DAILY_CAP_USD", "10.00"))

# Sonnet 5 list rates, $/token. Overridable so a model swap doesn't silently
# mis-price the ledger.
PRICE_IN  = float(os.environ.get("CALL_RECAP_PRICE_IN",  "3.00")) / 1_000_000
PRICE_OUT = float(os.environ.get("CALL_RECAP_PRICE_OUT", "15.00")) / 1_000_000

_SCHEMA = """
CREATE TABLE IF NOT EXISTS recaps (
  symbol      TEXT NOT NULL,
  quarter     TEXT NOT NULL,
  payload     TEXT NOT NULL,
  model       TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (symbol, quarter)
);
CREATE INDEX IF NOT EXISTS idx_recaps_symbol_created ON recaps(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS spend (
  ts            INTEGER NOT NULL,
  market_date   TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  model         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_spend_date ON spend(market_date);
"""


def _connect() -> sqlite3.Connection:
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db() -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def market_date() -> str:
    return datetime.now(_ET).date().isoformat()


# ── read path (the only thing a request touches) ─────────────────────────────

def get(symbol: str, quarter: Optional[str] = None) -> Optional[dict[str, Any]]:
    """A stored recap, or None. `quarter=None` returns the newest one held.

    This is the whole request path — a SQLite point-read, single-digit ms.
    """
    sym = (symbol or "").upper().strip()
    if not sym:
        return None
    try:
        with contextlib.closing(_connect()) as c:
            if quarter:
                row = c.execute(
                    "SELECT payload FROM recaps WHERE symbol=? AND quarter=?",
                    (sym, quarter)).fetchone()
            else:
                row = c.execute(
                    "SELECT payload FROM recaps WHERE symbol=? "
                    "ORDER BY created_at DESC LIMIT 1", (sym,)).fetchone()
        return json.loads(row[0]) if row else None
    except Exception as exc:
        _log.warning("[recap_store] read failed for %s: %s", sym, exc)
        return None


def has(symbol: str, quarter: str) -> bool:
    """Is this exact call already stored? The warmer's skip check."""
    sym = (symbol or "").upper().strip()
    if not sym or not quarter:
        return False
    try:
        with contextlib.closing(_connect()) as c:
            return c.execute(
                "SELECT 1 FROM recaps WHERE symbol=? AND quarter=?",
                (sym, quarter)).fetchone() is not None
    except Exception:
        return False


# ── write path (warmer only) ─────────────────────────────────────────────────

def put(symbol: str, quarter: str, payload: dict) -> None:
    sym = (symbol or "").upper().strip()
    if not sym or not quarter or not payload:
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                "INSERT OR REPLACE INTO recaps (symbol, quarter, payload, model, created_at)"
                " VALUES (?,?,?,?,?)",
                (sym, quarter, json.dumps(payload),
                 (payload.get("_usage") or {}).get("model"), int(time.time())))
            c.commit()
    except Exception as exc:
        _log.warning("[recap_store] write failed for %s: %s", sym, exc)


def record_spend(symbol: str, usage: dict) -> float:
    """Log one generation's cost and return it. Called on every LLM call."""
    inp = int((usage or {}).get("input_tokens") or 0)
    out = int((usage or {}).get("output_tokens") or 0)
    cost = inp * PRICE_IN + out * PRICE_OUT
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                "INSERT INTO spend (ts, market_date, symbol, model, input_tokens,"
                " output_tokens, cost_usd) VALUES (?,?,?,?,?,?,?)",
                (int(time.time()), market_date(), (symbol or "").upper(),
                 (usage or {}).get("model"), inp, out, cost))
            c.commit()
    except Exception as exc:
        _log.warning("[recap_store] spend write failed: %s", exc)
    return cost


def spend_today() -> float:
    try:
        with contextlib.closing(_connect()) as c:
            row = c.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM spend WHERE market_date=?",
                            (market_date(),)).fetchone()
        return float(row[0] or 0)
    except Exception:
        return 0.0


def may_spend() -> bool:
    """Its OWN cap — not the catalyst engine's. A research session and the
    catalyst engine must not be able to starve each other."""
    return spend_today() < DAILY_CAP_USD


def stats() -> dict[str, Any]:
    try:
        with contextlib.closing(_connect()) as c:
            stored = c.execute("SELECT COUNT(*) FROM recaps").fetchone()[0]
            today = c.execute(
                "SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM spend WHERE market_date=?",
                (market_date(),)).fetchone()
        return {"stored": stored, "generated_today": today[0],
                "spend_today_usd": round(float(today[1] or 0), 4),
                "daily_cap_usd": DAILY_CAP_USD, "db": DB_PATH}
    except Exception as exc:
        return {"error": str(exc)}
