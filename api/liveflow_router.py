"""
Live Flow Router — Phase A

Exposes the in-memory alert buffer to the frontend via a single polling
endpoint. The Live tab in src/pages/LiveFlow.jsx hits this every 5 seconds.

Phase B will add SQLite-backed history endpoints, filter config CRUD, and
Discord forwarding stats.
"""
from fastapi import APIRouter, Query

from api import liveflow_worker

router = APIRouter(prefix="/api/live", tags=["live-flow"])


@router.get("/alerts/recent")
def recent_alerts(limit: int = Query(default=200, ge=1, le=1000)):
    """
    Returns the most recent buffered alerts plus connection status.

    Response shape:
      {
        "status": {
          "connected": bool,
          "last_event_at": ISO timestamp str | null,
          "total_alerts_received": int,
          "last_error": str | null,
          "started_at": ISO timestamp str | null,
          "reconnect_count": int
        },
        "alerts": [
          {
            "id": "1MPDp-Qm6_urgent",
            "alertType": "algo" | "custom",
            "alertName": "Urgent Repeater",
            "symbol": "O:AMD251205P00205000",     # raw OCC
            "ticker": "AMD", "cp": "P", "strike": 205.0,
            "exp": "2025-12-05", "dte": -190,    # parsed from OCC
            "alertPremium": 16965.0,
            "averageFillPrice": 1.31,
            "timestamp": 1764708086.0,           # Bullflow trade time (Unix)
            "receivedAt": 1764708086.751,        # Bullflow ingest time
            "latency": 0.842,
            "deliveryLatency": 0.091,
            "ingestedAt": "2026-06-16T15:42:13.001+00:00"  # our buffer time
          },
          …
        ]
      }
    """
    return {
        "status": liveflow_worker.get_status(),
        "alerts": liveflow_worker.get_recent_alerts(limit=limit),
    }
