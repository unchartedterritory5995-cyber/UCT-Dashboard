"""Intelligence API — Phase 5 endpoints for setup templates, confidence scores,
historical analogs, risk dashboard, psychology events, coaching notes, and
skill assessments.

All data comes from the uct-intelligence engine (cross-repo import).

🔴 ALL TWELVE ROUTES ARE PAID since 2026-08-09. Every one was `get_current_user`
only — a session, never a plan — and signup is open and free, so a free
registration read the whole surface with a `curl`.

**This router IS the Compass brain.** What it serves is the uct-intelligence
knowledge base: the 48 curated setup templates and their per-setup win rates, the
confidence model, leader-persistence scoring, the historical-analog engine, the
risk dashboard, the psychology-event ledger, the coaching notes and the skill
assessments. That is the firm's accumulated research — not market data we relay,
and not a per-user store gated by ownership. It is the single highest-value thing
in the product to copy, and it answered anybody with an email address.

The React router hid the page; `AuthGuard.jsx:139` renders `<Navigate>`, which
redirects a browser and refuses no request. The gate has to be the handler, and
now is.
"""

import sys
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Compass knowledge base.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The Compass knowledge base requires a paid plan")
    return user

# Cross-repo import for uct-intelligence
_UCT_INTEL_PATH_DEFAULT = r"C:\Users\Patrick\uct-intelligence"


def _get_api():
    """Lazy import of uct_intelligence.api to avoid startup failures."""
    path = os.environ.get("UCT_INTEL_PATH", _UCT_INTEL_PATH_DEFAULT)
    if path not in sys.path:
        sys.path.insert(0, path)
    try:
        import uct_intelligence.api as uct
        return uct
    except ImportError:
        return None


# ── Setup Templates ──────────────────────────────────────────────────────────

@router.get("/api/setup-templates")
def list_setup_templates(
    family: Optional[str] = None,
    regime: Optional[str] = None,
    _user: dict = Depends(require_paid),
):
    """List all active setup templates with optional filtering."""
    uct = _get_api()
    if not uct:
        return {"templates": [], "count": 0}

    templates = uct.get_all_setup_templates(active_only=True)

    if family:
        templates = [t for t in templates if t.get("family", "").lower() == family.lower()]

    if regime:
        templates = [
            t for t in templates
            if regime.upper() in [r.upper() for r in t.get("ideal_regime", [])]
        ]

    # Attach performance data for current regime (lightweight)
    for t in templates:
        perf = uct.get_setup_performance(t["name"], regime or "ALL")
        t["performance"] = perf

    return {"templates": templates, "count": len(templates)}


@router.get("/api/setup-templates/{name}")
def get_setup_template(
    name: str,
    _user: dict = Depends(require_paid),
):
    """Get a single setup template with full detail + performance by regime."""
    uct = _get_api()
    if not uct:
        return {"error": "Intelligence engine not available"}

    template = uct.get_setup_template(name)
    if not template:
        # Try resolving alias
        canonical = uct.resolve_setup_name(name)
        if canonical:
            template = uct.get_setup_template(canonical)

    if not template:
        return {"error": f"Setup template '{name}' not found"}

    # Attach performance for all regime phases
    performance = {}
    for phase in ["ALL", "Uptrend", "Pullback", "Recovery", "Rally Attempt", "Distribution", "Downtrend"]:
        perf = uct.get_setup_performance(template["name"], phase)
        if perf:
            performance[phase] = perf
    template["performance_by_regime"] = performance

    return template


# ── Setup Performance ────────────────────────────────────────────────────────

@router.get("/api/setup-performance/{setup_type}")
def get_setup_performance(
    setup_type: str,
    regime: str = "ALL",
    _user: dict = Depends(require_paid),
):
    """Get setup performance stats for a specific type and regime."""
    uct = _get_api()
    if not uct:
        return {"error": "Intelligence engine not available"}

    perf = uct.get_setup_performance(setup_type, regime)
    if not perf:
        return {"setup_type": setup_type, "regime": regime, "data": None,
                "message": "Insufficient data (need 5+ trades)"}
    return {"setup_type": setup_type, "regime": regime, "data": perf}


# ── Confidence Scores ────────────────────────────────────────────────────────

