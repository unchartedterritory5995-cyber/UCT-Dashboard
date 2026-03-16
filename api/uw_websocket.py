"""
SSE relay: connects to Unusual Whales flow_alerts SSE stream,
transforms each alert into BBS-CSV format, and broadcasts to
all connected frontend clients via WebSocket.
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Set, Optional

import httpx
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("uw_websocket")

UW_API_KEY = os.getenv("UW_API_KEY", "")
UW_SSE_URL = "https://api.unusualwhales.com/api/socket/flow_alerts"

# ── Connected frontend clients ──────────────────────────────────────
active_clients: Set[WebSocket] = set()


# ── BBS CSV transform ───────────────────────────────────────────────
def transform_alert_to_bbs_row(alert: dict) -> Optional[str]:
    """
    Convert a single UW flow_alerts JSON payload into a BBS-style CSV row.
    Returns a CSV line string or None if the alert should be skipped.
    """
    try:
        ticker = (alert.get("ticker") or "").upper()
        if not ticker:
            return None

        strike = alert.get("strike", "")
        expiry = alert.get("expiry", "")
        put_call = (alert.get("type") or "").lower()
        option_type = "C" if put_call == "call" else "P"

        volume = int(alert.get("volume", 0) or 0)
        oi = int(alert.get("open_interest", 0) or 0)
        price = alert.get("price", "0")
        spot = alert.get("underlying_price", "0")
        total_premium = alert.get("total_premium", "0")
        total_size = int(alert.get("total_size", 0) or 0)

        has_sweep = alert.get("has_sweep", False)
        has_multileg = alert.get("has_multileg", False)

        if has_multileg:
            order_type = "ML/"
        elif has_sweep:
            order_type = "SWEEP"
        else:
            order_type = "BLOCK"

        ask_prem = float(alert.get("total_ask_side_prem", 0) or 0)
        bid_prem = float(alert.get("total_bid_side_prem", 0) or 0)

        if ask_prem > 0 and bid_prem == 0:
            side = "AA" if has_sweep else "A"
        elif bid_prem > 0 and ask_prem == 0:
            side = "BB" if has_sweep else "B"
        elif ask_prem > bid_prem:
            side = "A"
        elif bid_prem > ask_prem:
            side = "B"
        else:
            side = "M"

        if oi > 0 and volume > oi:
            color = "Yellow"
        else:
            color = "White"

        exp_formatted = expiry
        try:
            exp_dt = datetime.strptime(expiry, "%Y-%m-%d")
            exp_formatted = exp_dt.strftime("%-m/%-d/%Y")
        except Exception:
            pass

        ts_raw = alert.get("created_at", "")
        time_str = ts_raw
        try:
            ts_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            time_str = ts_dt.strftime("%-I:%M:%S %p")
        except Exception:
            pass

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
            str(total_size if total_size else volume),
            str(oi),
            str(int(float(total_premium))) if total_premium else "",
            color,
        ])
        return row

    except Exception as e:
        logger.warning(f"Transform error: {e} | alert={alert}")
        return None


# ── Broadcast to all connected frontends ────────────────────────────
async def broadcast(message: str):
    dead = set()
    for ws in active_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    active_clients.difference_update(dead)


# ── UW upstream SSE listener ────────────────────────────────────────
_uw_task = None
_uw_connected = False


async def _listen_to_uw():
    """
    Persistent SSE connection to UW flow_alerts with auto-reconnect.
    Each incoming alert is transformed and broadcast to frontend clients.
    """
    global _uw_connected
    backoff = 1

    while True:
        try:
            headers = {
                "Authorization": f"Bearer {UW_API_KEY}",
                "UW-CLIENT-API-ID": "100001",
                "Accept": "application/json",
            }
            logger.info(f"Connecting to UW SSE: {UW_SSE_URL}")

            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", UW_SSE_URL, headers=headers) as resp:
                    if resp.status_code != 200:
                        raise Exception(f"UW SSE returned HTTP {resp.status_code}")

                    _uw_connected = True
                    backoff = 1
                    logger.info("UW SSE connected")

                    await broadcast(json.dumps({
                        "type": "status",
                        "connected": True,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }))

                    # Parse SSE stream
                    buffer = ""
                    async for chunk in resp.aiter_text():
                        buffer += chunk
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()

                            if not line:
                                continue

                            # SSE format: "data: {...json...}"
                            if line.startswith("data:"):
                                json_str = line[5:].strip()
                                if not json_str:
                                    continue
                                try:
                                    alert = json.loads(json_str)

                                    if isinstance(alert, dict) and alert.get("ticker"):
                                        csv_row = transform_alert_to_bbs_row(alert)
                                        if csv_row:
                                            await broadcast(json.dumps({
                                                "type": "flow",
                                                "row": csv_row,
                                                "raw": alert,
                                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                            }))
                                    elif isinstance(alert, list):
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
                                    logger.debug(f"Non-JSON SSE data: {json_str[:100]}")

                            # Also handle raw JSON lines (no "data:" prefix)
                            elif line.startswith("{") or line.startswith("["):
                                try:
                                    alert = json.loads(line)
                                    if isinstance(alert, dict) and alert.get("ticker"):
                                        csv_row = transform_alert_to_bbs_row(alert)
                                        if csv_row:
                                            await broadcast(json.dumps({
                                                "type": "flow",
                                                "row": csv_row,
                                                "raw": alert,
                                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                            }))
                                except json.JSONDecodeError:
                                    pass

        except Exception as e:
            _uw_connected = False
            logger.warning(f"UW SSE error: {e}. Reconnecting in {backoff}s...")

            await broadcast(json.dumps({
                "type": "status",
                "connected": False,
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


def start_uw_listener():
    global _uw_task
    if _uw_task is None or _uw_task.done():
        _uw_task = asyncio.create_task(_listen_to_uw())
        logger.info("UW SSE listener task started")


def is_uw_connected() -> bool:
    return _uw_connected
