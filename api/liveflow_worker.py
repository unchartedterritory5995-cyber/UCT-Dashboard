"""
Live Flow Router — Phase A

Exposes the in-memory alert buffer to the frontend via a single polling
endpoint. The Live tab in src/pages/LiveFlow.jsx hits this every 5 seconds.

Phase B will add SQLite-backed history endpoints, filter config CRUD, and
Discord forwarding stats.
"""
from fastapi import APIRouter, Query
from pydantic import BaseModel

from api import liveflow_worker

router = APIRouter(prefix="/api/live", tags=["live-flow"])


class UserBlocklistPayload(BaseModel):
    """Body shape for PUT /user-blocklist. Accepts a list of ticker strings."""
    tickers: list[str] = []


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


# ─── User-managed ticker blocklist ─────────────────────────────────────────
# These endpoints let the admin manage a custom ticker exclusion list from
# the LiveFlow UI. Tickers in this list are dropped from BOTH live and
# backtest flows (same _passes_table_filter check applies to both).
# Persisted to /data/liveflow_user_blocklist.json on the Railway volume.


@router.get("/user-blocklist")
def get_user_blocklist():
    """Return the current user-managed ticker exclusion list (uppercase, sorted)."""
    tickers = liveflow_worker.get_user_blocklist()
    return {"tickers": tickers, "count": len(tickers)}


@router.put("/user-blocklist")
def update_user_blocklist(payload: UserBlocklistPayload):
    """
    Replace the user-managed blocklist with the provided ticker list.
    Tickers are uppercased and trimmed; empties dropped. Persists to disk.
    Returns the cleaned, sorted list.
    """
    new_list = liveflow_worker.set_user_blocklist(payload.tickers)
    return {"tickers": new_list, "count": len(new_list)}


@router.post("/test-discord-post")
async def test_discord_post():
    """
    Manually fire a test Discord post to verify the webhook + embed rendering
    end-to-end. Synthesizes a realistic aggregate, runs it through the actual
    _build_embed() helper, and pushes via the configured DISCORD_WEBHOOK_URL.

    Use this when:
      - Markets are closed and no real alerts will fire today
      - You changed the logo, color scheme, or embed layout and want to confirm
        Discord renders it correctly before market open
      - You want to validate a new env var (UCT_LOGO_URL, webhook URL) without
        waiting for a real alert to fire

    The test embed includes "🧪 TEST" markers in the title and footer so it's
    obviously not a real signal — won't confuse subscribers if the webhook is
    pointed at production. Safe to call repeatedly.
    """
    import datetime as _dt
    import httpx

    if not liveflow_worker.DISCORD_WEBHOOK_URL:
        return {
            "ok": False,
            "error": "DISCORD_WEBHOOK_URL not configured. Set env var first.",
        }

    # Synthesize an aggregate with the exact field shape _build_embed expects.
    # Values picked to exercise every branch: $1.5M premium (medium tier), 2
    # fires (multi-fire badge), proper OI for delta computation, OTM call
    # (moneyness path), Alpha Gold tier (top priority). Real-looking data that
    # subscribers won't mistake for a tradeable signal because of the markers.
    now_ts = _dt.datetime.now(_dt.timezone.utc).timestamp()
    test_agg = {
        "ticker": "TEST",
        "cp": "C",
        "strike": 100.0,
        "exp": "2026-07-17",
        "dte": 28,
        "total_premium": 1_500_000.0,
        "max_premium": 1_500_000.0,
        "total_size": 1500,
        "max_size": 1500,
        "fire_count": 2,
        "best_alert_name": "UCT Test Alert",
        "best_alert_priority": 1,
        "alert_names_seen": {"UCT Test Alert"},
        "first_fire_ts": _dt.datetime.fromtimestamp(now_ts, tz=_dt.timezone.utc).isoformat(),
        "last_fire_ts": _dt.datetime.fromtimestamp(now_ts, tz=_dt.timezone.utc).isoformat(),
        "prior_oi": 5000,
        "spot": 99.50,
        "moneyness_pct": -0.5,
        "moneyness_label": "ATM",
        "avg_fill": 12.50,
        "discord_message_id": None,
    }

    # Build the embed using the production helper so any rendering bug surfaces
    # here too — single source of truth for embed structure.
    embed = liveflow_worker._build_embed(test_agg)

    # Inject "TEST" markers so subscribers can tell this isn't a real signal.
    # We modify the embed AFTER _build_embed so the helper's logic stays clean.
    embed["title"] = "🧪 TEST · " + embed.get("title", "")
    if "footer" in embed and isinstance(embed["footer"], dict):
        embed["footer"]["text"] = (
            "🧪 MANUAL TEST POST · " + embed["footer"].get("text", "")
        )

    payload = {"embeds": [embed]}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                liveflow_worker.DISCORD_WEBHOOK_URL + "?wait=true",
                json=payload,
            )
            r.raise_for_status()
            response_data = r.json()
            return {
                "ok": True,
                "discord_message_id": response_data.get("id"),
                "logo_url_used": liveflow_worker.UCT_LOGO_URL,
                "webhook_status": r.status_code,
                "embed_title": embed["title"],
            }
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "error": f"Discord rejected post: HTTP {e.response.status_code}",
            "response_body": e.response.text[:500],
        }
    except Exception as e:
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:300]}",
        }
