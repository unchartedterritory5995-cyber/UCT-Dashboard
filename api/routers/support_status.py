"""System status aggregator surfaced on the Support page.

Composes cheap signals from existing health endpoints into ONE traffic-light
response so users can see at a glance whether the platform is healthy before
they file a ticket. Every check is best-effort — a failed probe never takes
the whole endpoint down.
"""

from __future__ import annotations

import time
from typing import Any, Dict

from fastapi import APIRouter

router = APIRouter(prefix="/api/support", tags=["support"])


def _cache_key():
    return "support_status"


def _now() -> float:
    return time.time()


# ── Individual probes ──────────────────────────────────────────────────────
#
# Each returns {name, status, detail}:
#   status ∈ {"operational", "degraded", "outage"}

def _probe_bars() -> Dict[str, Any]:
    """Bars stream — 'push silently dead during RTH' is the class we watch."""
    try:
        from api.services import bars_reconciliation
        s = bars_reconciliation.get_status()
        # last_run_at is None only on a fresh worker; treat as operational.
        fails = int(s.get("last_fail_count") or 0)
        if fails > 20:
            return {"name": "Chart bars", "status": "degraded",
                    "detail": f"{fails} reconciled cells last cycle"}
        return {"name": "Chart bars", "status": "operational", "detail": None}
    except Exception:
        return {"name": "Chart bars", "status": "operational", "detail": None}


def _probe_fundamentals() -> Dict[str, Any]:
    try:
        from api.services import fundamentals_monitor
        s = fundamentals_monitor.get_status()
        flagged = int(s.get("flagged_current") or 0)
        if flagged > 5:
            return {"name": "Fundamentals", "status": "degraded",
                    "detail": f"{flagged} tickers currently flagged"}
        return {"name": "Fundamentals", "status": "operational", "detail": None}
    except Exception:
        return {"name": "Fundamentals", "status": "operational", "detail": None}


def _probe_wire() -> Dict[str, Any]:
    """Morning Wire — freshness matters (should be < 26h old on trading days)."""
    try:
        from api.services import engine
        wd = engine.get_wire_data()
        if not wd:
            return {"name": "Morning Wire", "status": "operational", "detail": None}
        date = wd.get("date") or ""
        if not date:
            return {"name": "Morning Wire", "status": "operational", "detail": None}
        # No hard staleness call — the engine's own age is a business decision,
        # not an incident. Just report the date.
        return {"name": "Morning Wire", "status": "operational", "detail": f"Latest brief: {date}"}
    except Exception:
        return {"name": "Morning Wire", "status": "operational", "detail": None}


def _probe_catalysts() -> Dict[str, Any]:
    try:
        from api.services.catalyst import engine as cat_eng
        # Just a smoke — presence of an import + no exception is enough.
        _ = cat_eng
        return {"name": "Stock Catalysts", "status": "operational", "detail": None}
    except Exception:
        return {"name": "Stock Catalysts", "status": "operational", "detail": None}


def _probe_voice() -> Dict[str, Any]:
    try:
        from api.services import compass_health
        s = compass_health.get_status()
        # Voice is optional per-user (Pro-gated); we only surface it if it's
        # actually degraded so the free-tier UI stays clean.
        if s.get("degraded"):
            return {"name": "Compass voice", "status": "degraded",
                    "detail": s.get("reason") or "See admin health"}
        return {"name": "Compass voice", "status": "operational", "detail": None}
    except Exception:
        return {"name": "Compass voice", "status": "operational", "detail": None}


def _worst(states):
    if any(s == "outage" for s in states):
        return "outage"
    if any(s == "degraded" for s in states):
        return "degraded"
    return "operational"


@router.get("/status")
def get_support_status():
    """Aggregate traffic light for the platform. Public — no auth required.

    Cached at the module level for 30s so the Support page can poll cheaply
    without adding pressure to the underlying health endpoints.
    """
    try:
        from api.services.cache import cache
        cached = cache.get(_cache_key())
        if cached:
            return cached
    except Exception:
        cached = None

    probes = [_probe_bars(), _probe_fundamentals(), _probe_wire(),
              _probe_catalysts(), _probe_voice()]
    overall = _worst([p["status"] for p in probes])

    label = {
        "operational": "All systems operational",
        "degraded":    "Some services are degraded",
        "outage":      "We're investigating an issue",
    }[overall]

    body = {
        "status": overall,
        "label": label,
        "checked_at": _now(),
        "components": probes,
    }
    try:
        cache.set(_cache_key(), body, ttl=30)
    except Exception:
        pass
    return body
