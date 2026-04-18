"""
Journal 2.0 — HTTP router.

All routes under `/api/j2/*`. Every route scopes by `user_id` via the
existing auth middleware (`get_current_user`). Multi-user isolation is
enforced at the query layer (SQLite; RLS n/a).

Endpoints landing per phase:
  Phase 2: settings (THIS FILE)
  Phase 3: positions (read)
  Phase 4: positions (write), /close
  Phase 5: trades (read/write), /delete-all, market-context
  Phase 6: trades (filtered read)
  Phase 7: trades/import

Spec §5, audit §4.3.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import (
    market_context as market_context_service,
    positions as positions_service,
    settings as settings_service,
)

router = APIRouter(prefix="/api/j2", tags=["journal-2-0"])


# ── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Read the current user's Journal 2.0 settings, seeding defaults on
    first read (spec §5)."""
    return settings_service.get_settings(user["id"])


@router.put("/settings")
def put_settings(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Replace the current user's Journal 2.0 settings. Server validates
    the payload shape (§4) and enforces the BE-range `enabled` invariant
    (value != 0 → enabled=True)."""
    try:
        return settings_service.upsert_settings(user["id"], payload)
    except settings_service.SettingsValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Positions (read) — Phase 3 ───────────────────────────────────────────────

@router.get("/positions")
def list_positions(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """All open positions for the current user (spec §7)."""
    return {"positions": positions_service.list_open_positions(user["id"])}


@router.get("/positions/{position_id}")
def get_position(
    position_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Single position by id. 404 if missing or owned by another user."""
    got = positions_service.get_position(user["id"], position_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return got


# ── Market context — Phase 3 ─────────────────────────────────────────────────

@router.get("/market-context")
def get_market_context(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Current market-context snapshot, for pre-filling the Add Position
    modal (spec §8.3). `navCount` reflects open positions BEFORE any
    new addition. `powerTrend` returns null until the derivation rule is
    wired in a later pass."""
    settings = settings_service.get_settings(user["id"])
    return market_context_service.build_snapshot(user["id"], settings)
