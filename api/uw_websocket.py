"""
WebSocket relay: connects to Unusual Whales flow_alerts socket,
transforms each alert into BBS-CSV format, and broadcasts to
all connected frontend clients.
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Set, Optional

import websockets
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("uw_websocket")

UW_API_KEY = os.getenv("UW_API_KEY", "")
UW_WS_URL = "wss://api.unusualwhales.com/api/socket/flow_alerts"

# ── Connected frontend clients ──────────────────────────────────────
active_clients: Set[WebSocket] = set()


# ── BBS CSV transform (mirrors uw_live_flow.py logic) ───────────────
def transform_alert_to_bbs_row(alert: dict) -> Optional[str]:   # ← FIXED
    """
    Convert a single UW flow_alerts JSON payload into a BBS-style CSV row.
    Returns a CSV line string or None if the alert should be skipped.

    Expected UW fields (adjust if their schema differs):
      ticker, strike, expires, put_call, bid_ask, sentiment,
      volume, open_interest, price, underlying_price, total_premium,
      execution_estimate (SWEEP / BLOCK / MULTI), timestamp
    """
    try:
        ticker = alert.get("ticker", "").upper()
        if not ticker:
            return None

        strike = alert.get("strike", "")
        expires = alert.get("expires", "")          # YYYY-MM-DD
        put_call = alert.get("put_call", "").upper()  # CALL / PUT
        option_type = "C" if put_call == "CALL" else "P"

        bid_ask = alert.get("bid_ask", "").upper()   # ASK / BID / MID
        sentiment = alert.get("sentiment", "").upper()

        volume = alert.get("volume", 0)
        oi = alert.get("open_interest", 0)
        price = alert.get("price", 0)
        spot = alert.get("underlying_price", 0)
        premium = alert.get("total_premium", 0)

        exec_type = alert.get("execution_estimate", "").upper()
        # Map to BBS order types
        if "SWEEP" in exec_type:
            order_type = "SWEEP"
        elif "BLOCK" in exec_type:
            order_type = "BLOCK"
        elif "MULTI" in exec_type or "SPLIT" in exec_type:
            order_type = "ML/"
        else:
            order_type = exec_type or "UNKNOWN"

        # Map bid/ask to BBS side codes
        #   AA = At/Above Ask, A = Ask, BB = At/Below Bid, B = Bid, M = Mid
        if bid_ask == "ASK":
            if sentiment in ("BULLISH", "VERY_BULLISH"):
                side = "AA"
            else:
                side = "A"
        elif bid_ask == "BID":
            if sentiment in ("BEARISH", "VERY_BEARISH"):
                side = "BB"
            else:
                side = "B"
        else:
            side = "M"

        # Color logic: check OI exceeded
        if oi > 0 and volume > oi:
            color = "Yellow"  # OI exceeded in 1 trade
        else:
            color = "White"

        # Format expiration to M/D/YYYY for BBS compat
        exp_formatted = expires
        try:
            exp_dt = datetime.strptime(expires, "%Y-%m-%d")
            exp_formatted = exp_dt.strftime("%-m/%-d/%Y")
        except Exception:
            pass

        # Timestamp
        ts_raw = alert.get("timestamp", "")
        time_str = ts_raw
        try:
            ts_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            time_str = ts_dt.strftime("%-I:%M:%S %p")
        except Exception:
            pass

        # BBS CSV columns (match your existing CSV header order):
        # Time,Ticker,Spot,Strike,Exp,C/P,Side,Order,Price,Volume,OI,Premium,Color
        row = ",".join([
            time_str,
            ticker,
            f"{float(spot):.2f}" if spot else "",
            str(strike),
            exp_formatted,
            option_type,
            side,
            order_type,
            f"{float(price):.2f}" if price else "",
            str(volume),
            str(oi),
            f"{float(premium):.0f}" if premium else "",
            color,
        ])
        return row

    except Exception as e:
        logger.warning(f"Transform error: {e} | alert={alert}")
        return None


# ── Broadcast to all connected frontends ────────────────────────────
async def broadcast(message: str):
    """Send a message to every connected frontend WebSocket."""
    dead = set()
    for ws in active_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    active_clients.difference_update(dead)


# ── UW upstream WebSocket listener ──────────────────────────────────
_uw_task = None              # ← FIXED
_uw_connected = False


async def _listen_to_uw():
    """
    Persistent connection to UW WebSocket with auto-reconnect.
    Each incoming alert is transformed and broadcast to frontend clients.
    """
    global _uw_connected
    backoff = 1

    while True:
        try:
            headers = {
                "Authorization": f"Bearer {UW_API_KEY}",
            }
            logger.info(f"Connecting to UW WebSocket: {UW_WS_URL}")

            async with websockets.connect(
                UW_WS_URL,
                additional_headers=headers,
                ping_interval=30,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                _uw_connected = True
                backoff = 1  # reset on successful connect
                logger.info("UW WebSocket connected")

                # Notify frontends of connection status
                await broadcast(json.dumps({
                    "type": "status",
                    "connected": True,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }))

                async for raw_msg in ws:
                    try:
                        alert = json.loads(raw_msg)

                        # UW may send heartbeats or other message types
                        if isinstance(alert, dict) and alert.get("ticker"):
                            csv_row = transform_alert_to_bbs_row(alert)
                            if csv_row:
                                await broadcast(json.dumps({
                                    "type": "flow",
                                    "row": csv_row,
                                    "raw": alert,  # optional: frontend can use for extras
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                }))
                        elif isinstance(alert, list):
                            # Batch of alerts
                            rows = []
                            for a in alert:
                                if isinstance(a, dict) and a.get("ticker"):
                                    r = transform_alert_to_bbs_row(a)
                                    if r:
                                        rows.append(r)
                            if rows:
                                await broadcast(json.dumps({
                                    "type": "flow_batch",
                                    "rows": rows,
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                }))
                    except json.JSONDecodeError:
                        logger.debug(f"Non-JSON message from UW: {raw_msg[:100]}")

        except Exception as e:
            _uw_connected = False
            logger.warning(f"UW WebSocket error: {e}. Reconnecting in {backoff}s...")

            await broadcast(json.dumps({
                "type": "status",
                "connected": False,
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)  # exponential backoff, cap at 60s


def start_uw_listener():
    """Call once at app startup to begin the UW WebSocket listener task."""
    global _uw_task
    if _uw_task is None or _uw_task.done():
        _uw_task = asyncio.create_task(_listen_to_uw())
        logger.info("UW WebSocket listener task started")


def is_uw_connected() -> bool:
    return _uw_connected
