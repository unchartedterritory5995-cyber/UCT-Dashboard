"""
massive_ws_worker.py — Live Massive WebSocket consumer.

Connects to the Massive Options trades stream, aggregates ticks into
SWEEP/BLOCK events, and writes them to FlowDB as if they came from a BBS
CSV upload. OptionsFlow.jsx picks them up automatically via /api/flow/data.

Design:
- Single dedicated thread running its own asyncio loop. Insulates the
  FastAPI event loop from any WS hiccups.
- Guard with acquire_scheduler_lock() — only ONE uvicorn worker runs the
  consumer, mirroring the existing scheduler pattern in main.py L1680.
- Reconnect with exponential backoff. On reconnect, in-flight aggregator
  state is preserved (next message resumes naturally).
- Periodic flush every FLUSH_INTERVAL_SEC: drain completed events,
  convert to BBS CSV, call FlowDB.insert_csv() — same path as the
  existing CSV upload, so dedup, schema, and read path all work unchanged.
- DRY_RUN env var lets the operator deploy and watch logs WITHOUT writing
  to DB. Flip MASSIVE_WS_DRY_RUN=0 once the logs look right.

Mirrors the patterns established in main.py:
- threading.Thread(daemon=True, name="...") for background work
- print() with [tag] prefix for operational logging (visible in Railway logs)
- env-var gates for enabling/disabling

V1 limitations (documented; addressed in V2):
- Side classification stubbed as "" (no NBBO yet — need to also subscribe
  to Q.* and maintain in-memory NBBO per contract)
- Spot/IV/OI/MktCap/Sector/ER stubbed (wire to existing helpers below)
- Per-asset-class connection limit on Massive's side means we only get
  ONE options WS — can't run a parallel "shadow" consumer for testing.
  Use MASSIVE_WS_DRY_RUN=1 instead.
"""

import os
import json
import time
import asyncio
import threading
import logging
from datetime import datetime, date
from io import StringIO
from typing import Optional

logger = logging.getLogger(__name__)


# ── Configuration (all via env vars) ───────────────────────────────

MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "").strip()

# Real-time URL for Advanced plan. The 15-min delayed URL is different
# (delayed.massive.com); we want real-time for live alerts.
MASSIVE_WS_URL = os.environ.get(
    "MASSIVE_WS_URL",
    "wss://socket.massive.com/options",
).strip()

# Subscription pattern. T.* = all trades on all option contracts.
MASSIVE_WS_SUBSCRIBE = os.environ.get("MASSIVE_WS_SUBSCRIBE", "T.*").strip()

# Master kill switch. Set MASSIVE_WS_ENABLED=0 to disable without redeploying.
ENABLED = os.environ.get("MASSIVE_WS_ENABLED", "1").lower() in ("1", "true", "yes")

# Dry-run: parse and aggregate but do NOT write to FlowDB. Useful for the
# first 30-60 minutes after deploy to verify the pipeline works before
# committing rows to the live database.
DRY_RUN = os.environ.get("MASSIVE_WS_DRY_RUN", "0").lower() in ("1", "true", "yes")

# Filters (tunable; defaults match what we validated against the June 22
# BBS export at 80% coverage).
MIN_PREMIUM = float(os.environ.get("MASSIVE_MIN_PREMIUM", "10000"))
MIN_VOLUME = int(os.environ.get("MASSIVE_MIN_VOLUME", "50"))

# How often (seconds) to flush stale aggregator buckets and write to DB.
# 2s = events appear in OptionsFlow.jsx within 2-3 seconds of the trade.
FLUSH_INTERVAL_SEC = float(os.environ.get("MASSIVE_FLUSH_INTERVAL", "2.0"))


# ── Module-level state (read via get_status() for health endpoint) ───

_state = {
    "started_at": None,
    "running": False,
    "connected": False,
    "trades_received": 0,
    "events_emitted": 0,
    "events_written_stocks": 0,
    "events_written_indexes": 0,
    "last_trade_ts": None,
    "last_write_ts": None,
    "reconnect_count": 0,
    "last_error": None,
    "thread": None,
}


