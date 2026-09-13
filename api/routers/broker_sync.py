"""Broker Sync HTTP router — `/api/j2/broker/*`.

Thin layer over `journal_two.broker.service`. Connect/refresh/disconnect
are gated to paid plans (SnapTrade has a per-connected-user cost); status
is readable by any logged-in user so the UI can show the upsell + the
"not configured" state.

Kept in its own router file (rather than the 150-endpoint journal_two.py)
to isolate the feature and minimize merge surface.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user,
    require_plan,
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
async def sync_now(user: dict = Depends(_paid)) -> dict[str, Any]:
    """On-demand sync of all the user's connected accounts. (Background
    scheduling is added in a later phase.)"""
    _guard_configured()
    from api.services.journal_two.broker import sync as broker_sync_engine
    results = await broker_sync_engine.sync_all_for_user(user["id"])
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


@router.delete("/connections")
async def disconnect(body: DisconnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Disconnect: revoke at SnapTrade + purge credentials. Optionally also
    delete broker-imported trade data."""
    return await broker_service.disconnect(user["id"], purge_trades=body.purgeTrades)
