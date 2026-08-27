# api/routers/push.py
import os
import json
import logging
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from api.services.cache import cache

logger = logging.getLogger(__name__)

# Guarded — accepting wire data must never depend on the alerts module
# (early boot, stripped deploys).
try:
    from api.services import chart_health_alerts
except Exception:  # pragma: no cover
    chart_health_alerts = None

router = APIRouter()

INVALIDATE_KEYS = [
    "wire_data", "breadth", "themes_1W", "themes_1M", "themes_3M", "themes_Today",
    "leadership", "rundown", "earnings", "screener", "movers", "uct20_portfolio", "analyst_actions",
]

# ⚠️ THIS IS THE WRITER. `push_wire_data` `os.makedirs`es this file's directory
# and json-dumps the whole payload into it, so on this Windows box (where `/data`
# really exists) `tests/test_push.py` was overwriting the owner's live
# `C:\data\wire_data.json` — the file `api/main.py`'s lifespan seeds the cache
# from on every boot. `WIRE_DATA_FILE` is the override a test process sets; the
# default is unchanged, so production resolves exactly as before.
#
# ⛔ `api/main.py:192` holds the SAME literal for the boot-time READ and does not
# yet read this variable. That copy is read-only so it corrupts nothing, but the
# two constants are one value with two authorities and should be joined when that
# file is next free (it is being edited by another agent as this ships).
PERSISTENT_WIRE_DATA_FILE = os.environ.get(
    "WIRE_DATA_FILE", "/data/wire_data.json")


def _taxonomy_version_stored():
    """The dashboard's seeded taxonomy version — user_preferences row
    ('system', 'theme_seed_version'), written by theme_db.seed_from_json().
    None when the DB / table / row is unavailable (never raises)."""
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT pref_value FROM user_preferences "
                "WHERE user_id = 'system' AND pref_key = 'theme_seed_version'"
            ).fetchone()
            return row["pref_value"] if row else None
        finally:
            conn.close()
    except Exception:
        return None


