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

import csv
import io
import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, Response, StreamingResponse

from api.middleware.auth_middleware import get_current_user, require_admin
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
    playbook_stats as playbook_stats_service,
    positions as positions_service,
    regime as regime_service,
    regime_backfill,
    settings as settings_service,
    setup_stats as setup_stats_service,
    trades as trades_service,
    trading_day_backfill,
    verdict_scorecard as verdict_scorecard_service,
)
from api.services.journal_two.filters import FilterSpec, parse_filter_query
from api.services.journal_two.timeutil import ET, UTC

router = APIRouter(prefix="/api/j2", tags=["journal-2-0"])


# Allow-list of FE telemetry events (landing_analytics.py:32-45 pattern). Only
# these are accepted by POST /telemetry; anything else → 400. P1b fires these.
_J2_TELEMETRY_EVENTS = {
    "trade_page_open", "import_preset_used", "verdict_embed_run",
    "scope_applied", "surface_visit", "screenshot_added", "reflection_saved",
}


@router.post("/telemetry")
def j2_telemetry(payload: dict, user: dict = Depends(get_current_user)):
    """Record an allow-listed FE telemetry event to the shared auth activity_log.

    Body: {"event": str, "props": dict|None}. Unknown event → 400. Writes via
    auth_service.log_activity(action=f"j2:{event}", details=json.dumps(props)[:500]).
    """
    event = str(payload.get("event") or "")
    if event not in _J2_TELEMETRY_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event")
    from api.services.auth_service import log_activity
    log_activity(user["id"], f"j2:{event}", json.dumps(payload.get("props") or {})[:500])
    return {"ok": True}


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


# ── Compass health (ADMIN — see the handler for why "no-auth" was wrong) ─────