def get_status() -> dict:
    """Snapshot of worker state. Wire to a health endpoint if useful."""
    s = dict(_state)
    s.pop("thread", None)
    if s["started_at"]:
        s["uptime_sec"] = round(time.time() - s["started_at"], 1)
    s["dry_run"] = DRY_RUN
    s["enabled"] = ENABLED
    s["min_premium"] = MIN_PREMIUM
    s["min_volume"] = MIN_VOLUME
    return s


# ── Event handling ─────────────────────────────────────────────────

def _events_to_csv(events: list, source: str) -> str:
    """Convert AggEvents → BBS-format CSV string for FlowDB.insert_csv."""
    from massive_processor import event_to_bbs_row
    from api.flow_db import COLUMNS  # Reuse the exact column order

    buf = StringIO()
    buf.write(",".join(COLUMNS) + "\n")
    for evt in events:
        row = event_to_bbs_row(evt, source=source)
        # Quote-safe write — premium/strike never have commas but be defensive
        line = ",".join(str(row.get(c, "")) for c in COLUMNS)
        buf.write(line + "\n")
    return buf.getvalue()


def _write_events(events: list) -> None:
    """Split events into stocks/indexes and write each to FlowDB."""
    from massive_processor import is_index_source

    stocks = [e for e in events if not is_index_source(e.root)]
    indexes = [e for e in events if is_index_source(e.root)]

    if not stocks and not indexes:
        return

    if DRY_RUN:
        logger.info(
            "[massive-ws] DRY_RUN: would write %d stocks + %d indexes events "
            "(skipping FlowDB)", len(stocks), len(indexes)
        )
        _state["events_written_stocks"] += len(stocks)
        _state["events_written_indexes"] += len(indexes)
        return

    try:
        from api.flow_db import FlowDB
        db = FlowDB()

        if stocks:
            csv_str = _events_to_csv(stocks, "stocks")
            result = db.insert_csv(csv_str, source="stocks")
            _state["events_written_stocks"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] stocks: %d inserted, %d skipped (dupes)",
                    result["inserted"], result["skipped"]
                )

        if indexes:
            csv_str = _events_to_csv(indexes, "indexes")
            result = db.insert_csv(csv_str, source="indexes")
            _state["events_written_indexes"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] indexes: %d inserted, %d skipped (dupes)",
                    result["inserted"], result["skipped"]
                )

        _state["last_write_ts"] = time.time()
    except Exception as e:
        logger.exception("[massive-ws] DB write failed: %s", e)
        _state["last_error"] = f"db_write: {e}"


# ── WebSocket consumer ─────────────────────────────────────────────

async def _consume_forever():
    """Outer loop: connect, run, reconnect on failure with backoff."""
    import websockets

    backoff = 1.0
    MAX_BACKOFF = 60.0

    while ENABLED:
        try:
            logger.info("[massive-ws] connecting to %s", MASSIVE_WS_URL)
            async with websockets.connect(
                MASSIVE_WS_URL,
                ping_interval=20,
                ping_timeout=20,
                max_size=2**24,  # 16 MB frames; bursts can be large
            ) as ws:
                _state["connected"] = True
                backoff = 1.0  # successful connect resets backoff

                # 1. Initial status message
                first = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] hello: %s", first[:200])

                # 2. Authenticate
                await ws.send(json.dumps({
                    "action": "auth",
                    "params": MASSIVE_API_KEY,
                }))
                auth_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] auth: %s", auth_resp[:200])
                if "auth_success" not in auth_resp:
                    raise RuntimeError(f"auth failed: {auth_resp[:300]}")

                # 3. Subscribe
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "params": MASSIVE_WS_SUBSCRIBE,
                }))
                sub_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] sub: %s", sub_resp[:200])

                # 4. Drain forever — message loop alongside a periodic flusher
                await _run_session(ws)

        except asyncio.CancelledError:
            logger.info("[massive-ws] cancelled — exiting")
            raise
        except Exception as e:
            _state["connected"] = False
            _state["last_error"] = str(e)
            _state["reconnect_count"] += 1
            logger.warning(
                "[massive-ws] connection error (%s) — reconnect in %.1fs",
                e, backoff,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)

    logger.info("[massive-ws] disabled via env — consumer stopping")


