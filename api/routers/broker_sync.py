"""Broker Sync HTTP router — `/api/j2/broker/*`.

Thin layer over `journal_two.broker.service`. Connect/refresh/disconnect
are gated to paid plans (SnapTrade has a per-connected-user cost); status
is readable by any logged-in user so the UI can show the upsell + the
"not configured" state.

Kept in its own router file (rather than the 150-endpoint journal_two.py)
to isolate the feature and minimize merge surface.
"""

from __future__ import annotations

import asyncio
import hmac
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user,
    require_plan,
    require_admin,
    PAID_PLANS,
)
from api.services import crypto_box
from api.services.journal_two.broker import service as broker_service
from api.services.journal_two.broker import snaptrade_client as snap
from api.services.journal_two.broker import connections as broker_conns

router = APIRouter(prefix="/api/j2/broker", tags=["broker-sync"])

# Paid-plan gate (admins pass via require_plan → get_user_plan returns role-aware).
_paid = require_plan(list(PAID_PLANS))


class ConnectBody(BaseModel):
    consent: bool = False
    customRedirect: str | None = None
    reconnect: str | None = None


class AccountPatch(BaseModel):
    syncEnabled: bool | None = None


class DisconnectBody(BaseModel):
    purgeTrades: bool = False


def _guard_configured() -> None:
    if not snap.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Brokerage sync is not configured on this server.",
        )


@router.get("/status")
def get_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Connection + per-account summary. Any logged-in user (so the upsell
    and 'not configured' states can render)."""
    return broker_service.status(user["id"])


@router.post("/connect")
async def connect(body: ConnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Register the SnapTrade identity (first time) + return the
    Connection-Portal URL. Requires explicit consent."""
    _guard_configured()
    if not body.consent:
        raise HTTPException(status_code=400, detail="Consent is required to connect a brokerage.")
    try:
        return await broker_service.connect(
            user["id"],
            custom_redirect=body.customRedirect,
            reconnect=body.reconnect,
        )
    except snap.SnapNotConfigured:
        raise HTTPException(status_code=503, detail="Brokerage sync is not configured.")
    except snap.SnapRateLimited:
        raise HTTPException(status_code=429, detail="Brokerage service busy — try again shortly.")
    except snap.SnapAuthError:
        raise HTTPException(status_code=502, detail="Brokerage service rejected the request.")
    except snap.SnapTransient:
        raise HTTPException(status_code=503, detail="Brokerage service temporarily unavailable.")


@router.post("/accounts/refresh")
async def refresh_accounts(user: dict = Depends(_paid)) -> dict[str, Any]:
    """After the portal returns, list + map the user's brokerage accounts."""
    _guard_configured()
    try:
        accounts = await broker_service.refresh_accounts(user["id"])
        return {"accounts": accounts}
    except broker_service.NoBrokerConnection:
        raise HTTPException(status_code=409, detail="No brokerage connection. Connect first.")
    except snap.SnapUserSecretInvalid:
        raise HTTPException(status_code=409, detail="Connection expired — please reconnect.")
    except snap.SnapRateLimited:
        raise HTTPException(status_code=429, detail="Brokerage service busy — try again shortly.")
    except snap.SnapTransient:
        raise HTTPException(status_code=503, detail="Brokerage service temporarily unavailable.")


@router.post("/sync")
async def sync_now(
    user: dict = Depends(_paid), full: bool = False, force: bool = False
) -> dict[str, Any]:
    """On-demand sync of the user's connected accounts. Applies a per-account
    cooldown (BROKER_SYNC_COOLDOWN_SEC, default 180s) so opening the journal /
    repeated clicks don't hammer SnapTrade — pass force=1 to bypass, full=1 for
    a full historical backfill (used on first connect)."""
    _guard_configured()
    from api.services.journal_two.broker import sync as broker_sync_engine
    cooldown = 0.0 if (force or full) else float(os.getenv("BROKER_SYNC_COOLDOWN_SEC", "180"))
    results = await broker_sync_engine.sync_all_for_user(
        user["id"], full=full, cooldown_seconds=cooldown)
    return {"results": results}