def _check_taxonomy_handshake(payload: dict) -> None:
    """Wire ↔ dashboard taxonomy version handshake.

    MORNING-WIRE SIDE (the one-line change is applied to the morning-wire repo
    in Task 7's ops step — do NOT touch that repo from the dashboard): where
    morning_wire_engine.py assembles `_wire_data`, add

        _wire_data["taxonomy_version"] = _TAX_VERSION

    (_TAX_VERSION = the `version` field of the themes_taxonomy.json the engine
    loaded for that run.) Until that ships, payloads carry no
    `taxonomy_version` and this check is a no-op.

    A mismatch means the wire ran against a different taxonomy than the one
    this dashboard has seeded (stale deploy on either side) — theme joins can
    misalign until both sides carry the same version. Log + emit a throttled
    health alert; NEVER block the push.
    """
    wire_v = (payload or {}).get("taxonomy_version")
    if not wire_v:
        return
    db_v = _taxonomy_version_stored()
    if not db_v or wire_v == db_v:
        return
    logger.warning("[push] taxonomy version mismatch: wire=%s dashboard=%s", wire_v, db_v)
    try:
        if chart_health_alerts is not None:
            chart_health_alerts.emit(
                "taxonomy_version_mismatch", "warning",
                message=f"wire taxonomy {wire_v} != dashboard {db_v}",
            )
    except Exception:
        pass


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

    # Taxonomy handshake — warn when the wire ran on a different taxonomy
    # version than this dashboard has seeded (never blocks the push).
    try:
        _check_taxonomy_handshake(payload)
    except Exception:
        pass

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
            # Date from the payload (ET trading date), never the server clock
            record_composition(holdings, date_str=payload.get("date"))
    except Exception:
        pass

    # Trigger theme performance recompute in background (UCT20 holdings may have changed)
    try:
        from api.services.theme_performance import trigger_recompute
        trigger_recompute()
    except Exception:
        pass

    # Pre-synthesize today's read-aloud so the first listener gets instant audio.
    try:
        from api.services.voice_prewarm import prewarm_rundown_async
        rundown_html = payload.get("rundown_html") or ""
        if rundown_html:
            prewarm_rundown_async(rundown_html)
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

    # One authority (spec 2026-08-21): the wire's published score IS the UCT
    # Exposure. The brain's regime opinion stays under intraday_update only.
    regime = payload.get("regime")

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

    from api.services.journal_two import trades as j2_trades
    from api.services.journal_two import accounts as j2_accounts
    # X33 (2026-08-26): this said `from api.services.auth_service import
    # get_auth_connection` -- a name that has NEVER existed there. There is no
    # try/except around it, so `GET /api/push/journal-export` raised ImportError
    # and answered 500 on EVERY call. `auth_db.get_connection()` is the only
    # public door to auth.db (fresh handle, row_factory=Row, PRAGMAs applied).
    # Found by `tests/test_cross_module_imports_resolve.py`, which derives the
    # question from each target module instead of grepping for a name.
    from api.services.auth_db import get_connection as get_auth_connection
    from datetime import date, timedelta, datetime

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

    # Source from J2: get user's default account, fetch closed trades,
    # filter to status=closed and entry_date >= date_from. (J2 doesn't
    # expose date_from / limit kwargs on list_trades_for_user, so we
    # filter + slice client-side.)
    default_acc = j2_accounts.get_or_migrate_default_account(user_id)
    account_id = default_acc["id"]

    all_trades = j2_trades.list_trades_for_user(user_id, account_id=account_id) or []
    # Closed-only + within lookback window. J2 entryDate is ISO date
    # ("YYYY-MM-DD") or full ISO timestamp; lexical compare is correct
    # for both because date_from is plain "YYYY-MM-DD".
    rows = [
        t for t in all_trades
        if t.get("exitDate")  # closed trades have exitDate set
        and (t.get("entryDate") or "") >= date_from
    ][:500]

    # Map J2 camelCase → J1 snake_case export shape (intelligence engine
    # contract). Fields J2 doesn't track emit None so consumers can fall
    # back rather than the field disappearing.
    export = []
    for t in rows:
        side = (t.get("side") or "").lower()  # Long → "long", Short → "short"
        mistake_tags = t.get("mistakeTags") or []
        emotion_tags = t.get("emotionTags") or []
        pnl_percent = t.get("pnlPercent")
        # J2 stores pnlPercent as a fraction (0.05 = 5%); J1 contract
        # was a percent number (5.0).
        pnl_pct_out = pnl_percent * 100.0 if pnl_percent is not None else None

        entry_date = t.get("entryDate") or ""
        try:
            day_of_week = datetime.strptime(entry_date[:10], "%Y-%m-%d").strftime("%A") if entry_date else None
        except ValueError:
            day_of_week = None

        export.append({
            "id": t.get("id"),
            "sym": t.get("symbol"),
            "direction": side,
            "setup": t.get("setup"),
            "entry_date": entry_date,
            "exit_date": t.get("exitDate"),
            "entry_price": t.get("entryPrice"),
            "exit_price": t.get("exitPrice"),
            "stop_price": t.get("originalStop"),
            "pnl_pct": pnl_pct_out,
            "pnl_dollar": t.get("pnlDollar"),
            "realized_r": t.get("rMultiple"),
            "size_pct": None,  # J2 doesn't track this; consumer should fall back
            "shares": t.get("shares"),
            "process_score": None,
            "ps_setup": None,
            "ps_entry": None,
            "ps_exit": None,
            "ps_sizing": None,
            "ps_stop": None,
            "mistake_tags": ",".join(mistake_tags) if mistake_tags else None,
            "emotion_tags": ",".join(emotion_tags) if emotion_tags else None,
            "review_status": None,
            "thesis": None,
            "lesson": None,
            "confidence": None,
            "entry_time": None,
            "exit_time": None,
            "session": None,
            "day_of_week": day_of_week,
            "holding_minutes": None,
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
