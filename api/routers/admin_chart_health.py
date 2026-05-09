"""Admin endpoints for chart-health: audit + quarantine management.

All endpoints require an authenticated admin user (role == 'admin').
The auth dependency is the canonical `require_admin` from
`api.middleware.auth_middleware`, re-exported on this module so tests
can override it via `app.dependency_overrides`.
"""
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from api.services import (
    bars_audit,
    bar_quarantine,
    realtime_stream,
    bar_provenance,
    source_circuit_breaker,
    bar_self_heal,
    bar_quality_score,
    chart_health_alerts,
    bars_hot_tier,
)
from api.middleware.auth_middleware import require_admin

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/bars", tags=["admin-charts"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_universe() -> list[str]:
    """Load the cap_universe.json static list. Empty list on any failure."""
    path = os.path.join("api", "data", "cap_universe.json")
    try:
        with open(path) as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return []
    if isinstance(data, list):
        return [t for t in data if isinstance(t, str)]
    if isinstance(data, dict):
        tickers = data.get("tickers") or []
        return [t for t in tickers if isinstance(t, str)]
    return []


# ── Audit endpoints ──────────────────────────────────────────────────────────

class AuditRunRequest(BaseModel):
    tickers: Optional[list[str]] = None
    tfs: list[str] = ["1", "5", "15", "30", "60", "D", "W", "M"]
    bars_counts: list[int] = [5000]
    parallelism: int = 4
    scope: str = "universe"
    scope_arg: Optional[str] = None


@router.get("/audit/latest")
def get_latest_audit(user=Depends(require_admin)):
    """Return the most recent audit report, or {report: null} if none exist."""
    return {"report": bars_audit.latest_report()}


@router.post("/audit/run")
def run_audit(
    body: AuditRunRequest,
    background_tasks: BackgroundTasks,
    user=Depends(require_admin),
):
    """Kick off an audit in the background; respond immediately.

    If `body.tickers` is omitted, the cap_universe is used. Returns 400 when
    no tickers can be resolved (avoids quietly running a 0-ticker audit).
    """
    tickers = body.tickers or _load_universe()
    if not tickers:
        raise HTTPException(status_code=400, detail="no tickers")

    background_tasks.add_task(
        bars_audit.audit_universe,
        tickers,
        body.tfs,
        body.bars_counts,
        body.parallelism,
        body.scope,
        body.scope_arg,
    )
    return {
        "status": "started",
        "ticker_count": len(tickers),
        "tfs": body.tfs,
    }


# ── Quarantine endpoints ─────────────────────────────────────────────────────

class QuarantineRemoveRequest(BaseModel):
    ticker: str
    tf: str
    bar_time: int


@router.get("/quarantine/count")
def quarantine_count(user=Depends(require_admin)):
    return {"count": bar_quarantine.count()}


@router.get("/quarantine/list")
def quarantine_list(
    ticker: str,
    tf: Optional[str] = None,
    user=Depends(require_admin),
):
    return {"items": bar_quarantine.list_for_ticker(ticker, tf)}


@router.post("/quarantine/remove")
def quarantine_remove(
    body: QuarantineRemoveRequest,
    user=Depends(require_admin),
):
    bar_quarantine.remove(body.ticker, body.tf, body.bar_time)
    return {"ok": True}


# ── Liveness endpoint ────────────────────────────────────────────────────────

@router.get("/liveness")
def liveness(user=Depends(require_admin)):
    return {"ages": realtime_stream.get_last_seen_ages()}


# ── Provenance / source-health / self-heal endpoints ─────────────────────────

@router.get("/provenance")
def provenance_lookup(ticker: str, tf: str, bar_time: int, user=Depends(require_admin)):
    return {"provenance": bar_provenance.get(ticker, tf, bar_time)}


@router.get("/source-health")
def source_health(user=Depends(require_admin)):
    return {
        "sources": source_circuit_breaker.all_states(),
        "by_source": bar_provenance.count_by_source(),
    }


class ForceHealRequest(BaseModel):
    ticker: str
    tf: str
    bar_time: int
    original_source: str = "massive"


@router.post("/force-heal")
def force_heal(body: ForceHealRequest, user=Depends(require_admin)):
    return bar_self_heal.try_heal(body.ticker, body.tf, body.bar_time, body.original_source)


# ── Quality / alerts / hot-tier / smoke endpoints ────────────────────────────

@router.get("/quality")
def quality(tickers: str = "", user=Depends(require_admin)):
    """Return quality scores for the requested ticker list (comma-separated)."""
    syms = [s.strip().upper() for s in tickers.split(",") if s.strip()]
    if not syms:
        from api import main as api_main
        try:
            syms = api_main._resolve_priority_tickers() or []
        except Exception:
            syms = []
    return {"scores": bar_quality_score.compute_universe(syms)}


@router.get("/alerts")
def alerts(user=Depends(require_admin)):
    return {"alerts": chart_health_alerts.list_recent()}


@router.get("/hot-tier")
def hot_tier_status(user=Depends(require_admin)):
    return {"size": bars_hot_tier.size(), "capacity": 500}


_SMOKE_FIXTURE = ["QQQ", "SPY", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "TSLA",
                  "AMZN", "GOOGL", "META", "AMD", "AVGO", "BRK.B", "JPM",
                  "JNJ", "V", "MA", "PG", "XOM"]


@router.post("/smoke")
def smoke_audit(background_tasks: BackgroundTasks, user=Depends(require_admin)):
    """Run a smoke audit against a curated 20-ticker fixture set."""
    background_tasks.add_task(
        bars_audit.audit_universe, _SMOKE_FIXTURE, scope="smoke")
    return {"status": "started", "fixture_size": len(_SMOKE_FIXTURE)}
