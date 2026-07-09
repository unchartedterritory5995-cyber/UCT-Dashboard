"""Pre-report earnings alerts for My Stocks.

For each alert-enabled user, intersect their My-Stocks set with the reporters
for the given market_date and fire via watchlist_alert_service.deliver_alert_payload.

Dedup table: calendar_alerts_fired (user_id, ticker, market_date) — mirrors
catalyst alert pattern exactly (try_record_alert / INSERT OR IGNORE → IntegrityError).

Gated on CALENDAR_ALERTS_ENABLED=1 environment variable.
Never raises — every error is swallowed and logged.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from datetime import date
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# ── DB ────────────────────────────────────────────────────────────────────────

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_DB_PATH = os.path.join(_DATA_DIR, "calendar_alerts.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS calendar_alerts_fired (
  user_id      TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  market_date  TEXT NOT NULL,
  fired_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, ticker, market_date)
);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


_init_db()


def try_record_alert(user_id: str, ticker: str, market_date: str) -> bool:
    """Atomically record an alert. Returns True if newly recorded (caller
    should fire), False if already fired for this (user, ticker, market_date)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO calendar_alerts_fired (user_id, ticker, market_date, fired_at) "
                "VALUES (?, ?, ?, ?)",
                (user_id, ticker.upper(), market_date, int(time.time())),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError:
            return False


# ── Collect reporters for a market date ──────────────────────────────────────

def _get_reporters_for_date(market_date: str) -> set[str]:
    """Return the set of ticker symbols reporting on market_date.

    Pulls from the weekly calendar cache (calendar_weekly) — built by the
    /api/calendar endpoint — then falls back to a live Finnhub fetch.
    Never raises; returns empty set on failure.
    """
    result: set[str] = set()
    try:
        from api.services.cache import cache
        cal = cache.get("calendar_weekly") or {}
        days = cal.get("days") or {}
        day = days.get(market_date) or {}
        for bucket in ("bmo", "amc", "tbd"):
            for entry in day.get(bucket, []) or []:
                sym = (entry.get("sym") or "").strip().upper()
                if sym:
                    result.add(sym)
        if result:
            return result
    except Exception as e:
        _logger.debug("[cal-alerts] cache path failed: %s", e)

    # Fallback: Finnhub direct fetch
    try:
        import requests
        fh_key = os.environ.get("FINNHUB_API_KEY", "")
        if fh_key:
            r = requests.get(
                "https://finnhub.io/api/v1/calendar/earnings",
                params={"from": market_date, "to": market_date, "token": fh_key},
                timeout=10,
            )
            if r.ok:
                for row in r.json().get("earningsCalendar", []):
                    sym = (row.get("symbol") or "").strip().upper()
                    if sym:
                        result.add(sym)
    except Exception as e:
        _logger.debug("[cal-alerts] Finnhub fallback failed: %s", e)

    return result


# ── Collect all users + their My-Stocks sets ─────────────────────────────────

def _collect_all_users_ticker_sets() -> dict[str, set[str]]:
    """Returns {user_id: all_mine_set} for every user in auth.db.

    Mirrors _collect_user_watchlist_tickers in catalyst/engine.py but uses
    calendar_personalization so the same ticker-set logic is shared.
    """
    out: dict[str, set[str]] = {}
    try:
        from api.services.auth_db import get_connection
        with get_connection() as conn:
            rows = conn.execute("SELECT id FROM users").fetchall()
    except Exception as e:
        _logger.warning("[cal-alerts] failed to list users: %s", e)
        return out

    from api.services import calendar_personalization as cp
    for row in rows:
        uid = str(row[0] if not isinstance(row, dict) else row["id"])
        try:
            sets = cp.get_user_ticker_sets(uid)
            mine = sets.get("all_mine") or set()
            if mine:
                out[uid] = mine
        except Exception as e:
            _logger.debug("[cal-alerts] ticker sets failed for user %s: %s", uid, e)

    return out


# ── Main entry point ──────────────────────────────────────────────────────────

def run_prereport_alerts(market_date: str | None = None) -> int:
    """Fire pre-report earnings alerts for all users whose My-Stocks
    intersect with reporters on market_date.

    Gated on CALENDAR_ALERTS_ENABLED=1. Deduped per (user, ticker, market_date)
    — identical to the catalyst alert dedup pattern. Returns count of alerts
    fired this call.
    """
    if os.environ.get("CALENDAR_ALERTS_ENABLED", "0").lower() not in ("1", "true", "yes"):
        _logger.debug("[cal-alerts] disabled via CALENDAR_ALERTS_ENABLED")
        return 0

    if not market_date:
        from datetime import datetime
        market_date = datetime.now(_ET).strftime("%Y-%m-%d")

    reporters = _get_reporters_for_date(market_date)
    if not reporters:
        _logger.info("[cal-alerts] no reporters found for %s", market_date)
        return 0

    user_sets = _collect_all_users_ticker_sets()
    if not user_sets:
        _logger.info("[cal-alerts] no users with My-Stocks found")
        return 0

    try:
        from api.services.watchlist_alert_service import deliver_alert_payload
    except Exception as e:
        _logger.warning("[cal-alerts] alert service unavailable: %s", e)
        return 0

    fired = 0
    for user_id, mine in user_sets.items():
        matched = mine & reporters
        for ticker in sorted(matched):
            if not try_record_alert(user_id, ticker, market_date):
                continue  # already fired today

            title = f"📅 Earnings Today: ${ticker}"
            message = (
                f"{ticker} is scheduled to report earnings on {market_date}. "
                f"Check the Calendar for estimates and expected move."
            )
            try:
                deliver_alert_payload(
                    user_id=user_id,
                    sym=ticker,
                    title=title,
                    message=message,
                    source="calendar_alert",
                    extra_data={"ticker": ticker, "market_date": market_date},
                )
                fired += 1
            except Exception as e:
                _logger.warning("[cal-alerts] delivery failed for %s/%s: %s",
                                user_id, ticker, e)

    _logger.info("[cal-alerts] fired %d alerts for %s", fired, market_date)
    return fired