@router.get("/api/confidence-scores/{symbol}")
def get_confidence_score(
    symbol: str,
    _user: dict = Depends(require_paid),
):
    """Get the latest confidence score for a symbol."""
    uct = _get_api()
    if not uct:
        return {"symbol": symbol, "score": None}

    from uct_intelligence.db import get_connection
    with get_connection() as conn:
        row = conn.execute(
            """SELECT * FROM confidence_scores
               WHERE symbol = ? COLLATE NOCASE
               ORDER BY created_at DESC LIMIT 1""",
            (symbol.upper(),),
        ).fetchone()

    if not row:
        return {"symbol": symbol, "score": None}

    import json
    d = dict(row)
    for key in ("qualifying", "invalidating"):
        try:
            d[key] = json.loads(d.get(key, "[]"))
        except (ValueError, TypeError):
            d[key] = []
    return {"symbol": symbol, "score": d}


# ── Leader Persistence ───────────────────────────────────────────────────────

@router.get("/api/leader-persistence/{symbol}")
def get_leader_persistence(
    symbol: str,
    _user: dict = Depends(require_paid),
):
    """Get how many consecutive days a symbol has been on Leadership 20."""
    uct = _get_api()
    if not uct:
        return {"symbol": symbol, "consecutive_days": 0}

    from uct_intelligence.db import get_connection
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT DISTINCT snapshot_date FROM leadership_snapshots
               WHERE symbol = ? COLLATE NOCASE
               ORDER BY snapshot_date DESC LIMIT 30""",
            (symbol.upper(),),
        ).fetchall()

    if not rows:
        return {"symbol": symbol, "consecutive_days": 0, "total_appearances": 0}

    # Count consecutive from most recent
    from datetime import datetime, timedelta
    dates = [r["snapshot_date"] for r in rows]
    consecutive = 1
    for i in range(1, len(dates)):
        try:
            d1 = datetime.strptime(dates[i-1], "%Y-%m-%d")
            d2 = datetime.strptime(dates[i], "%Y-%m-%d")
            # Allow weekend gaps (3 days max between consecutive trading days)
            if (d1 - d2).days <= 3:
                consecutive += 1
            else:
                break
        except ValueError:
            break

    return {
        "symbol": symbol,
        "consecutive_days": consecutive,
        "total_appearances": len(dates),
        "first_seen": dates[-1] if dates else None,
        "last_seen": dates[0] if dates else None,
    }


# ── Historical Analogs ───────────────────────────────────────────────────────

@router.get("/api/analogs")
def get_analogs(
    setup_type: str = Query(...),
    regime: str = "ALL",
    sector: str = "",
    limit: int = 5,
    _user: dict = Depends(require_paid),
):
    """Get historical analogs for a setup type in a regime."""
    uct = _get_api()
    if not uct:
        return {"analogs": [], "count": 0}

    analogs = uct.get_historical_analogs(setup_type, regime, sector, limit)
    return {"analogs": analogs, "count": len(analogs)}


# ── Risk Dashboard ───────────────────────────────────────────────────────────

@router.get("/api/risk-summary")
def get_risk_summary(
    user: dict = Depends(require_paid),
):
    """Get portfolio risk summary from open journal positions."""
    from api.services.journal_two import positions as j2_positions
    from api.services.journal_two import accounts as j2_accounts

    # Resolve the user's Default account (intelligence engine treats one
    # user = one trader). Per-account settings give us accountSize so
    # we can derive size_pct = shares × entry / accountSize.
    default_acc = j2_accounts.get_or_migrate_default_account(user["id"])
    account_id = default_acc["id"]
    settings = j2_accounts.get_account_settings(user["id"], account_id) or {}
    account_size = float(settings.get("accountSize") or 0)

    j2_open = j2_positions.list_open_positions(user["id"], account_id=account_id) or []

    # Map J2 open positions → the dict shape calculate_portfolio_heat /
    # check_sector_concentration / exposure-sum were built for (J1
    # snake_case). Sector enrichment isn't on j2_positions; downstream
    # consumers treat missing sector as None.
    open_trades = []
    for p in j2_open:
        shares = float(p.get("shares") or 0)
        entry = float(p.get("entryPrice") or 0)
        stop = float(p.get("stopPrice") or 0)
        size_dollar = shares * entry
        size_pct = (size_dollar / account_size * 100.0) if account_size > 0 else 0.0
        open_trades.append({
            "sym": (p.get("symbol") or "").upper(),
            "direction": (p.get("side") or "Long").lower(),
            "size_pct": round(size_pct, 2),
            "entry_price": entry,
            "stop_price": stop,
            "shares": shares,
            "setup": p.get("setup"),
        })

    uct = _get_api()
    if not uct:
        return {"heat": {}, "sectors": {}, "protocol": {}, "limits": {}}

    from uct_intelligence.risk import (
        calculate_portfolio_heat,
        check_sector_concentration,
        get_drawdown_protocol,
        get_regime_limits,
    )

    # Get current regime
    from uct_intelligence.db import get_connection
    with get_connection() as conn:
        regime_row = conn.execute(
            "SELECT phase, exposure_pct FROM market_regimes ORDER BY regime_date DESC LIMIT 1"
        ).fetchone()
    regime_phase = regime_row["phase"] if regime_row else "Recovery"
    regime_exposure = regime_row["exposure_pct"] if regime_row else 50

    heat = calculate_portfolio_heat(open_trades)
    sectors = check_sector_concentration(open_trades)
    limits = get_regime_limits(regime_phase)

    # Current exposure (sum of position sizes)
    current_exposure = sum(t.get("size_pct", 0) or 0 for t in open_trades)

    return {
        "heat": heat,
        "sectors": sectors,
        "protocol": get_drawdown_protocol(0),  # drawdown needs equity curve data
        "limits": limits,
        "regime_phase": regime_phase,
        "regime_exposure_pct": regime_exposure,
        "current_exposure_pct": round(current_exposure, 1),
        "open_position_count": len(open_trades),
    }


# ── Psychology Events ────────────────────────────────────────────────────────

@router.get("/api/psychology-events")
def list_psychology_events(
    days: int = 30,
    _user: dict = Depends(require_paid),
):
    """List recent psychology events (overtrading, revenge, FOMO)."""
    uct = _get_api()
    if not uct:
        return {"events": [], "count": 0}

    from uct_intelligence.db import get_connection
    import json
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT * FROM psychology_events
               WHERE event_date >= date('now', ?)
               ORDER BY created_at DESC""",
            (f"-{days} days",),
        ).fetchall()

    events = []
    for r in rows:
        d = dict(r)
        try:
            d["related_trades"] = json.loads(d.get("related_trades", "[]"))
        except (ValueError, TypeError):
            d["related_trades"] = []
        events.append(d)

    return {"events": events, "count": len(events)}


