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
    trades as trades_service,
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


@router.post("/positions")
def create_position(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a new open Position (spec §8). Server builds the
    MarketContextSnapshot before insertion so navCount excludes the
    new row."""
    settings = settings_service.get_settings(user["id"])
    context = market_context_service.build_snapshot(user["id"], settings)
    try:
        return positions_service.create_position(user["id"], payload, context)
    except positions_service.PositionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/positions/{position_id}")
def update_position(
    position_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Partial update (spec §9). Server-owned fields in the patch are
    silently dropped. Raise-to-breakeven toggles never mutate stopPrice
    on the server side."""
    try:
        updated = positions_service.update_position(user["id"], position_id, patch)
    except positions_service.PositionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return updated


@router.delete("/positions/{position_id}")
def delete_position(
    position_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete a Position. Historical Trades retain position_id for
    traceability."""
    ok = positions_service.delete_position(user["id"], position_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Position not found")
    return {"deleted": True}


@router.post("/positions/{position_id}/close")
def close_position(
    position_id: str,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Close a Position (full or partial). Writes a Trade row using the
    user's current breakevenRange setting to classify the result, then
    decrements the Position's shares. A full close archives the
    Position via closed_at instead of deleting (§10)."""
    settings = settings_service.get_settings(user["id"])
    try:
        return trades_service.close_position(
            user_id=user["id"],
            position_id=position_id,
            payload=payload,
            settings=settings,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Position not found")
    except trades_service.CloseValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Trades (read) — Phase 4 surface (stats + filters in 5/6) ────────────────

@router.get("/trades")
def list_trades(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """All trades for the current user, newest-first."""
    return {"trades": trades_service.list_trades_for_user(user["id"])}


# ── Market context — Phase 3 ─────────────────────────────────────────────────

@router.get("/market-context")
def get_market_context(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Current market-context snapshot, for pre-filling the Add Position
    modal (spec §8.3). `navCount` reflects open positions BEFORE any
    new addition. `powerTrend` returns null until the derivation rule is
    wired in a later pass."""
    settings = settings_service.get_settings(user["id"])
    return market_context_service.build_snapshot(user["id"], settings)
