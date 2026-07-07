"""
notable_flow_router.py — FastAPI router for Notable Flow Discord alerts.

Endpoints:
    POST   /api/notable-flow/post          — Tier 1 + Tier 2 (fired after admin CSV upload)
    POST   /api/notable-flow/post-single   — Manual 🚨 button (single ticker, bypasses dedupe by default)
    GET    /api/notable-flow/settings      — Current enabled state + config
    POST   /api/notable-flow/settings      — Toggle enabled
    GET    /api/notable-flow/dedupe        — View current dedupe state (admin debug)
    DELETE /api/notable-flow/dedupe        — Clear dedupe (one ticker or all)

Integration in main.py:
    from api.notable_flow_router import router as notable_flow_router
    app.include_router(notable_flow_router)

Webhook config: set DISCORD_NOTABLE_WEBHOOK_URL on Railway. Separate from
DISCORD_FLOW_WEBHOOK_URL (watchlist bot) and DISCORD_WEBHOOK_URL (breadth bot).
"""

from fastapi import APIRouter, Body, Query, Depends
from api.flow_admin_auth import require_flow_admin
from api import notable_flow

router = APIRouter(prefix="/api/notable-flow", tags=["notable-flow"])


@router.post("/post")
async def post_notable(payload: dict = Body(...), _auth: dict = Depends(require_flow_admin)):
    """Main entry — frontend POSTs after CSV upload completes and D rebuilds.

    Body shape:
      {
        "pulse": {
          "totalBull": ..., "totalBear": ...,
          "tickerCount": ...,
          "leadTicker": {"sym": "NVDA", "net": ...},
          "standouts": [{"sym": "...", "net": ..., "grade": "..."}, ...],
          "dateLabel": "May 30, 2026"
        },
        "hotTickers": [
          {
            "sym": "NVDA", "dir": "BULL",
            "topContract": {"cp": "C", "K": 950, "exp": "6/20/2026",
                            "prem": ..., "hits": ..., "grade": "A+", "side": "AA"},
            "tickerBull": ..., "tickerBear": ...,
            "trigger": "NEW" | "BIG_A" | "OUTSIZED",
            "patterns": [...], "er": false, "sector": "...", "mktcap": ...
          },
          ...
        ]
      }
    """
    pulse = payload.get("pulse") or {}
    hot = payload.get("hotTickers") or []
    return await notable_flow.post_flow_pulse(pulse, hot)


@router.post("/post-single")
async def post_single(payload: dict = Body(...), _auth: dict = Depends(require_flow_admin)):
    """Manual 🚨 button — pushes one ticker. force=true (default) bypasses
    the 24h dedupe so admin can re-alert any ticker on demand."""
    force = payload.get("force", True)
    if not isinstance(force, bool):
        force = str(force).lower() in ("true", "1", "yes")
    return await notable_flow.post_single_ticker(payload, force=force)


@router.get("/settings")
def get_settings():
    return {
        "enabled": notable_flow.is_enabled(),
        "dedupe_hours": notable_flow.DEDUPE_HOURS,
        "has_webhook": bool(notable_flow.DISCORD_NOTABLE_WEBHOOK_URL),
    }


@router.post("/settings")
def update_settings(payload: dict = Body(...), _auth: dict = Depends(require_flow_admin)):
    """Body: {"enabled": true|false}"""
    if "enabled" in payload:
        notable_flow.set_setting("enabled", "1" if payload["enabled"] else "0")
    return {"ok": True, "enabled": notable_flow.is_enabled()}


@router.get("/dedupe")
def get_dedupe():
    """Inspect which tickers are currently in the 24h cooldown window."""
    return {
        "entries": notable_flow.get_dedupe_state(),
        "dedupe_hours": notable_flow.DEDUPE_HOURS,
    }


@router.delete("/dedupe")
def clear_dedupe(ticker: str | None = Query(None), _auth: dict = Depends(require_flow_admin)):
    """Clear dedupe entries. ?ticker=AAPL clears one, no query clears all."""
    removed = notable_flow.clear_dedupe(ticker)
    return {"ok": True, "cleared": ticker or "all", "removed": removed}
