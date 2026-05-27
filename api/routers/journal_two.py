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

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse

from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import (
    accounts as accounts_service,
    analytics as analytics_service,
    calendar as calendar_service,
    coach as coach_service,
    coach_chat as coach_chat_service,
    community as community_service,
    csv_import as csv_import_service,
    discipline as discipline_service,
    nudges as nudges_service,
    options as options_service,
    playbook as playbook_service,
    positions as positions_service,
    regime as regime_service,
    settings as settings_service,
    setup_stats as setup_stats_service,
    trades as trades_service,
)

router = APIRouter(prefix="/api/j2", tags=["journal-2-0"])


def _unified_enabled() -> bool:
    """Feature flag — flip UNIFIED_COMPASS_ENABLED=false in Railway env to
    fully revert to the per-account-only 'select a single account' guard."""
    import os
    raw = os.getenv("UNIFIED_COMPASS_ENABLED", "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _require_compass_enabled(user_id: str, account_id: str) -> None:
    """Raise 404/403 if Compass isn't reachable for (user, account).

    Accepts the '_all_' sentinel: the per-user unified coach toggle gates
    the request instead of the per-account one.
    """
    from api.services.journal_two.coach_scope import is_unified
    from api.services.journal_two import unified_coach
    if is_unified(account_id):
        if not _unified_enabled():
            raise HTTPException(status_code=404, detail="Unified Compass is disabled by configuration.")
        state = unified_coach.get_or_create(None, user_id)
        if not state["compassEnabled"]:
            raise HTTPException(status_code=403, detail="Unified Compass is disabled.")
        return
    settings_check = accounts_service.get_account_settings(user_id, account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")


def _reject_unified_for_per_trade(account_id: str) -> None:
    """Pre-trade verdict / trade-review / onboarding endpoints are inherently
    per-account in v1. Reject the unified sentinel with a friendly 400."""
    from api.services.journal_two.coach_scope import is_unified
    if is_unified(account_id):
        raise HTTPException(
            status_code=400,
            detail="Switch to a single account — Compass needs an account context for this action.",
        )


def _most_recent_closed_monday() -> str:
    """Return the most recent fully-closed Monday-Friday week as ISO Monday date."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc).date()
    # weekday(): Mon=0 ... Fri=4 ... Sat=5 Sun=6
    wd = now.weekday()
    if wd >= 5:  # Sat or Sun: this week's Friday has closed
        days_back_to_friday = wd - 4
    else:        # Mon-Fri: prior week's Friday is the most recent close
        days_back_to_friday = wd + 3
    most_recent_friday = now - timedelta(days=days_back_to_friday)
    monday = most_recent_friday - timedelta(days=4)
    return monday.isoformat()


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


@router.get("/accounts/{account_id}/nudges")
def get_nudges_route(
    account_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Phase F: loss/win streak counts + stale-position count + thresholds."""
    return nudges_service.get_nudges_state(user["id"], account_id)


@router.get("/accounts/{account_id}/setup-stats")
def get_setup_stats_route(
    account_id: str,
    setup: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Per-setup historical performance for the live coaching panel."""
    return setup_stats_service.get_setup_stats(user["id"], account_id, setup)


@router.get("/regime")
def get_current_regime_route(
    user: dict = Depends(get_current_user),
):
    """Current UCT regime label + score. Unaffected by account; cached
    in the wire_data layer at the engine push cadence."""
    return regime_service.get_current_regime()


# ── Notebook (replaces Playbook 2026-05-26) ─────────────────────────────────
from api.services.journal_two import notes as notes_service
from api.services.journal_two.notes import NoteValidationError


@router.get("/notes")
def list_notes_endpoint(
    folder_id: str | None = None,
    tag: str | None = None,
    ticker: str | None = None,
    q: str | None = None,
    sort: str = "updated",
    limit: int = 100,
    offset: int = 0,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    rows = notes_service.list_notes(
        user["id"], folder_id=folder_id, tag=tag, ticker=ticker, q=q,
        sort=sort, limit=limit, offset=offset,
    )
    return {"notes": rows}


@router.get("/notes/{note_id}")
def get_note_endpoint(
    note_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    n = notes_service.get_note(user["id"], note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"note": n}


@router.post("/notes")
def create_note_endpoint(
    payload: dict[str, Any] | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        n = notes_service.create_note(user["id"], payload or {})
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"note": n}


@router.put("/notes/{note_id}")
def update_note_endpoint(
    note_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        n = notes_service.update_note(user["id"], note_id, patch)
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"note": n}


@router.delete("/notes/{note_id}")
def delete_note_endpoint(
    note_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    ok = notes_service.delete_note(user["id"], note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.post("/notes/{note_id}/images")
async def upload_note_image_endpoint(
    note_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    n = notes_service.get_note(user["id"], note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        img = await notes_service.save_note_image(
            user["id"], note_id, file, kind="inline",
        )
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return img


@router.post("/notes/{note_id}/hero")
async def upload_note_hero_endpoint(
    note_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    n = notes_service.get_note(user["id"], note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        img = await notes_service.save_note_image(
            user["id"], note_id, file, kind="hero",
        )
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    updated = notes_service.update_note(
        user["id"], note_id, {"heroImageUrl": img["url"]},
    )
    return {"heroImageUrl": img["url"], "note": updated}


@router.delete("/notes/{note_id}/hero")
def delete_note_hero_endpoint(
    note_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    n = notes_service.update_note(user["id"], note_id, {"heroImageUrl": None})
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.get("/notes/attachments/{user_id_param}/{note_id}/{sub}/{filename}")
def serve_note_attachment(
    user_id_param: str,
    note_id: str,
    sub: str,
    filename: str,
    user: dict = Depends(get_current_user),
) -> Any:
    if user["id"] != user_id_param:
        raise HTTPException(status_code=403, detail="Forbidden")
    path = notes_service.serve_note_image_path(user_id_param, note_id, sub, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path))


@router.get("/note-folders")
def list_folders_endpoint(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    return {"folders": notes_service.list_folders(user["id"])}


@router.post("/note-folders")
def create_folder_endpoint(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        f = notes_service.create_folder(
            user["id"],
            name=payload.get("name", ""),
            sort_order=int(payload.get("sortOrder", 0) or 0),
        )
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"folder": f}


@router.put("/note-folders/{folder_id}")
def update_folder_endpoint(
    folder_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        f = notes_service.update_folder(user["id"], folder_id, patch)
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if f is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"folder": f}


@router.delete("/note-folders/{folder_id}")
def delete_folder_endpoint(
    folder_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    ok = notes_service.delete_folder(user["id"], folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


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


# ── Phase G: Compass ─────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/coach/weekly-reviews")
def list_coach_weekly_reviews(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return {"reviews": coach_service.list_weekly_reviews(
        user_id=user["id"], account_id=account_id,
    )}


@router.get("/accounts/{account_id}/coach/weekly-reviews/{review_id}")
def get_coach_weekly_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    r = coach_service.get_weekly_review(review_id=review_id, user_id=user["id"])
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r


@router.post("/accounts/{account_id}/coach/weekly-reviews/generate")
def generate_coach_weekly_review(
    account_id: str,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    _require_compass_enabled(user["id"], account_id)

    week_start = (payload or {}).get("weekStart") or _most_recent_closed_monday()
    try:
        return coach_service.generate_weekly_review(
            user_id=user["id"], account_id=account_id, week_start=week_start,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/weekly-reviews/{review_id}/regenerate")
def regenerate_coach_weekly_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_weekly_review(review_id=review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    # week_start lives inside the metadata JSON blob
    week_start = (existing.get("metadata") or {}).get("week_start") or _most_recent_closed_monday()
    # v1: forget the existing, then regenerate. Caller treats as replacement.
    coach_service.forget_review(review_id=review_id, user_id=user["id"])
    try:
        return coach_service.generate_weekly_review(
            user_id=user["id"], account_id=account_id,
            week_start=week_start,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/weekly-reviews/{review_id}/feedback")
def feedback_coach_weekly_review(
    account_id: str,
    review_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    feedback = (payload or {}).get("feedback")
    if feedback not in ("helpful", "unhelpful"):
        raise HTTPException(status_code=400, detail="feedback must be 'helpful' or 'unhelpful'")
    existing = coach_service.get_weekly_review(review_id=review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    coach_service.set_feedback(review_id=review_id, feedback=feedback, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/weekly-reviews/{review_id}/forget")
def forget_coach_weekly_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_weekly_review(review_id=review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    coach_service.forget_review(review_id=review_id, user_id=user["id"])
    return {"ok": True}


# ── Phase G v2: EOD recaps ──────────────────────────────────────────────────


@router.get("/accounts/{account_id}/coach/eod-recaps")
def list_coach_eod_recaps(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return {"recaps": coach_service.list_eod_recaps(
        user_id=user["id"], account_id=account_id,
    )}


@router.get("/accounts/{account_id}/coach/eod-recaps/{recap_id}")
def get_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    r = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not r:
        raise HTTPException(status_code=404, detail="Recap not found")
    return r


@router.post("/accounts/{account_id}/coach/eod-recaps/generate")
def generate_coach_eod_recap(
    account_id: str,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    _require_compass_enabled(user["id"], account_id)

    # Default day = today ET
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    day = (payload or {}).get("day") or _dt.now(et).date().isoformat()
    try:
        return coach_service.generate_eod_recap(
            user_id=user["id"], account_id=account_id, day=day,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/regenerate")
def regenerate_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    day = (existing.get("metadata") or {}).get("day")
    coach_service.forget_review(review_id=recap_id, user_id=user["id"])
    try:
        return coach_service.generate_eod_recap(
            user_id=user["id"], account_id=account_id, day=day,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/feedback")
def feedback_coach_eod_recap(
    account_id: str,
    recap_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    feedback = (payload or {}).get("feedback")
    if feedback not in ("helpful", "unhelpful"):
        raise HTTPException(status_code=400, detail="feedback must be 'helpful' or 'unhelpful'")
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    coach_service.set_feedback(review_id=recap_id, feedback=feedback, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/forget")
def forget_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    coach_service.forget_review(review_id=recap_id, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/viewed")
def viewed_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    n = coach_service.mark_eod_viewed(recap_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Recap not found")
    return {"ok": True}


# ── Phase G v3: Compass Chat ────────────────────────────────────────────────


def _sse_format(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/accounts/{account_id}/coach/chat/stream")
def chat_stream(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    msg = (payload or {}).get("message", "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="message required")
    _require_compass_enabled(user["id"], account_id)

    def _gen():
        for event in coach_chat_service.handle_user_turn(
            user_id=user["id"], account_id=account_id, user_message=msg,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/confirm")
def chat_confirm(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    message_id = (payload or {}).get("message_id")
    tool_call_id = (payload or {}).get("tool_call_id")
    if not message_id or not tool_call_id:
        raise HTTPException(status_code=400, detail="message_id and tool_call_id required")

    def _gen():
        for event in coach_chat_service.confirm_pending_action(
            user_id=user["id"], account_id=account_id,
            message_id=message_id, tool_call_id=tool_call_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/cancel")
def chat_cancel(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    message_id = (payload or {}).get("message_id")
    tool_call_id = (payload or {}).get("tool_call_id")
    if not message_id or not tool_call_id:
        raise HTTPException(status_code=400, detail="message_id and tool_call_id required")

    def _gen():
        for event in coach_chat_service.cancel_pending_action(
            user_id=user["id"], account_id=account_id,
            message_id=message_id, tool_call_id=tool_call_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/accounts/{account_id}/coach/chat/messages")
def chat_list_messages(
    account_id: str,
    limit: int = 50,
    before_id: str | None = None,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.list_messages(
        user_id=user["id"], account_id=account_id,
        limit=max(1, min(int(limit), 200)),
        before_id=before_id,
    )


@router.post("/accounts/{account_id}/coach/chat/forget")
def chat_forget(
    account_id: str,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    body = payload or {}
    return coach_chat_service.forget_message(
        user_id=user["id"], account_id=account_id,
        message_id=body.get("message_id"),
        all=bool(body.get("all", False)),
    )


@router.get("/accounts/{account_id}/coach/chat/status")
def chat_status(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.get_chat_status(user_id=user["id"], account_id=account_id)


@router.get("/accounts/{account_id}/coach/profile")
def get_coach_profile(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    settings = accounts_service.get_account_settings(user["id"], account_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"profile": settings.get("traderProfile") or ""}


@router.put("/accounts/{account_id}/coach/profile")
def put_coach_profile(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    profile = (payload or {}).get("profile")
    if not isinstance(profile, str):
        raise HTTPException(status_code=400, detail="profile must be a string")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_accounts SET trader_profile = ? WHERE id = ? AND user_id = ?",
            (profile, account_id, user["id"]),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
        return {"profile": profile}
    finally:
        conn.close()


@router.get("/unified-coach")
def get_unified_coach_state_route(
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import unified_coach
    return unified_coach.get_or_create(None, user["id"])


@router.put("/unified-coach")
def put_unified_coach_state_route(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import unified_coach
    profile = (payload or {}).get("traderProfile")
    enabled = (payload or {}).get("compassEnabled")
    if profile is not None and not isinstance(profile, str):
        raise HTTPException(status_code=400, detail="traderProfile must be a string")
    if enabled is not None and not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="compassEnabled must be a boolean")
    return unified_coach.update_state(
        None, user["id"],
        trader_profile=profile,
        compass_enabled=enabled,
    )


@router.post("/accounts/{account_id}/coach/chat/start_onboarding")
def chat_start_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    _require_compass_enabled(user["id"], account_id)

    def _gen():
        for event in coach_chat_service.start_onboarding(
            user_id=user["id"], account_id=account_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/skip_onboarding")
def chat_skip_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.skip_onboarding(user_id=user["id"], account_id=account_id)


@router.post("/accounts/{account_id}/coach/chat/redo_onboarding")
def chat_redo_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    _require_compass_enabled(user["id"], account_id)

    def _gen():
        for event in coach_chat_service.redo_onboarding(
            user_id=user["id"], account_id=account_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


# ── Pre-Trade Verdict ────────────────────────────────────────────────────────


@router.post("/accounts/{account_id}/coach/pre-trade-verdict")
def pre_trade_verdict(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import pre_trade_verdict as ptv_service
    _reject_unified_for_per_trade(account_id)
    _require_compass_enabled(user["id"], account_id)
    return ptv_service.generate_verdict(
        user_id=user["id"], account_id=account_id, params=payload or {},
    )


# ── Trade Reviews (Per-Trade Post-Mortem) ────────────────────────────────────


@router.get("/accounts/{account_id}/coach/trade-reviews")
def list_trade_reviews(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    return tr.list_reviews(user_id=user["id"], account_id=account_id)


@router.get("/accounts/{account_id}/coach/trade-reviews/{review_id}")
def get_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    r = tr.get_review(review_id, user_id=user["id"])
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r


@router.post("/accounts/{account_id}/coach/trade-reviews/generate")
def generate_trade_review(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    _reject_unified_for_per_trade(account_id)
    _require_compass_enabled(user["id"], account_id)
    trade_id = (payload or {}).get("trade_id")
    if not trade_id:
        raise HTTPException(status_code=400, detail="trade_id required")
    return tr.generate_review(
        user_id=user["id"], account_id=account_id, trade_id=trade_id,
    )


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/regenerate")
def regenerate_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    return tr.generate_review(
        user_id=user["id"], account_id=account_id,
        trade_id=existing["trade_id"], regenerate=True,
    )


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/feedback")
def feedback_trade_review(
    account_id: str,
    review_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    feedback = (payload or {}).get("feedback")
    if feedback not in ("helpful", "unhelpful"):
        raise HTTPException(status_code=400, detail="feedback must be 'helpful' or 'unhelpful'")
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    tr.set_feedback(review_id, feedback=feedback, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/forget")
def forget_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    tr.forget_review(review_id, user_id=user["id"])
    return {"ok": True}


@router.get("/accounts/{account_id}/coach/interventions/active")
def list_active_interventions(
    account_id: str,
    evaluate: bool = True,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import interventions as iv
    if evaluate:
        return {"interventions": iv.evaluate_interventions(
            user_id=user["id"], account_id=account_id,
        )}
    return {"interventions": iv.list_active(
        user_id=user["id"], account_id=account_id,
    )}


@router.post("/accounts/{account_id}/coach/interventions/{intervention_id}/dismiss")
def dismiss_intervention(
    account_id: str,
    intervention_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import interventions as iv
    n = iv.dismiss_intervention(intervention_id=intervention_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return {"ok": True}


@router.get("/accounts/{account_id}/coach/profile-suggestions")
def list_profile_suggestions(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import profile_suggestions as ps
    return ps.list_pending(user_id=user["id"], account_id=account_id)


@router.post("/accounts/{account_id}/coach/profile-suggestions/{suggestion_id}/dismiss")
def dismiss_profile_suggestion(
    account_id: str,
    suggestion_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import profile_suggestions as ps
    n = ps.dismiss_suggestion(suggestion_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return {"ok": True}


@router.get("/accounts/{account_id}/coach/overview")
def coach_overview(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import overview as ov
    return ov.get_overview(user_id=user["id"], account_id=account_id)
