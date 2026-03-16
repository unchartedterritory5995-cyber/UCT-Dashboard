"""
FastAPI WebSocket router for live flow streaming.
Mount this in main.py alongside your existing routers.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from .uw_websocket import active_clients, is_uw_connected

router = APIRouter()


@router.websocket("/ws/live-flow")
async def live_flow_ws(websocket: WebSocket):
    """
    Frontend clients connect here to receive real-time flow alerts.
    Messages are JSON with type: "flow" | "flow_batch" | "status"
    """
    await websocket.accept()
    active_clients.add(websocket)

    try:
        # Send initial connection status
        import json
        from datetime import datetime, timezone
        await websocket.send_text(json.dumps({
            "type": "status",
            "connected": is_uw_connected(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "clients": len(active_clients),
        }))

        # Keep connection alive — listen for pings/close from client
        while True:
            data = await websocket.receive_text()
            # Client can send "ping" to keep alive
            if data == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        pass
    finally:
        active_clients.discard(websocket)


@router.get("/api/ws/status")
async def ws_status():
    """Health check for WebSocket relay status."""
    return {
        "uw_connected": is_uw_connected(),
        "frontend_clients": len(active_clients),
    }