@router.get("/compass-health")
def compass_health_status(days: int = 7,
                          _admin: dict = Depends(require_admin)) -> dict[str, Any]:
    """Weekly Compass mentor health: chat volume, active users, tool-failure
    rate, and the worst-offending tools. Feeds the weekly owner email. ADMIN.

    🔴 THIS WAS ANONYMOUS (auth/paywall sweep, 2026-08-09), and
    `CompassPaywallMiddleware` does not reach it: that gate fires on
    `/api/j2` paths containing `/coach`, and this path does not.

    "Read-only" was doing the work in the old docstring, and it is the wrong
    test. What it returns is BUSINESS METRICS - how many people use Compass, how
    much they use it, and (via `cost_today`) what the firm is spending on models
    today plus whether the circuit-breaker has tripped. That is a competitor's
    view of our traction and our unit economics, published to anybody.
    """
    from api.services import compass_health
    from api.services.journal_two import compass_cost_guard
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        out = compass_health.compute_health(conn, days=max(1, min(90, int(days))))
    finally:
        conn.close()
    out["cost_today"] = compass_cost_guard.snapshot()  # live daily spend + circuit-breaker
    return out


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
    # Verdict→trade attachment: AddPositionModal stamps payload.contextAtEntry
    # with {compass_verdict_id, compass_verdict_label} after a pre-trade
    # verdict run (else {}). Persist it verbatim; on close, close_position
    # copies context_at_entry forward to the resulting trade. Dict-guarded.
    ctx = payload.get("contextAtEntry")
    if not isinstance(ctx, dict):
        ctx = {}
    try:
        return positions_service.create_position(
            user["id"], payload, ctx, account_id=acc_id,
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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """All trades for the current user, newest-first.
    Optional ?account_id= filters to one account. Phase-6 additive filter +
    pagination params (date_from/date_to/symbol/sides/setups/limit/offset) are
    parsed by parse_filter_query. The response envelope is ADDITIVE: `trades`
    is unchanged; `total`/`limit`/`offset` are new keys for paging clients."""
    trades, total = trades_service.list_trades_for_user(
        user["id"], account_id=account_id, spec=spec,
    )
    return {
        "trades": trades,
        "total": total,
        "limit": spec.limit,
        "offset": spec.offset,
    }


# CSV column set (A11) — a STABLE, documented header. entryTime/exitTime are
# always present (stable column set) but only populated for timed entries;
# date-only entries (stored at UTC midnight) leave them blank. mistakeTags /
# emotionTags are semicolon-joined. Order is a public contract — append only.
_EXPORT_CSV_HEADERS = [
    "symbol", "side", "entryDate", "entryTime", "exitDate", "exitTime",
    "shares", "entryPrice", "exitPrice", "pnlDollarNet", "rMultiple",
    "setup", "mistakeTags", "emotionTags", "source",
]


def _split_export_datetime(iso: Any) -> tuple[str, str]:
    """(date, time-of-day) for a stored ISO timestamp, matching the trading-day
    spine convention: a date-only entry (bare date OR exact UTC midnight) →
    (YYYY-MM-DD, '') with no time; a timed entry → its ET (YYYY-MM-DD, HH:MM).
    Unparseable input degrades to (first-10-chars, '')."""
    if not iso:
        return "", ""
    s = str(iso)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return s[:10], ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    utc = dt.astimezone(UTC)
    if "T" not in s or (utc.hour == 0 and utc.minute == 0 and utc.second == 0):
        return utc.strftime("%Y-%m-%d"), ""
    et = dt.astimezone(ET)
    return et.strftime("%Y-%m-%d"), et.strftime("%H:%M")


def _export_cell(value: Any) -> Any:
    """None → '' so the csv module never writes the literal string 'None'."""
    return "" if value is None else value


# ROUTE ORDER: `/trades/export` MUST be registered BEFORE `/trades/{trade_id}`,
# or FastAPI matches `export` as a trade_id (→ 404). Keep it here, immediately
# after the `/trades` list route and before the dynamic detail route below.
@router.get("/trades/export")
def export_trades(
    format: str = "csv",
    account_id: str | None = None,
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> Response:
    """Filtered CSV/JSON export over the SAME FilterSpec as `/trades` — so the
    file leaving with the user == exactly what's on screen (spec §8). Returns a
    downloadable attachment (`Content-Disposition`). CSV columns are a stable,
    documented set (see `_EXPORT_CSV_HEADERS`), built via the stdlib `csv`
    module for safe quoting; JSON is the full filtered `list_trades_for_user`
    row list. Unknown format → 422."""
    fmt = (format or "").strip().lower()
    if fmt not in ("csv", "json"):
        raise HTTPException(status_code=422, detail="format must be 'csv' or 'json'")

    # SAME filtered read the on-screen list uses (drop the paging total — export
    # is the full match set unless the caller explicitly paged via limit/offset).
    trades, _total = trades_service.list_trades_for_user(
        user["id"], account_id=account_id, spec=spec,
    )

    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"uct-journal-trades-{date_str}.{fmt}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

    if fmt == "json":
        return Response(
            content=json.dumps(trades, ensure_ascii=False),
            media_type="application/json",
            headers=headers,
        )

    # CSV — stdlib csv.writer over a StringIO quotes any field with a comma /
    # quote / newline automatically (no fragile hand-rolled joining).
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_EXPORT_CSV_HEADERS)
    for t in trades:
        entry_date, entry_time = _split_export_datetime(t.get("entryDate"))
        exit_date, exit_time = _split_export_datetime(t.get("exitDate"))
        writer.writerow([
            _export_cell(t.get("symbol")),
            _export_cell(t.get("side")),
            entry_date,
            entry_time,
            exit_date,
            exit_time,
            _export_cell(t.get("shares")),
            _export_cell(t.get("entryPrice")),
            _export_cell(t.get("exitPrice")),
            _export_cell(t.get("pnlDollarNet")),
            _export_cell(t.get("rMultiple")),
            _export_cell(t.get("setup")),
            ";".join(t.get("mistakeTags") or []),
            ";".join(t.get("emotionTags") or []),
            _export_cell(t.get("source")),
        ])
    return Response(content=buf.getvalue(), media_type="text/csv", headers=headers)


@router.get("/trades/{trade_id}")
def get_trade_detail(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """One closed trade + its stable tradeRef + best-effort broker provenance
    (activities matched by symbol within the ±1-day holding window). 404 when
    the trade doesn't exist or belongs to another user — option-strategy ids
    are simply not in j2_trades, so they 404 naturally.

    Route ordering: a `{trade_id}` GET can't shadow the POST /trades/import/*
    routes (different method + segment count); this stays reachable and the
    static import routes stay reachable. See test_trade_detail route test."""
    out = trades_service.get_trade_detail(user["id"], trade_id)
    if out is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return out


# ── Trade screenshots (keyed on the stable trade_ref) ───────────────────────
# Route ordering: `/trades/attachments/{user_id}/{ref_dir}/{filename}` is a
# 3-segment literal-first path; `/trades/{trade_id}/attachments` is 2-segment;
# `/trades/{trade_id}` is 1-segment. A path param never spans '/', so none of
# these shadow each other regardless of registration order.

@router.get("/trades/attachments/{user_id_param}/{ref_dir}/{filename}")
def serve_trade_attachment(
    user_id_param: str,
    ref_dir: str,
    filename: str,
    user: dict = Depends(get_current_user),
) -> Any:
    if user["id"] != user_id_param:
        raise HTTPException(status_code=403, detail="Forbidden")
    from api.services.journal_two import trade_attachments
    path = trade_attachments.serve_trade_attachment_path(user_id_param, ref_dir, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path))


@router.get("/trades/{trade_id}/attachments")
def list_trade_attachments_route(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """List a trade's screenshots. Resolves the trade → its stable ref first
    (404 if the trade is gone / not the caller's)."""
    from api.services.journal_two import trade_attachments
    detail = trades_service.get_trade_detail(user["id"], trade_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"attachments": trade_attachments.list_trade_attachments(
        user["id"], detail["tradeRef"])}


@router.post("/trades/{trade_id}/attachments")
async def upload_trade_attachment(
    trade_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    from api.services.journal_two import trade_attachments
    detail = trades_service.get_trade_detail(user["id"], trade_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    try:
        return await trade_attachments.save_trade_attachment(
            user["id"], detail["tradeRef"], file)
    except trade_attachments.TradeAttachmentError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/trades/attachments/{attachment_id}")
def delete_trade_attachment_route(
    attachment_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    from api.services.journal_two import trade_attachments
    ok = trade_attachments.delete_trade_attachment(user["id"], attachment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ── Per-trade rule adherence (keyed on the stable trade_ref, P5-A3) ──────────
# Both routes resolve trade_id → the trade's stable ref via get_trade_detail
# (404 if the trade is gone / not the caller's), then read/write the
# j2_trade_adherence side table keyed on that ref — same pattern as the
# excursion attachment on get_trade_detail above.

@router.get("/trades/{trade_id}/adherence")
def get_trade_adherence_route(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any] | None:
    """The stored rule-adherence record for a trade, or null when none exists
    yet. Resolves the trade → its stable ref first (404 if the trade is gone /
    not the caller's)."""
    from api.services.journal_two import adherence_store
    detail = trades_service.get_trade_detail(user["id"], trade_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return adherence_store.get_adherence(user["id"], detail["tradeRef"])


@router.put("/trades/{trade_id}/adherence")
def put_trade_adherence_route(
    trade_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Upsert the rule-adherence record for a trade.

    Body: {setup, checkedRuleIds, totalRules}. Resolves the trade → its stable
    ref (404 if the trade is gone / not the caller's), validates the body, and
    stores the record keyed on that ref. Returns the stored record."""
    from api.services.journal_two import adherence_store

    detail = trades_service.get_trade_detail(user["id"], trade_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trade not found")

    setup = payload.get("setup")
    if setup is not None and not isinstance(setup, str):
        raise HTTPException(status_code=400, detail="setup must be a string")

    checked = payload.get("checkedRuleIds", [])
    if not isinstance(checked, list) or not all(isinstance(x, str) for x in checked):
        raise HTTPException(
            status_code=400, detail="checkedRuleIds must be a list of strings")

    total_rules = payload.get("totalRules", 0)
    if isinstance(total_rules, bool) or not isinstance(total_rules, int) or total_rules < 0:
        raise HTTPException(
            status_code=400, detail="totalRules must be a non-negative integer")

    return adherence_store.upsert_adherence(
        user["id"], detail["tradeRef"], setup, checked, total_rules)


# ── "Make this a rule" — persisted personal-rule store (P6-5) ────────────────
# A display-only, evidence-linked reminder store. CRITICAL: these routes only
# store/list/dismiss rules — they MUST NOT auto-arm any intervention or mutate a
# discipline guardrail. A rule is shown to the trader, never fired. Every route
# is user-scoped via get_current_user; account_id is a tag (isolation is on
# user_id in the store, so a rule can never leak across users).

@router.post("/accounts/{account_id}/rules")
def create_journal_rule_route(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a personal journal rule (a persisted reminder).

    Body: {label, evidence?, sourceType?, sourceId?}. 400 if label is missing
    or blank. Returns the stored record."""
    from api.services.journal_two import journal_rules

    label = payload.get("label")
    if not isinstance(label, str) or not label.strip():
        raise HTTPException(status_code=400, detail="label is required")
    evidence = payload.get("evidence")
    if evidence is not None and not isinstance(evidence, str):
        raise HTTPException(status_code=400, detail="evidence must be a string")
    source_id = payload.get("sourceId")
    if source_id is not None and not isinstance(source_id, str):
        raise HTTPException(status_code=400, detail="sourceId must be a string")
    source_type = payload.get("sourceType") or "manual"
    if not isinstance(source_type, str):
        raise HTTPException(status_code=400, detail="sourceType must be a string")

    try:
        return journal_rules.create_rule(
            user["id"], account_id, label,
            evidence=evidence, source_type=source_type, source_id=source_id,
        )
    except journal_rules.JournalRuleError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/{account_id}/rules")
def list_journal_rules_route(
    account_id: str,
    status: str = Query("active"),
    user: dict = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """The account's journal rules for the given status (default 'active'),
    newest first."""
    from api.services.journal_two import journal_rules
    return journal_rules.list_rules(user["id"], account_id, status)


@router.post("/rules/{rule_id}/dismiss")
def dismiss_journal_rule_route(
    rule_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Dismiss a journal rule (status → 'dismissed'). 404 if the rule doesn't
    exist or isn't owned by the caller."""
    from api.services.journal_two import journal_rules
    rec = journal_rules.dismiss_rule(user["id"], rule_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rec


# ── Deterministic AI-suggested mistake/emotion tags (P6-4) ───────────────────
# Pure heuristics (NO LLM): a no-stop trade → suggest `no_stop`; a same-symbol
# revenge re-entry → suggest `revenge` + `revenge-driven`. Filtered against the
# account taxonomy and the trade's already-applied tags. The revenge flag is
# computed HERE by running `revenge_detect.detect` over the account's recent
# CLOSED trades (same parsed shape the psychology/analytics path consumes) and
# checking whether THIS trade's stable ref is flagged.

def _revenge_flag_for_trade(
    user_id: str, account_id: str | None, trade_ref: str,
) -> bool:
    """True when `trade_ref` is a revenge re-entry among the account's recent
    closed trades. Bounded fetch (newest 300) — cheap, single query."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import revenge_detect
    from api.services.journal_two.trade_refs import trade_ref_for_row

    conn = get_connection()
    try:
        sql = (
            "SELECT id, external_id, source, symbol, entry_date, exit_date, "
            "       pnl_dollar, fees "
            "  FROM j2_trades WHERE user_id = ?"
        )
        params: list[Any] = [user_id]
        if account_id:
            sql += " AND account_id = ?"
            params.append(account_id)
        sql += " ORDER BY exit_date DESC LIMIT 300"
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()

    parsed: list[dict[str, Any]] = []
    for r in rows:
        keys = r.keys()
        gross = float(r["pnl_dollar"] or 0)
        fees = float(r["fees"]) if "fees" in keys and r["fees"] is not None else 0.0
        parsed.append({
            "tradeRef": trade_ref_for_row(r),
            "symbol": r["symbol"],
            "entry_date": r["entry_date"],
            "exit_date": r["exit_date"],
            "pnlDollar": gross,
            "pnlDollarNet": round(gross - fees, 2),
        })
    flags = revenge_detect.detect(parsed)["flags"]
    return any(f["tradeRef"] == trade_ref for f in flags)


@router.get("/trades/{trade_id}/tag-suggestions")
def get_trade_tag_suggestions_route(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Deterministic AI-suggested mistake/emotion tags for a closed trade.

    Resolves the trade (404 if gone / not the caller's), computes the revenge
    flag for it, reads the account taxonomy (empty list → STANDARD fallback),
    and returns ``{mistakes, emotions, reasons}``."""
    from api.services.journal_two import tag_suggest

    detail = trades_service.get_trade_detail(user["id"], trade_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    trade = detail["trade"]
    account_id = trade.get("accountId")

    revenge_flag = _revenge_flag_for_trade(user["id"], account_id, detail["tradeRef"])

    settings = accounts_service.get_account_settings(user["id"], account_id) or {}
    available_mistakes = settings.get("mistakeTags") or tag_suggest.STANDARD_MISTAKES
    available_emotions = settings.get("emotionTags") or tag_suggest.STANDARD_EMOTIONS

    return tag_suggest.suggest_for_trade(
        trade, revenge_flag, available_mistakes, available_emotions,
    )


# ── Sync Trust Center: orphaned-annotation reattach queue (Task B7) ──────────
# Static suffixes under /trust/orphans — no path params, so no route shadowing.

@router.get("/trust/orphans")
def list_orphaned_annotations(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Annotation trade_refs holding user content (screenshots) that no longer
    resolve to a live trade or option strategy — the residue of a broker FIFO
    re-slice or a hard-deleted trade. Parked, never deleted; the client offers
    a manual reattach. Machine-generated excursion-only refs are never listed
    (recomputed nightly; dead ones are pruned by the backfill)."""
    from api.services.journal_two import trade_refs
    return {"orphans": trade_refs.scan_orphans(user["id"])}


@router.post("/trust/orphans/reattach")
def reattach_orphaned_annotation(
    payload: dict,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Re-point one orphaned annotation set onto a live target trade's ref.
    Body: {tradeRef, targetTradeId}. 404 if the target is missing/foreign, 409
    if the source ref is still live. Returns the count of annotation rows moved
    (excursionConflict=true when the target already held an excursion and we
    left the orphan parked rather than overwrite it)."""
    from api.services.journal_two import trade_refs
    try:
        result = trade_refs.reattach_orphan(
            user["id"],
            str(payload.get("tradeRef") or ""),
            str(payload.get("targetTradeId") or ""),
        )
    except trade_refs.OrphanReattachError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    return result


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


@router.patch("/trades/{trade_id}")
def update_trade(
    trade_id: str,
    patch: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Enrich a trade after the fact — set originalStop / setup / notes /
    mistakeTags / emotionTags (the path for adding a stop to a broker-imported
    trade so R-multiple computes). Recomputes derived R/result."""
    settings = accounts_service.get_account_settings(user["id"])
    try:
        updated = trades_service.update_trade(user["id"], trade_id, patch, settings)
    except trades_service.ManualTradeValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return updated


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
    out = result.to_dict()
    # Dry-run dupe count (Task 7) — how many of these rows already exist under
    # the csv: fingerprint. WRITE-FREE; the modal shows "N duplicates will be
    # skipped" and it equals the confirm's skipped count.
    out["duplicates"] = trades_service.count_csv_duplicates(user["id"], result.trades)
    return out


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
    out = result.to_dict()
    out["duplicates"] = trades_service.count_csv_duplicates(user["id"], result.trades)
    return out


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
    # Bound the confirm body — the /import/preview CSV read is 10MB-capped, but
    # a hand-crafted JSON confirm bypasses that. One giant transaction holds the
    # serialized SQLite write lock on the shared event loop (the 524-outage
    # class), so cap the batch. Real imports are far under this.
    if len(trades) > 10000:
        raise HTTPException(status_code=400, detail="Too many trades in one import (max 10,000)")

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

    # Task 7 — re-import dedupe: stamp a stable csv: fingerprint on every trade
    # lacking an externalId so bulk_insert_trades' (user_id, external_id) skip
    # dedupes a re-import of the same file to zero. source='csv' keeps regime
    # stamping (only source=='broker' nulls regime).
    trades_service.assign_csv_external_ids(trades)
    result = trades_service.bulk_insert_trades(
        user["id"], trades, settings, account_id=account_id, source="csv",
    )
    return result


@router.post("/admin/trading-day-backfill")
def trading_day_backfill_route(
    force: bool = False,
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only. Batched, idempotent backfill of trading_day_et/hour_et on
    legacy rows. Returns which trades' calendar day MOVES vs the old
    to_et_date bucketing. Run OFF-HOURS (writer locks auth.db)."""
    return trading_day_backfill.run_backfill(force=force)


@router.post("/admin/regime-backfill")
def regime_backfill_route(
    limit: int | None = None,
    force: bool = False,
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only. Batched, idempotent backfill of `j2_trades.regime` from
    breadth history: reclassify each historical day's UCT exposure score → regime
    label and stamp it on NULL-regime trades whose day (trading_day_et, else
    exit_date) matches. Broker/CSV rows with no matching breadth day stay NULL.
    Global across all users. Run OFF-HOURS (writer locks auth.db). Returns
    {scanned, updated, skipped_no_day_match}."""
    return regime_backfill.backfill_regime(limit=limit, force=force)


@router.post("/admin/attachments-backup")
def attachments_backup_route(user: dict = Depends(require_admin)) -> dict[str, Any]:
    """Admin-only manual trigger of the J2 attachments R2 backup. Fire-and-forget
    on a daemon thread (a full tar.gz + upload can take many seconds); check the
    marker / logs for the result. When J2_ATTACHMENT_BACKUP_ENABLED is off, returns
    {started: False, reason: "disabled"} WITHOUT spawning a thread (the daemon would
    only no-op) — an honest response instead of a misleading {started: True}."""
    import threading

    from api import j2_attachments_backup

    if not j2_attachments_backup._enabled():
        return {"started": False, "reason": "disabled"}

    threading.Thread(
        target=j2_attachments_backup.backup_j2_attachments_to_r2,
        daemon=True,
        name="j2-attach-backup-manual",
    ).start()
    return {"started": True}


@router.post("/admin/excursion-backfill")
def excursion_backfill_route(
    limit: int | None = None,
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only manual trigger of the closed-trade excursion backfill. Runs
    OFF the request path on a daemon thread (a full batch fetches bars per trade
    and can take many seconds) — check /admin/excursion-status or logs for the
    result. When EXCURSION_ENGINE_ENABLED is off, returns
    {started: False, reason: "disabled"} WITHOUT spawning a thread (honest vs a
    misleading {started: True}).

    Optional `?limit=N` caps the number of COMPUTES this run (skip-already-computed
    rows don't count) — for a controlled first backfill on a large book. If a run
    is already in flight, returns {started: False, reason: "already running"}
    instead of spawning a redundant thread."""
    import threading

    from api.services.journal_two import excursion_jobs

    if not excursion_jobs._enabled():
        return {"started": False, "reason": "disabled"}
    if excursion_jobs.get_state().get("running"):
        return {"started": False, "reason": "already running"}

    threading.Thread(
        target=excursion_jobs.run_backfill,
        kwargs={"limit": limit},
        daemon=True,
        name="j2-excursion-backfill-manual",
    ).start()
    return {"started": True}


@router.get("/admin/excursion-status")
def excursion_status_route() -> dict[str, Any]:
    """Last-run summary of the excursion backfill (no auth — read-only, mirrors
    /api/admin/reconciliation-status): startedAt/finishedAt + tradesDone/
    optionsDone/insufficient/errors/symbols + fatal error (if any)."""
    from api.services.journal_two import excursion_jobs

    return excursion_jobs.get_state()


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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-account aggregate metrics for the Comparison view. The Scope
    (FilterSpec: date_from/date_to/symbol/sides/setups/tags) scopes each
    account's trade-derived metrics."""
    accounts_service.get_or_migrate_default_account(user["id"])
    return accounts_service.comparison(user["id"], spec=spec)


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
    purge: bool = False,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        ok = accounts_service.delete_account(user["id"], account_id, purge=purge)
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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Current Daily/Weekly/Monthly/Yearly P&L vs each target. The Scope
    (FilterSpec) filters which trades count toward each period."""
    got = accounts_service.goal_progress(user["id"], account_id, spec=spec)
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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
):
    """Per-setup historical performance for the live coaching panel. The
    ``setup`` query param picks the card; the Scope (FilterSpec) composes,
    narrowing the row universe."""
    return setup_stats_service.get_setup_stats(
        user["id"], account_id, setup, spec=spec,
    )


@router.get("/accounts/{account_id}/playbook")
def get_playbook_stats_route(
    account_id: str,
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
):
    """All-setups Playbook aggregate (Insights → Playbook cards): per-setup
    profit factor / expectancy / exit-efficiency + win-rate/avg-R, Scope-aware
    via the FilterSpec. Confidence (n<10) shading is owned by the frontend (B4):
    the backend returns every computed number with `tradeCount` + coverage counts
    and does NOT hard-suppress low-n setups here."""
    return playbook_stats_service.get_playbook_stats(
        user["id"], account_id, spec=spec,
    )


@router.get("/accounts/{account_id}/verdict-scorecard")
def get_verdict_scorecard_route(
    account_id: str,
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
):
    """P6-2 verdict-vs-outcome scorecard: scores Compass's GO/HOLD/SKIP pre-trade
    verdicts against actual closed-trade outcomes, Scope-aware via the FilterSpec.
    GO/HOLD → `taken` buckets; a SKIP taken anyway → the `overridden` bucket + a
    hero loss-rate headline; SKIPs the user obeyed (no trade) via an anti-join
    over j2_verdicts. Coverage counts trades-with-verdict vs total."""
    return verdict_scorecard_service.get_verdict_scorecard(
        user["id"], account_id, spec=spec,
    )


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
            parent_id=payload.get("parentId") or "",
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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """All option strategies for the user, newest-first. Filters are optional.

    The Scope (FilterSpec) filters strategies by SYMBOL only (on ``underlying``);
    its date facet acts as the entry_date range (parse_filter_query supplies
    date_from/date_to). Side/setups/tags have no strategy analog (ignored)."""
    try:
        return {
            "strategies": options_service.list_strategies(
                user["id"],
                account_id=account_id,
                status=status,
                spec=spec,
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
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Single mega-endpoint returning all chart data for the Analytics tab in
    one round-trip. Scope: optional ?account_id= base predicate + the full
    FilterSpec (date_from/date_to/symbol/sides/setups/tags) parsed by
    parse_filter_query, so filtered analytics agree with every other surface."""
    return analytics_service.get_analytics(
        user["id"], account_id=account_id, spec=spec,
    )


# ── Calendar (Phase 1) ───────────────────────────────────────────────────────


@router.get("/calendar")
def get_calendar(
    view: str = "month",
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    account_id: str | None = None,
    basis: str = "closed",
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Aggregate trades into per-day buckets for the requested period.
    `view` = year|month|week. `basis` = closed|account (account-balance mode
    is broker-only; falls back to closed when unavailable).

    Scope: the FilterSpec's NON-date facets (symbol/sides/setups/tags) filter
    which trades count toward each day; the calendar's own view/year/month/week
    window is unchanged (the Scope date facet is ignored here)."""
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
            basis=basis,
            spec=spec,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/calendar/day/{date}")
def get_calendar_day(
    date: str,
    account_id: str | None = None,
    basis: str = "closed",
    spec: FilterSpec = Depends(parse_filter_query),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-day metrics + trade list + saved reflection notes. The Scope's
    non-date facets filter the day's trades; the day itself is fixed."""
    # Validate date format YYYY-MM-DD
    from datetime import date as Date
    try:
        Date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return calendar_service.get_day_detail(
        user["id"], date, account_id=account_id, basis=basis, spec=spec,
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
