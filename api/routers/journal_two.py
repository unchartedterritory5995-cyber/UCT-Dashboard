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

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import (
    community as community_service,
    csv_import as csv_import_service,
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
    """Create a new open Position (spec §8)."""
    try:
        return positions_service.create_position(user["id"], payload, {})
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


# ── Trades — Phase 4/5 surface (filters in Phase 6) ─────────────────────────

@router.get("/trades")
def list_trades(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """All trades for the current user, newest-first."""
    return {"trades": trades_service.list_trades_for_user(user["id"])}


# ── Community feed — opt-in share ───────────────────────────────────────────

@router.get("/community/traders")
def community_traders(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Per-trader aggregated summary cards for the Community grid.
    Each entry has traderId, display name, trade count, W/L/BE,
    win rate, avg R, avg %, profit factor, hold days, first/last
    trade. Sorted by trade count desc. isMe flags the current user."""
    return {
        "traders": community_service.list_trader_summaries(
            current_user_id=user["id"],
        ),
    }


@router.get("/community/trades")
def community_trades(
    limit: int = 500,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Closed trades from every user who has opted in via
    settings.shareJournalData. Stripped of shares + pnlDollar (which
    would reveal portfolio size); everything else — pnlPercent, R,
    result, setup, context — is kept. Includes traderId + isMe so the
    client can filter by trader and highlight the current user."""
    limit = max(1, min(int(limit or 500), 2000))
    return {
        "trades": community_service.list_shared_trades(
            limit=limit,
            current_user_id=user["id"],
        ),
    }


@router.get("/community/positions")
def community_positions(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Open positions from every opted-in trader. Stripped of shares +
    originalShares (reveal absolute size); entry/stop price levels are
    kept since those are public market data. Includes traderId + isMe."""
    return {
        "positions": community_service.list_shared_open_positions(
            current_user_id=user["id"],
        ),
    }


@router.post("/trades")
def create_trade_manual(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Manual Add Trade (spec §11.4). Non-close write path. Server
    computes derived fields via compute_trade_derived (A3). positionId
    is a 'manual-{uuid}' sentinel (A1)."""
    settings = settings_service.get_settings(user["id"])
    try:
        return trades_service.create_trade_manual(user["id"], payload, settings)
    except trades_service.ManualTradeValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/trades/{trade_id}")
def delete_trade(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete a single trade. 404 if missing or owned by another user."""
    ok = trades_service.delete_trade(user["id"], trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"deleted": True}


@router.delete("/trades")
def delete_all_trades(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete every trade for the user (spec §11.4). Requires a
    body of `{"confirm": "DELETE"}` — matches the §13.4/§15.9 pattern
    of requiring the user type the literal string."""
    if not isinstance(payload, dict) or payload.get("confirm") != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Delete all requires body {\"confirm\": \"DELETE\"}",
        )
    count = trades_service.delete_all_trades(user["id"])
    return {"deleted": count}


# ── CSV Import — Phase 7 ─────────────────────────────────────────────────────

@router.post("/trades/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Parse the uploaded CSV and return a preview. No DB writes.
    Client renders the preview table + error list, then either
    cancels or POSTs to /import/confirm with the parsed trades.

    Spec §13 + §15.9 (10 MB cap, formula-injection sanitization,
    UTF-8/Windows-1252 only)."""
    raw = await file.read()
    try:
        result = csv_import_service.parse_csv(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result.to_dict()


@router.post("/trades/import/preview-mapped")
async def import_preview_mapped(
    file: UploadFile = File(...),
    mapping: str = "",
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Parse an unknown-format CSV using a user-supplied column mapping.
    `mapping` is a JSON string mapping pre-matched field names to source
    CSV header names. Returns the same shape as /import/preview."""
    import csv as _csv
    import io as _io
    import json as _json

    try:
        mapping_dict = _json.loads(mapping) if mapping else {}
    except _json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"mapping is not valid JSON: {e}")

    raw = await file.read()
    try:
        text = csv_import_service.decode_bytes(raw)
        reader = _csv.reader(_io.StringIO(text))
        rows = [[csv_import_service.sanitize_cell(c) for c in r] for r in reader]
        if not rows:
            raise ValueError("CSV has no rows")
        headers = rows[0]
        data_rows = rows[1:]
        result = csv_import_service.parse_with_mapping(headers, data_rows, mapping_dict)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result.to_dict()


@router.post("/trades/import/confirm")
def import_confirm(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Insert a list of parsed trades (as produced by /import/preview)
    in a single transaction. Either all succeed or all roll back."""
    trades = payload.get("trades") if isinstance(payload, dict) else None
    if not isinstance(trades, list):
        raise HTTPException(status_code=400, detail="trades[] is required")

    # Minimal re-validation defense: required fields present, shapes sane.
    # The pre-matched parser already validated everything; this is a
    # second gate against clients sending hand-crafted payloads.
    for i, t in enumerate(trades):
        if not isinstance(t, dict):
            raise HTTPException(400, f"trades[{i}] must be an object")
        for key in ("symbol", "side", "shares", "entryPrice", "entryDate", "exitPrice", "exitDate"):
            if key not in t:
                raise HTTPException(400, f"trades[{i}] missing {key}")
        if t["side"] not in {"Long", "Short"}:
            raise HTTPException(400, f"trades[{i}] invalid side")

    settings = settings_service.get_settings(user["id"])
    result = trades_service.bulk_insert_trades(user["id"], trades, settings)
    return result