@router.put("/accounts/{broker_account_id}")
def update_account(
    broker_account_id: str,
    patch: AccountPatch,
    user: dict = Depends(_paid),
) -> dict[str, Any]:
    """Enable/disable sync for a connected account."""
    if patch.syncEnabled is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    ok = broker_conns.set_sync_enabled(user["id"], broker_account_id, patch.syncEnabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found.")
    return broker_conns.get_broker_account(user["id"], broker_account_id)


class DupResolveBody(BaseModel):
    action: str  # 'merge' | 'dismiss'


@router.get("/admin/stats")
def admin_stats(user: dict = Depends(require_admin)) -> dict[str, Any]:
    """Connected-user count + cost estimate ($1.50/connected user/mo SnapTrade)
    + broken connections + recent sync errors. For cost monitoring."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        users = conn.execute("SELECT COUNT(*) AS n FROM j2_broker_users").fetchone()["n"]
        accts = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_accounts WHERE sync_enabled = 1"
        ).fetchone()["n"]
        broken = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_accounts WHERE status = 'broken'"
        ).fetchone()["n"]
        errs = conn.execute(
            "SELECT user_id, broker_account_id, error, started_at FROM j2_broker_sync_log "
            "WHERE status = 'error' ORDER BY started_at DESC LIMIT 20"
        ).fetchall()
        recent_errors = [
            {"userId": r["user_id"], "brokerAccountId": r["broker_account_id"],
             "error": r["error"], "at": r["started_at"]} for r in errs
        ]
    finally:
        conn.close()
    return {
        "connectedUsers": users,
        "syncEnabledAccounts": accts,
        "brokenAccounts": broken,
        "estMonthlyCostUsd": round(users * 1.50, 2),
        "recentErrors": recent_errors,
    }


@router.get("/equity-curve")
def equity_curve(
    days: int = 365, user: dict = Depends(get_current_user)
) -> dict[str, Any]:
    """Daily real broker net-liquidation equity (cash + equity MV + option MV),
    aggregated across the user's connected accounts. Powers the account growth
    chart. Any logged-in user (empty list if not broker-connected)."""
    from api.services.auth_db import get_connection
    days = max(1, min(int(days or 365), 1830))
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT snapshot_date AS date,
                   ROUND(SUM(total_equity), 2) AS equity,
                   ROUND(SUM(cash), 2) AS cash,
                   ROUND(SUM(market_value), 2) AS marketValue
            FROM j2_broker_equity_snapshots
            WHERE user_id = ?
            GROUP BY snapshot_date
            ORDER BY snapshot_date DESC
            LIMIT ?
            """,
            (user["id"], days),
        ).fetchall()
    finally:
        conn.close()
    points = [dict(r) for r in rows][::-1]  # chronological
    return {"points": points}


@router.get("/dup-flags")
def list_dup_flags(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Pending duplicate-candidate flags (manual vs broker) with both trade
    summaries for side-by-side review."""
    from api.services.journal_two.broker import dedup
    return {"flags": dedup.list_flags(user["id"])}


@router.post("/dup-flags/{flag_id}")
def resolve_dup_flag(
    flag_id: str, body: DupResolveBody, user: dict = Depends(_paid)
) -> dict[str, Any]:
    """Resolve a duplicate flag: 'merge' (keep broker trade, fold in manual
    notes, drop the manual row) or 'dismiss' (keep both)."""
    from api.services.journal_two.broker import dedup
    try:
        return dedup.resolve_flag(user["id"], flag_id, body.action)
    except dedup.DupFlagError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/connections")
async def disconnect(body: DisconnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Disconnect: revoke at SnapTrade + purge credentials. Optionally also
    delete broker-imported trade data."""
    return await broker_service.disconnect(user["id"], purge_trades=body.purgeTrades)


# Keep references to fire-and-forget webhook sync tasks so they aren't GC'd.
_webhook_tasks: set = set()
_WEBHOOK_MAX_INFLIGHT = int(os.getenv("BROKER_WEBHOOK_MAX_INFLIGHT", "20"))


@router.post("/webhook")
async def webhook(request: Request) -> dict[str, Any]:
    """SnapTrade webhook. Authenticated by a shared secret in the body
    (SNAPTRADE_WEBHOOK_SECRET, set in the SnapTrade dashboard) — NOT by user
    session. On a data-changing event we trigger a background sync for that
    user so the journal updates reactively (reducing polling pressure)."""
    secret = os.getenv("SNAPTRADE_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="Webhooks not configured.")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON.")
    sent = str(body.get("webhookSecret") or "")
    if not hmac.compare_digest(sent, secret):
        raise HTTPException(status_code=401, detail="Bad webhook secret.")

    # We registered SnapTrade users keyed by our UCT user id, so userId == ours.
    uct_user_id = body.get("userId")
    event = str(body.get("eventType") or body.get("type") or "").upper()
    # Sync ONLY on known data-changing events (an empty/unknown event no longer
    # triggers a sync — narrows the abuse surface).
    sync_events = {
        "CONNECTION_ADDED", "CONNECTION_UPDATED", "ACCOUNT_HOLDINGS_UPDATED",
        "ACCOUNT_TRANSACTIONS_UPDATED", "NEW_ACCOUNT_AVAILABLE", "TRADES_PLACED",
    }
    if not uct_user_id or event not in sync_events:
        return {"ok": True, "ignored": True}
    # Validate the user actually has a broker identity (don't spawn work for
    # arbitrary/forged userIds) and cap concurrent webhook-driven syncs.
    if not broker_conns.has_broker_user(str(uct_user_id)):
        return {"ok": True, "ignored": "unknown user"}
    if len(_webhook_tasks) >= _WEBHOOK_MAX_INFLIGHT:
        return {"ok": True, "deferred": "busy"}

    async def _bg():
        try:
            await broker_service_sync_all(uct_user_id)
        except Exception:
            pass
    task = asyncio.create_task(_bg())
    _webhook_tasks.add(task)
    task.add_done_callback(_webhook_tasks.discard)
    return {"ok": True, "scheduled": True}


async def broker_service_sync_all(user_id: str) -> Any:
    """Indirection so the webhook can trigger a full user sync without a
    top-level import cycle."""
    from api.services.journal_two.broker import sync as broker_sync_engine
    return await broker_sync_engine.sync_all_for_user(user_id)