# ── Coaching Notes ───────────────────────────────────────────────────────────

@router.get("/api/coaching-notes")
def list_coaching_notes(
    limit: int = 10,
    note_type: Optional[str] = None,
    _user: dict = Depends(require_paid),
):
    """List recent AI-generated coaching notes."""
    uct = _get_api()
    if not uct:
        return {"notes": [], "count": 0}

    from uct_intelligence.db import get_connection
    import json
    with get_connection() as conn:
        if note_type:
            rows = conn.execute(
                """SELECT * FROM coaching_notes
                   WHERE note_type = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (note_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM coaching_notes ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()

    notes = []
    for r in rows:
        d = dict(r)
        try:
            d["related_trades"] = json.loads(d.get("related_trades", "[]"))
        except (ValueError, TypeError):
            d["related_trades"] = []
        notes.append(d)

    return {"notes": notes, "count": len(notes)}


# ── Skill Assessments ────────────────────────────────────────────────────────

@router.get("/api/skill-assessments")
def list_skill_assessments(
    _user: dict = Depends(require_paid),
):
    """List all skill domain assessments."""
    uct = _get_api()
    if not uct:
        return {"assessments": [], "count": 0}

    from uct_intelligence.db import get_connection
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM skill_assessments ORDER BY skill_domain"
        ).fetchall()

    return {"assessments": [dict(r) for r in rows], "count": len(rows)}


# ── Pre-Trade Checklist ──────────────────────────────────────────────────────

@router.get("/api/pre-trade-checklist")
def get_pre_trade_checklist(
    symbol: str = Query(...),
    setup_type: str = Query(...),
    entry_price: float = Query(...),
    stop_price: float = Query(...),
    _user: dict = Depends(require_paid),
):
    """Generate a pre-trade checklist from setup template rules."""
    uct = _get_api()
    if not uct:
        return {"error": "Intelligence engine not available"}

    return uct.generate_pre_trade_checklist(symbol, setup_type, entry_price, stop_price)


# ── Model Examples (Phase 6 — Modelbook) ─────────────────────────────────────

@router.get("/api/model-examples")
def list_model_examples(
    setup_type: Optional[str] = None,
    grade: Optional[str] = None,
    example_type: Optional[str] = None,
    limit: int = 20,
    _user: dict = Depends(require_paid),
):
    """List model examples with optional filters."""
    uct = _get_api()
    if not uct:
        return {"examples": [], "count": 0}

    examples = uct.get_model_examples(
        setup_type=setup_type,
        grade=grade,
        example_type=example_type,
        limit=limit,
    )
    return {"examples": examples, "count": len(examples)}
