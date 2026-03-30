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


@router.get("/api/push/journal-export")
def export_journal_for_brain(
    authorization: Optional[str] = Header(None),
    days: int = 30,
    user_email: str = None,
):
    """Export journal trades for the intelligence engine (PUSH_SECRET auth).

    Returns closed trades with process scores, mistake tags, and emotion data
    for psychology detection, coaching, and setup performance feedback.

    Query params:
        days: lookback days (default 30)
        user_email: filter by user email (default: first admin user)
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    from api.services import journal_service
    from api.services.auth_service import get_auth_connection
    from datetime import date, timedelta

    # Resolve user_id
    auth_conn = get_auth_connection()
    try:
        if user_email:
            user = auth_conn.execute(
                "SELECT id FROM users WHERE email = ?", (user_email,)
            ).fetchone()
        else:
            # Default: first admin user
            admin_emails = os.environ.get("ADMIN_EMAILS", "").split(",")
            admin_emails = [e.strip() for e in admin_emails if e.strip()]
            user = None
            for email in admin_emails:
                user = auth_conn.execute(
                    "SELECT id FROM users WHERE email = ?", (email,)
                ).fetchone()
                if user:
                    break
            if not user:
                user = auth_conn.execute(
                    "SELECT id FROM users ORDER BY created_at LIMIT 1"
                ).fetchone()
    finally:
        auth_conn.close()

    if not user:
        return {"trades": [], "record_count": 0, "error": "No user found"}

    user_id = user["id"]
    date_from = (date.today() - timedelta(days=days)).isoformat()

    result = journal_service.list_entries(
        user_id,
        filters={"status": "closed", "date_from": date_from},
        limit=500,
        offset=0,
    )

    trades = result.get("entries", [])

    # Flatten to essential fields for intelligence engine
    export = []
    for t in trades:
        export.append({
            "id": t.get("id"),
            "sym": t.get("sym"),
            "direction": t.get("direction"),
            "setup": t.get("setup"),
            "entry_date": t.get("entry_date"),
            "exit_date": t.get("exit_date"),
            "entry_price": t.get("entry_price"),
            "exit_price": t.get("exit_price"),
            "stop_price": t.get("stop_price"),
            "pnl_pct": t.get("pnl_pct"),
            "pnl_dollar": t.get("pnl_dollar"),
            "realized_r": t.get("realized_r"),
            "size_pct": t.get("size_pct"),
            "shares": t.get("shares"),
            "process_score": t.get("process_score"),
            "ps_setup": t.get("ps_setup"),
            "ps_entry": t.get("ps_entry"),
            "ps_exit": t.get("ps_exit"),
            "ps_sizing": t.get("ps_sizing"),
            "ps_stop": t.get("ps_stop"),
            "mistake_tags": t.get("mistake_tags"),
            "emotion_tags": t.get("emotion_tags"),
            "review_status": t.get("review_status"),
            "thesis": t.get("thesis"),
            "lesson": t.get("lesson"),
            "confidence": t.get("confidence"),
            "entry_time": t.get("entry_time"),
            "exit_time": t.get("exit_time"),
            "session": t.get("session"),
            "day_of_week": t.get("day_of_week"),
            "holding_minutes": t.get("holding_minutes"),
        })

    # Mistake summary
    mistake_counts = {}
    for t in export:
        tags = t.get("mistake_tags") or ""
        for tag in tags.split(","):
            tag = tag.strip()
            if tag:
                mistake_counts[tag] = mistake_counts.get(tag, 0) + 1

    # Avg process score
    ps_values = [t["process_score"] for t in export if t.get("process_score") is not None]
    avg_ps = sum(ps_values) / len(ps_values) if ps_values else 0

    return {
        "trades": export,
        "record_count": len(export),
        "date_from": date_from,
        "days": days,
        "mistake_summary": mistake_counts,
        "avg_process_score": round(avg_ps, 1),
    }
