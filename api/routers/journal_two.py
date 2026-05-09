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
from fastapi.responses import FileResponse

from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import (
    accounts as accounts_service,
    analytics as analytics_service,
    calendar as calendar_service,
    community as community_service,
    csv_import as csv_import_service,
    discipline as discipline_service,
    options as options_service,
    playbook as playbook_service,
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
def list_positions(
    account_id: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """All open positions for the current user (spec §7).
    Optional ?account_id= filters to one account; omit for All Accounts."""
    return {
        "positions": positions_service.list_open_positions(
            user["id"], account_id=account_id,
        ),
    }


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
    """Create a new open Position (spec §8). If payload.accountId is
    omitted, defaults to the user's Default account (auto-created on
    first call)."""
    acc_id = payload.get("accountId")
    if not acc_id:
        default = accounts_service.get_or_migrate_default_account(user["id"])
        acc_id = default["id"]
    try:
        return positions_service.create_position(
            user["id"], payload, {}, account_id=acc_id,
        )
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
    POSITION'S account's breakevenRange to classify the result."""
    pos = positions_service.get_position(user["id"], position_id)
    if pos is None:
        raise HTTPException(status_code=404, detail="Position not found")
    settings = (
        accounts_service.get_account_settings(user["id"], pos.get("accountId"))
        if pos.get("accountId")
        else settings_service.get_settings(user["id"])
    )
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
def list_trades(
    account_id: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """All trades for the current user, newest-first.
    Optional ?account_id= filters to one account."""
    return {
        "trades": trades_service.list_trades_for_user(
            user["id"], account_id=account_id,
        ),
    }


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
    """Manual Add Trade (spec §11.4). Server computes derived fields.
    positionId is a 'manual-{uuid}' sentinel. account_id defaults to
    the user's Default account if omitted."""
    if not payload.get("accountId"):
        default = accounts_service.get_or_migrate_default_account(user["id"])
        payload = {**payload, "accountId": default["id"]}
    settings = accounts_service.get_account_settings(user["id"], payload["accountId"])
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

    # Stamp account_id on every imported trade — defaults to current
    # selected account (passed in body) or user's Default account.
    account_id = (
        payload.get("accountId") if isinstance(payload, dict) else None
    )
    if not account_id:
        default = accounts_service.get_or_migrate_default_account(user["id"])
        account_id = default["id"]
    settings = accounts_service.get_account_settings(user["id"], account_id)
    result = trades_service.bulk_insert_trades(
        user["id"], trades, settings, account_id=account_id,
    )
    return result


# ── Accounts (Phase 2) ───────────────────────────────────────────────────────


@router.get("/accounts")
def list_accounts(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """All accounts for the current user. Triggers lazy migration of
    legacy single-settings users into a Default account on first call."""
    # Make sure the user's default account exists (idempotent migration)
    accounts_service.get_or_migrate_default_account(user["id"])
    return {"accounts": accounts_service.list_accounts(user["id"])}


@router.post("/accounts")
def create_account_route(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a new account. `copySettingsFrom` (optional) clones an
    existing account's settings."""
    try:
        return accounts_service.create_account(user["id"], payload)
    except accounts_service.AccountConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except accounts_service.AccountValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/comparison")
def get_account_comparison(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-account aggregate metrics for the Comparison view."""
    accounts_service.get_or_migrate_default_account(user["id"])
    return accounts_service.comparison(user["id"])


@router.get("/accounts/{account_id}")
def get_account_route(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    acc = accounts_service.get_account(user["id"], account_id)
    if acc is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return acc


@router.put("/accounts/{account_id}")
def update_account_route(
    account_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        updated = accounts_service.update_account(user["id"], account_id, patch)
    except accounts_service.AccountConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except accounts_service.AccountValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return updated


@router.delete("/accounts/{account_id}")
def delete_account_route(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        ok = accounts_service.delete_account(user["id"], account_id)
    except accounts_service.AccountConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), **e.payload},
        )
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"deleted": True}


@router.post("/accounts/{source_id}/move-all-to/{target_id}")
def move_all_to_route(
    source_id: str,
    target_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return accounts_service.move_all_to(user["id"], source_id, target_id)
    except accounts_service.AccountValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/accounts/{account_id}/goals")
def put_account_goals(
    account_id: str,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Update Daily/Weekly/Monthly/Yearly $ targets for this account."""
    try:
        updated = accounts_service.update_goals(
            user["id"], account_id, payload,
        )
    except accounts_service.AccountValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return updated


@router.get("/accounts/{account_id}/goal-progress")
def get_account_goal_progress(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Current Daily/Weekly/Monthly/Yearly P&L vs each target."""
    got = accounts_service.goal_progress(user["id"], account_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return got


@router.get("/accounts/{account_id}/settings")
def get_account_settings_route(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    settings = accounts_service.get_account_settings(user["id"], account_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return settings


@router.put("/accounts/{account_id}/settings")
def put_account_settings_route(
    account_id: str,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return accounts_service.upsert_account_settings(
            user["id"], account_id, payload,
        )
    except settings_service.SettingsValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except accounts_service.AccountValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/{account_id}/discipline/state")
def get_discipline_state(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Return the per-account session-discipline state.

    Includes today's P&L and any active locks (daily loss, cooling-off,
    no-trade window). Polled by the J2 frontend every 5s while a J2
    modal is open.
    """
    return discipline_service.compute_discipline_state(user["id"], account_id)


# ── Playbook / Stock Observation Library (Phase 5) ──────────────────────────


@router.get("/playbook")
def list_playbook(
    symbol: str | None = None,
    status: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """User's playbook entries, newest first. Optional symbol + status filters."""
    try:
        return {
            "entries": playbook_service.list_entries(
                user["id"], symbol=symbol, status=status,
            ),
        }
    except playbook_service.PlaybookValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/playbook")
def create_playbook(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a new playbook entry (stock observation)."""
    try:
        return playbook_service.create_entry(user["id"], payload)
    except playbook_service.PlaybookValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/playbook/{entry_id}")
def get_playbook(
    entry_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    got = playbook_service.get_entry(user["id"], entry_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Playbook entry not found")
    return got


@router.put("/playbook/{entry_id}")
def update_playbook(
    entry_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        updated = playbook_service.update_entry(user["id"], entry_id, patch)
    except playbook_service.PlaybookValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Playbook entry not found")
    return updated


@router.delete("/playbook/{entry_id}")
def delete_playbook(
    entry_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    ok = playbook_service.delete_entry(user["id"], entry_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Playbook entry not found")
    return {"deleted": True}


@router.post("/playbook/{entry_id}/screenshots")
async def post_playbook_screenshot(
    entry_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Upload a screenshot for a playbook entry."""
    # Verify ownership before writing to disk
    if playbook_service.get_entry(user["id"], entry_id) is None:
        raise HTTPException(status_code=404, detail="Playbook entry not found")
    try:
        return await playbook_service.save_screenshot(user["id"], entry_id, file)
    except playbook_service.PlaybookValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/playbook/attachments/{user_id}/{entry_id}/{filename}")
def get_playbook_screenshot(
    user_id: str,
    entry_id: str,
    filename: str,
    user: dict = Depends(get_current_user),
) -> Any:
    """Serve a previously uploaded playbook screenshot. Owner-only."""
    if user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    path = playbook_service.serve_screenshot_path(user_id, entry_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(path)


# ── Options — multi-leg strategies (Phase 5) ────────────────────────────────


@router.get("/options")
def list_option_strategies(
    account_id: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """All option strategies for the user, newest-first. Filters are optional."""
    try:
        return {
            "strategies": options_service.list_strategies(
                user["id"],
                account_id=account_id,
                status=status,
                date_from=date_from,
                date_to=date_to,
            ),
        }
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/options")
def create_option_strategy(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a new multi-leg option strategy. Defaults to the user's
    Default account if accountId is omitted."""
    acc_id = payload.get("accountId") or payload.get("account_id")
    if not acc_id:
        default = accounts_service.get_or_migrate_default_account(user["id"])
        acc_id = default["id"]
    try:
        return options_service.create_strategy(
            user["id"], payload, account_id=acc_id,
        )
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/options/{strategy_id}")
def get_option_strategy(
    strategy_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    got = options_service.get_strategy(user["id"], strategy_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return got


@router.put("/options/{strategy_id}")
def update_option_strategy(
    strategy_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Metadata-only update (notes/setup/direction/linked_playbook_id).
    Legs are IMMUTABLE; delete + re-create to fix a misrecorded fill."""
    try:
        updated = options_service.update_strategy(user["id"], strategy_id, patch)
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return updated


@router.delete("/options/{strategy_id}")
def delete_option_strategy(
    strategy_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete an OPEN strategy. Closed strategies are historical record
    and cannot be deleted."""
    try:
        ok = options_service.delete_strategy(user["id"], strategy_id)
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"deleted": True}


@router.post("/options/{strategy_id}/close")
def close_option_strategy(
    strategy_id: str,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Close a strategy with per-leg exit prices. Body must include
    exitPrices {legIndex: price}, exitDate, optional exitFees, notes, status."""
    try:
        closed = options_service.close_strategy(user["id"], strategy_id, payload)
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if closed is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return closed


@router.post("/options/{strategy_id}/expire")
def expire_option_strategy(
    strategy_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """One-click expire: all legs' exit_price = 0, status='expired'."""
    try:
        expired = options_service.mark_expired(user["id"], strategy_id)
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if expired is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return expired


@router.post("/options/mark-expired-batch")
def mark_expired_batch_route(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Batch-expire a list of strategy ids. Used by the expired banner."""
    ids = payload.get("strategyIds") or payload.get("strategy_ids")
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="strategyIds must be a list")
    try:
        return options_service.mark_expired_batch(user["id"], ids)
    except options_service.OptionValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Analytics (Phase 3) ──────────────────────────────────────────────────────


@router.get("/analytics")
def get_analytics_route(
    account_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Single mega-endpoint returning all chart data for the Analytics
    tab in one round-trip. Optional account_id + date range filters."""
    if date_from:
        try:
            from datetime import date as Date
            Date.fromisoformat(date_from)
        except ValueError:
            raise HTTPException(status_code=400, detail="date_from must be YYYY-MM-DD")
    if date_to:
        try:
            from datetime import date as Date
            Date.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(status_code=400, detail="date_to must be YYYY-MM-DD")
    return analytics_service.get_analytics(
        user["id"],
        account_id=account_id,
        date_from=date_from,
        date_to=date_to,
    )


# ── Calendar (Phase 1) ───────────────────────────────────────────────────────


@router.get("/calendar")
def get_calendar(
    view: str = "month",
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    account_id: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Aggregate trades into per-day buckets for the requested period.
    `view` = year|month|week. `account_id` is accepted but unused until
    Phase 2 (Accounts) ships."""
    if year is None:
        from datetime import datetime
        year = datetime.now().year
    try:
        return calendar_service.get_calendar(
            user["id"],
            view=view,
            year=year,
            month=month,
            week=week,
            account_id=account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/calendar/day/{date}")
def get_calendar_day(
    date: str,
    account_id: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-day metrics + trade list + saved reflection notes."""
    # Validate date format YYYY-MM-DD
    from datetime import date as Date
    try:
        Date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return calendar_service.get_day_detail(
        user["id"], date, account_id=account_id,
    )


@router.put("/calendar/day/{date}/notes")
def put_calendar_day_notes(
    date: str,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Upsert reflection notes / attachments / rules-checklist for a day."""
    from datetime import date as Date
    try:
        Date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        return calendar_service.upsert_day_notes(user["id"], date, payload)
    except calendar_service.DayNotesValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/calendar/day/{date}/attachments")
async def post_calendar_day_attachment(
    date: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Upload an image attachment for a day. Stored on local disk under
    data/j2_attachments/<user_id>/<date>/<uuid>.<ext>. Returns the
    attachment dict the client merges into the day's attachments array."""
    from datetime import date as Date
    try:
        Date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        return await calendar_service.save_attachment(user["id"], date, file)
    except calendar_service.DayNotesValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/attachments/{user_id}/{date}/{filename}")
def get_calendar_attachment(
    user_id: str,
    date: str,
    filename: str,
    user: dict = Depends(get_current_user),
) -> Any:
    """Serve a previously uploaded image. Only the owner can fetch."""
    if user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        path = calendar_service.serve_attachment_path(user_id, date, filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid date")
    if path is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(path)


