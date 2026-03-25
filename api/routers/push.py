# api/routers/push.py
import os
import json
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from api.services.cache import cache

router = APIRouter()

INVALIDATE_KEYS = [
    "wire_data", "breadth", "themes_1W", "themes_1M", "themes_3M", "themes_Today",
    "leadership", "rundown", "earnings", "screener", "movers", "uct20_portfolio", "analyst_actions",
]

PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"


@router.post("/api/push")
def push_wire_data(
    payload: dict,
    authorization: Optional[str] = Header(None),
):
    """Receive wire_data from the local morning wire engine.

    Secured with PUSH_SECRET env var. Invalidates all derived caches
    then stores the full payload so engine_data endpoints serve fresh data.
    Persists to /data/wire_data.json (Railway volume) so cache survives redeploys.
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    for key in INVALIDATE_KEYS:
        cache.invalidate(key)

    cache.set("wire_data", payload, ttl=82800)  # 23 hours

    # Persist to Railway volume so data survives redeploys
    try:
        os.makedirs(os.path.dirname(PERSISTENT_WIRE_DATA_FILE), exist_ok=True)
        with open(PERSISTENT_WIRE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except OSError:
        pass  # Volume not mounted in local dev — safe to ignore

    # Record UCT20 composition snapshot (for portfolio NAV tracking)
    try:
        from api.services.uct20_nav import record_composition
        leadership = payload.get("leadership", [])
        holdings = [e["sym"] for e in leadership if isinstance(e, dict) and "sym" in e]
        if holdings:
            record_composition(holdings)
    except Exception:
        pass

    # Trigger theme performance recompute in background (UCT20 holdings may have changed)
    try:
        from api.services.theme_performance import trigger_recompute
        trigger_recompute()
    except Exception:
        pass

    return {"ok": True, "date": payload.get("date", "")}


@router.post("/api/push/intraday")
def push_intraday(
    payload: dict,
    authorization: Optional[str] = Header(None),
):
    """Receive lightweight intraday updates from autonomous_brain.

    Expected payload:
        mode: str ("open", "midday", "preclose")
        timestamp: str (ISO)
        regime: { phase, trend_score, distribution_days, exposure_pct, risk_score, notes }
        ep_updates: [ { symbol, status, current_price, pct_from_entry, note } ]
        session_notes: str (Claude's session commentary)
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Store as separate cache key — never overwrites wire_data
    cache.set("intraday_update", payload, ttl=14400)  # 4 hours

    # If regime has exposure update, patch the wire_data exposure in cache
    regime = payload.get("regime")
    if regime and "exposure_pct" in regime:
        wire = cache.get("wire_data")
        if wire and isinstance(wire, dict):
            exposure = wire.get("exposure", {})
            if isinstance(exposure, dict):
                exposure["score"] = regime["exposure_pct"]
                exposure["exposure"] = min(regime["exposure_pct"], 100)
                wire["exposure"] = exposure
                cache.set("wire_data", wire, ttl=82800)
                # Invalidate breadth cache so next request picks up new exposure
                cache.invalidate("breadth")

    # Fire alerts for regime changes and exposure shifts
    try:
        from api.services.alerts import alert_regime_change, alert_exposure_shift
        prev_update = cache.get("intraday_update_prev")
        if prev_update and regime:
            old_phase = (prev_update.get("regime") or {}).get("phase", "")
            new_phase = regime.get("phase", "")
            if old_phase and new_phase and old_phase != new_phase:
                alert_regime_change(old_phase, new_phase, regime.get("exposure_pct"))

            old_exp = (prev_update.get("regime") or {}).get("exposure_pct")
            new_exp = regime.get("exposure_pct")
            if old_exp is not None and new_exp is not None and abs(new_exp - old_exp) >= 20:
                direction = "UP" if new_exp > old_exp else "DOWN"
                alert_exposure_shift(old_exp, new_exp, direction)

        # Store current as prev for next comparison
        cache.set("intraday_update_prev", payload, ttl=14400)
    except Exception:
        pass  # Alert logic is non-fatal

    return {"ok": True, "mode": payload.get("mode", ""), "timestamp": payload.get("timestamp", "")}
