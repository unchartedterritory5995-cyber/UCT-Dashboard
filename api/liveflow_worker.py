"""
Live Flow Worker — Phase A

Phase A scope: consume Bullflow's /v1/streaming/alerts SSE stream from inside
the web service, buffer the last 1000 alerts in memory, expose them via
GET /api/live/alerts/recent. No filters, no Discord, no SQLite persistence.

Why "worker" in the filename despite running in the web service: Phase B will
relocate this to the dedicated `worker` Railway service alongside daily_tracker.py
and friends, add SQLite persistence, filter rules, and Discord webhook
forwarding. Keeping the name now means the file doesn't have to be renamed
during the migration.

CRITICAL: this module assumes a SINGLE replica of the web service. If web is
scaled horizontally each replica opens its own SSE connection to Bullflow,
wasting your custom-alert throttle budget (10/min standard, 60/min API tier)
and creating duplicate alerts in each in-memory buffer. Check Railway settings
before scaling and migrate to Phase B (single worker service) first.
"""
import asyncio
import json
import logging
import os
import re
from collections import deque
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

# ─── Config ──────────────────────────────────────────────────────────────────
BULLFLOW_API_KEY = os.getenv("BULLFLOW_API_KEY", "").strip()
BULLFLOW_SSE_URL = "https://api.bullflow.io/v1/streaming/alerts"
MAX_BUFFER = 1000        # most recent alerts kept in memory (~500KB at full)
RECONNECT_MIN_SEC = 1.0  # initial backoff after a disconnect
RECONNECT_MAX_SEC = 30.0 # cap on exponential backoff

# ─── State (module-level; single event loop = no lock needed) ────────────────
_alerts: deque = deque(maxlen=MAX_BUFFER)
_status = {
    "connected": False,
    "last_event_at": None,
    "total_alerts_received": 0,
    "last_error": None,
    "started_at": None,
    "reconnect_count": 0,
}

# ─── OCC symbol parser ───────────────────────────────────────────────────────
# Format: O:TICKER YYMMDD C|P 8-digit-strike (strike scaled by 1000)
# Example: O:AMD251205P00205000 → AMD / 2025-12-05 / P / $205.00
# Non-greedy ticker match handles rare tickers with embedded digits (e.g. TBL5).
_OCC_RE = re.compile(r"^O:([A-Z0-9]+?)(\d{6})([CP])(\d{8})$")


def parse_occ_symbol(symbol: str) -> dict:
    """Decode an OCC option symbol. Returns dict with None values on parse failure."""
    empty = {"ticker": None, "exp": None, "cp": None, "strike": None, "dte": None}
    if not symbol or not symbol.startswith("O:"):
        return empty
    m = _OCC_RE.match(symbol)
    if not m:
        return empty
    ticker, yymmdd, cp, strike_str = m.groups()
    try:
        year = 2000 + int(yymmdd[:2])
        exp_date = datetime(year, int(yymmdd[2:4]), int(yymmdd[4:6])).date()
    except ValueError:
        return {**empty, "ticker": ticker, "cp": cp}
    strike = int(strike_str) / 1000.0
    today = datetime.now(timezone.utc).date()
    dte = (exp_date - today).days
    return {
        "ticker": ticker,
        "exp": exp_date.strftime("%Y-%m-%d"),
        "cp": cp,
        "strike": strike,
        "dte": dte,
    }


# ─── Public accessors (used by router) ───────────────────────────────────────
def get_recent_alerts(limit: int = 200) -> list:
    """Return newest-first list of buffered alerts."""
    limit = max(1, min(int(limit or 200), MAX_BUFFER))
    # deque stores oldest-first (appended on arrival); reverse for newest-first.
    return list(reversed(_alerts))[:limit]


def get_status() -> dict:
    """Snapshot of connection state for the frontend status indicator."""
    return dict(_status)


# ─── SSE consumer ────────────────────────────────────────────────────────────
async def _consume_stream(client: httpx.AsyncClient) -> None:
    """Open one SSE connection and read alerts until the stream ends or errors."""
    params = {"key": BULLFLOW_API_KEY}
    log.info("[liveflow] connecting to %s", BULLFLOW_SSE_URL)
    async with client.stream(
        "GET", BULLFLOW_SSE_URL, params=params, timeout=None
    ) as response:
        if response.status_code != 200:
            # Auth, subscription, throttle errors arrive here before SSE begins.
            body = await response.aread()
            raise RuntimeError(
                f"SSE handshake failed HTTP {response.status_code}: {body[:200]!r}"
            )
        _status["connected"] = True
        _status["last_error"] = None
        _status["started_at"] = datetime.now(timezone.utc).isoformat()
        log.info("[liveflow] connected, awaiting events")
        async for line in response.aiter_lines():
            if not line or not line.startswith("data: "):
                continue
            try:
                msg = json.loads(line[6:])
            except json.JSONDecodeError as e:
                log.warning("[liveflow] bad JSON line: %s — %r", e, line[:120])
                continue
            event = msg.get("event")
            if event == "alert":
                _ingest_alert(msg)
            elif event == "init":
                log.info("[liveflow] stream init startedAt=%s", msg.get("startedAt"))
            elif event == "heartbeat":
                _status["last_event_at"] = datetime.now(timezone.utc).isoformat()


def _ingest_alert(msg: dict) -> None:
    """Decode + buffer an incoming alert payload."""
    data = msg.get("data") or {}
    symbol = data.get("symbol", "") or ""
    occ = parse_occ_symbol(symbol)
    enriched = {
        "id": msg.get("id"),
        "alertType": data.get("alertType"),       # "algo" | "custom"
        "alertName": data.get("alertName"),       # e.g. "Urgent Repeater"
        "symbol": symbol,                          # raw OCC
        "ticker": occ["ticker"],                   # parsed
        "cp": occ["cp"],
        "strike": occ["strike"],
        "exp": occ["exp"],
        "dte": occ["dte"],
        "alertPremium": data.get("alertPremium"),
        "averageFillPrice": data.get("averageFillPrice"),
        "timestamp": data.get("timestamp"),
        "receivedAt": data.get("receivedAt"),
        "latency": data.get("latency"),
        "deliveryLatency": data.get("deliveryLatency"),
        "ingestedAt": datetime.now(timezone.utc).isoformat(),
    }
    _alerts.append(enriched)
    _status["last_event_at"] = enriched["ingestedAt"]
    _status["total_alerts_received"] += 1


# ─── Forever loop with exponential-backoff reconnect ─────────────────────────
async def run_forever() -> None:
    """Entry point — call as asyncio.create_task on FastAPI startup."""
    if not BULLFLOW_API_KEY:
        log.error("[liveflow] BULLFLOW_API_KEY env var missing — worker disabled")
        _status["last_error"] = "BULLFLOW_API_KEY env var missing"
        return

    backoff = RECONNECT_MIN_SEC
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await _consume_stream(client)
                # Stream closed cleanly (server-side disconnect).
                # Reset backoff and reconnect quickly.
                log.info("[liveflow] stream ended cleanly, reconnecting in %.1fs",
                         RECONNECT_MIN_SEC)
                backoff = RECONNECT_MIN_SEC
            except asyncio.CancelledError:
                log.info("[liveflow] worker cancelled, exiting")
                _status["connected"] = False
                raise
            except Exception as e:
                _status["connected"] = False
                _status["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                _status["reconnect_count"] += 1
                log.warning("[liveflow] connection error: %s (next attempt in %.1fs)",
                            e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_SEC)