async def _run_session(ws):
    """Handle one connected session: parse trades, periodic flush."""
    from massive_processor import TradeAggregator, RawTrade

    agg = TradeAggregator(min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)

    # Periodic flusher task — runs alongside the receive loop
    stop_event = asyncio.Event()

    async def flusher():
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(),
                                       timeout=FLUSH_INTERVAL_SEC)
            except asyncio.TimeoutError:
                pass
            # Flush by wall clock — close any bucket whose last trade is stale
            now_ns = time.time_ns()
            agg.flush_stale(now_ns)
            events = agg.drain()
            if events:
                _state["events_emitted"] += len(events)
                _write_events(events)

    flusher_task = asyncio.create_task(flusher())

    try:
        async for msg in ws:
            # Massive batches multiple events per WS frame into a JSON array
            try:
                payload = json.loads(msg)
            except json.JSONDecodeError:
                logger.warning("[massive-ws] bad json: %s", msg[:200])
                continue

            if not isinstance(payload, list):
                payload = [payload]

            for evt in payload:
                ev_type = evt.get("ev")
                if ev_type == "T":
                    # Options trade — see schema at
                    # https://massive.com/docs/websocket/options/trades
                    try:
                        sym = evt["sym"]
                        price = float(evt["p"])
                        size = int(evt["s"])
                        exch = int(evt["x"])
                        ts_ms = int(evt["t"])
                        conds = evt.get("c") or []
                        cond = int(conds[0]) if conds else -1
                    except (KeyError, ValueError, TypeError) as e:
                        logger.debug("[massive-ws] skip malformed T: %s (%s)",
                                     evt, e)
                        continue

                    agg.add_trade(RawTrade(
                        ticker=sym,
                        price=price,
                        size=size,
                        exchange=exch,
                        conditions=cond,
                        ts_ns=ts_ms * 1_000_000,  # ms → ns
                    ))
                    _state["trades_received"] += 1
                    _state["last_trade_ts"] = time.time()
                elif ev_type == "status":
                    logger.info("[massive-ws] status: %s", evt)
                else:
                    # Other event types (Q, AM, etc.) — we don't subscribe to
                    # these in V1, but log if they show up unexpectedly.
                    logger.debug("[massive-ws] unhandled ev=%s", ev_type)
    finally:
        stop_event.set()
        try:
            await flusher_task
        except Exception:
            pass
        # Final flush so we don't lose the last few seconds on disconnect
        agg.flush_all()
        events = agg.drain()
        if events:
            _state["events_emitted"] += len(events)
            _write_events(events)


# ── Thread entry point ─────────────────────────────────────────────

def _thread_main():
    """Run the asyncio loop in this dedicated thread."""
    try:
        asyncio.run(_consume_forever())
    except Exception as e:
        logger.exception("[massive-ws] thread crashed: %s", e)
        _state["last_error"] = f"thread_crash: {e}"
    finally:
        _state["running"] = False
        _state["connected"] = False


def start() -> bool:
    """
    Kick off the WS consumer in a background thread.

    Call once during FastAPI startup, AFTER acquire_scheduler_lock() so that
    only one uvicorn worker connects (the per-asset-class connection limit
    on Massive's side would otherwise cause one worker to kick the other off).

    Returns True if the thread was started, False if disabled or missing key.
    """
    if not ENABLED:
        logger.info("[massive-ws] disabled via MASSIVE_WS_ENABLED=0")
        return False
    if not MASSIVE_API_KEY:
        logger.warning("[massive-ws] MASSIVE_API_KEY not set — not starting")
        return False
    if _state["running"]:
        logger.info("[massive-ws] already running — start() ignored")
        return False

    t = threading.Thread(
        target=_thread_main, daemon=True, name="massive-ws-consumer"
    )
    _state["thread"] = t
    _state["started_at"] = time.time()
    _state["running"] = True
    t.start()

    logger.info(
        "[massive-ws] consumer thread started "
        "(url=%s, subscribe=%s, min_prem=$%s, min_vol=%d, dry_run=%s)",
        MASSIVE_WS_URL, MASSIVE_WS_SUBSCRIBE,
        f"{MIN_PREMIUM:,.0f}", MIN_VOLUME, DRY_RUN,
    )
    return True
