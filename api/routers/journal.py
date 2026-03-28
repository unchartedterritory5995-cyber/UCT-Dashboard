"""Journal API — per-user trade journal with filtering, executions, screenshots, review queue,
insights, CSV import, and AI summaries."""

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import journal_service, journal_screenshots
from api.services.journal_executions import (
    list_executions, create_execution, delete_execution,
)
from api.services.journal_taxonomy import (
    MISTAKE_TAXONOMY, EMOTION_TAGS, SETUP_GROUPS, SCREENSHOT_SLOTS,
)
from api.services.daily_journal_service import (
    get_or_create_daily, update_daily as _update_daily, list_daily_journals,
)
from api.services.journal_analytics import get_analytics, VALID_GROUP_BY
from api.services import playbook_service, resource_service
from api.services import journal_insights, journal_import, journal_ai
from api.services import trading_accounts

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class JournalEntry(BaseModel):
    sym: str
    direction: Optional[str] = "long"
    setup: Optional[str] = ""
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = "open"
    entry_date: Optional[str] = ""
    exit_date: Optional[str] = None
    notes: Optional[str] = ""
    rating: Optional[int] = None
    # v2 fields
    account: Optional[str] = "default"
    asset_class: Optional[str] = "equity"
    strategy: Optional[str] = ""
    playbook_id: Optional[str] = None
    tags: Optional[str] = ""
    mistake_tags: Optional[str] = None
    emotion_tags: Optional[str] = None
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    fees: Optional[float] = 0
    shares: Optional[float] = None
    risk_dollars: Optional[float] = None
    thesis: Optional[str] = ""
    market_context: Optional[str] = ""
    confidence: Optional[int] = None
    ps_setup: Optional[int] = None
    ps_entry: Optional[int] = None
    ps_exit: Optional[int] = None
    ps_sizing: Optional[int] = None
    ps_stop: Optional[int] = None
    outcome_score: Optional[int] = None
    lesson: Optional[str] = ""
    follow_up: Optional[str] = ""
    review_status: Optional[str] = None
    session: Optional[str] = ""


class JournalUpdate(BaseModel):
    sym: Optional[str] = None
    direction: Optional[str] = None
    setup: Optional[str] = None
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = None
    entry_date: Optional[str] = None
    exit_date: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    pnl_pct: Optional[float] = None
    pnl_dollar: Optional[float] = None
    account: Optional[str] = None
    asset_class: Optional[str] = None
    strategy: Optional[str] = None
    playbook_id: Optional[str] = None
    tags: Optional[str] = None
    mistake_tags: Optional[str] = None
    emotion_tags: Optional[str] = None
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    fees: Optional[float] = None
    shares: Optional[float] = None
    risk_dollars: Optional[float] = None
    thesis: Optional[str] = None
    market_context: Optional[str] = None
    confidence: Optional[int] = None
    ps_setup: Optional[int] = None
    ps_entry: Optional[int] = None
    ps_exit: Optional[int] = None
    ps_sizing: Optional[int] = None
    ps_stop: Optional[int] = None
    outcome_score: Optional[int] = None
    lesson: Optional[str] = None
    follow_up: Optional[str] = None
    review_status: Optional[str] = None
    session: Optional[str] = None


class ExecutionCreate(BaseModel):
    exec_type: str  # entry, add, trim, exit, stop
    exec_date: str
    exec_time: Optional[str] = None
    price: float
    shares: float
    fees: Optional[float] = 0
    notes: Optional[str] = ""
    sort_order: Optional[int] = 0


# ── Trade CRUD ───────────────────────────────────────────────────────────────

@router.get("/api/journal")
def list_journal(
    status: Optional[str] = None,
    review_status: Optional[str] = None,
    symbol: Optional[str] = None,
    setup: Optional[str] = None,
    direction: Optional[str] = None,
    asset_class: Optional[str] = None,
    playbook_id: Optional[str] = None,
    session: Optional[str] = None,
    day_of_week: Optional[str] = None,
    account: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    tag: Optional[str] = None,
    mistake_tag: Optional[str] = None,
    has_screenshots: Optional[str] = None,
    has_notes: Optional[str] = None,
    has_process_score: Optional[str] = None,
    min_r: Optional[float] = None,
    max_r: Optional[float] = None,
    min_pnl: Optional[float] = None,
    max_pnl: Optional[float] = None,
    sort_by: Optional[str] = "entry_date",
    sort_dir: Optional[str] = "desc",
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    filters = {
        "status": status, "review_status": review_status, "symbol": symbol,
        "setup": setup, "direction": direction, "asset_class": asset_class,
        "playbook_id": playbook_id, "session": session, "day_of_week": day_of_week,
        "account": account, "date_from": date_from, "date_to": date_to,
        "tag": tag, "mistake_tag": mistake_tag, "has_screenshots": has_screenshots,
        "has_notes": has_notes, "has_process_score": has_process_score,
        "min_r": min_r, "max_r": max_r, "min_pnl": min_pnl, "max_pnl": max_pnl,
        "sort_by": sort_by, "sort_dir": sort_dir,
    }
    # Remove None values
    filters = {k: v for k, v in filters.items() if v is not None}
    return journal_service.list_entries(user["id"], filters=filters, limit=limit, offset=offset)


@router.get("/api/journal/stats")
def journal_stats(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    return journal_service.get_stats(user["id"], date_from=date_from, date_to=date_to)


@router.get("/api/journal/taxonomy")
def journal_taxonomy():
    """Return mistake library, emotion tags, setup groups, screenshot slots."""
    return {
        "mistakes": MISTAKE_TAXONOMY,
        "emotions": EMOTION_TAGS,
        "setups": SETUP_GROUPS,
        "screenshot_slots": SCREENSHOT_SLOTS,
    }


@router.get("/api/journal/review-queue")
def review_queue(user: dict = Depends(get_current_user)):
    return journal_service.get_review_queue(user["id"])


@router.get("/api/journal/calendar")
def journal_calendar(
    month: str = Query(..., description="YYYY-MM format"),
    user: dict = Depends(get_current_user),
):
    return journal_service.get_calendar(user["id"], month)


@router.post("/api/journal")
def create_journal_entry(entry: JournalEntry, user: dict = Depends(get_current_user)):
    return journal_service.create_entry(user["id"], entry.model_dump())


@router.put("/api/journal/{entry_id}")
def update_journal_entry(entry_id: str, update: JournalUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in update.model_dump().items() if v is not None}
    result = journal_service.update_entry(user["id"], entry_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: str, user: dict = Depends(get_current_user)):
    if not journal_service.delete_entry(user["id"], entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}


# ── Daily Journals ────────────────────────────────────────────────────────────

class DailyJournalUpdate(BaseModel):
    premarket_thesis: Optional[str] = None
    focus_list: Optional[str] = None
    a_plus_setups: Optional[str] = None
    risk_plan: Optional[str] = None
    market_regime: Optional[str] = None
    emotional_state: Optional[str] = None
    midday_notes: Optional[str] = None
    eod_recap: Optional[str] = None
    did_well: Optional[str] = None
    did_poorly: Optional[str] = None
    learned: Optional[str] = None
    tomorrow_focus: Optional[str] = None
    energy_rating: Optional[int] = None
    discipline_score: Optional[int] = None
    review_complete: Optional[int] = None


@router.get("/api/journal/daily")
def list_daily(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    return list_daily_journals(user["id"], date_from, date_to)


@router.get("/api/journal/daily/{date}")
def get_daily(date: str, user: dict = Depends(get_current_user)):
    return get_or_create_daily(user["id"], date)


@router.put("/api/journal/daily/{date}")
def update_daily_journal(date: str, body: DailyJournalUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return _update_daily(user["id"], date, data)


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/api/journal/analytics")
def journal_analytics(
    group_by: str = Query("setup", description="Dimension to group by"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    if group_by not in VALID_GROUP_BY:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid group_by. Must be one of: {', '.join(sorted(VALID_GROUP_BY))}",
        )
    return get_analytics(user["id"], group_by, date_from, date_to)


# ── Playbooks ─────────────────────────────────────────────────────────────────

class PlaybookCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    market_condition: Optional[str] = ""
    trigger_criteria: Optional[str] = ""
    invalidations: Optional[str] = ""
    entry_model: Optional[str] = ""
    exit_model: Optional[str] = ""
    sizing_rules: Optional[str] = ""
    common_mistakes: Optional[str] = ""
    best_practices: Optional[str] = ""
    ideal_time: Optional[str] = ""
    ideal_volatility: Optional[str] = ""


class PlaybookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    market_condition: Optional[str] = None
    trigger_criteria: Optional[str] = None
    invalidations: Optional[str] = None
    entry_model: Optional[str] = None
    exit_model: Optional[str] = None
    sizing_rules: Optional[str] = None
    common_mistakes: Optional[str] = None
    best_practices: Optional[str] = None
    ideal_time: Optional[str] = None
    ideal_volatility: Optional[str] = None
    is_active: Optional[int] = None


@router.get("/api/journal/playbooks")
def list_playbooks(user: dict = Depends(get_current_user)):
    return playbook_service.list_playbooks(user["id"])


@router.post("/api/journal/playbooks")
def create_playbook(body: PlaybookCreate, user: dict = Depends(get_current_user)):
    return playbook_service.create_playbook(user["id"], body.model_dump())


@router.get("/api/journal/playbooks/{pb_id}")
def get_playbook(pb_id: str, user: dict = Depends(get_current_user)):
    result = playbook_service.get_playbook(user["id"], pb_id)
    if not result:
        raise HTTPException(status_code=404, detail="Playbook not found")
    return result


@router.put("/api/journal/playbooks/{pb_id}")
def update_playbook(pb_id: str, body: PlaybookUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = playbook_service.update_playbook(user["id"], pb_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Playbook not found")
    return result


@router.delete("/api/journal/playbooks/{pb_id}")
def delete_playbook(pb_id: str, user: dict = Depends(get_current_user)):
    if not playbook_service.delete_playbook(user["id"], pb_id):
        raise HTTPException(status_code=404, detail="Playbook not found")
    return {"ok": True}


@router.get("/api/journal/playbooks/{pb_id}/trades")
def playbook_trades(pb_id: str, user: dict = Depends(get_current_user)):
    return playbook_service.get_playbook_trades(user["id"], pb_id)


# ── Resources ─────────────────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    category: str  # checklist, rule, template, psychology, plan
    title: str
    content: Optional[str] = ""
    sort_order: Optional[int] = 0
    is_pinned: Optional[int] = 0


class ResourceUpdate(BaseModel):
    category: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    sort_order: Optional[int] = None
    is_pinned: Optional[int] = None


@router.get("/api/journal/resources")
def list_resources(category: Optional[str] = None, user: dict = Depends(get_current_user)):
    return resource_service.list_resources(user["id"], category)


@router.post("/api/journal/resources")
def create_resource(body: ResourceCreate, user: dict = Depends(get_current_user)):
    return resource_service.create_resource(user["id"], body.model_dump())


@router.put("/api/journal/resources/{res_id}")
def update_resource(res_id: str, body: ResourceUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = resource_service.update_resource(user["id"], res_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Resource not found")
    return result


@router.delete("/api/journal/resources/{res_id}")
def delete_resource(res_id: str, user: dict = Depends(get_current_user)):
    if not resource_service.delete_resource(user["id"], res_id):
        raise HTTPException(status_code=404, detail="Resource not found")
    return {"ok": True}


# ── Insights ─────────────────────────────────────────────────────────────────

@router.get("/api/journal/insights")
def journal_insights_endpoint(
    limit: int = 8,
    user: dict = Depends(get_current_user),
):
    """Up to 8 pattern-derived coaching statements from trade data (no AI)."""
    return journal_insights.get_insights(user["id"], limit=limit)


# ── CSV Import ───────────────────────────────────────────────────────────────

@router.post("/api/journal/import")
async def import_csv_preview(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Step 1: Upload CSV, auto-detect broker, return preview + field mapping."""
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []

    broker = journal_import.detect_broker(headers)

    # Auto-map fields if broker detected
    mapping = {}
    if broker:
        mapping = journal_import.build_auto_mapping(headers, broker)

    # Parse with auto-mapping for preview
    rows, warnings = journal_import.parse_csv(content, mapping)
    dupes = journal_import.find_duplicates(user["id"], rows)

    return {
        "headers": headers,
        "detected_broker": broker,
        "auto_mapping": mapping,
        "preview_rows": rows[:10],
        "total_rows": len(rows),
        "duplicate_indices": dupes,
        "warnings": warnings[:20],
        "filename": file.filename,
    }


class ImportConfirmBody(BaseModel):
    csv_content: str
    field_mapping: dict
    skip_duplicates: bool = True
    filename: Optional[str] = None
    broker_format: Optional[str] = None


@router.post("/api/journal/import/confirm")
def confirm_import(
    body: ImportConfirmBody,
    user: dict = Depends(get_current_user),
):
    """Step 2: Confirm import with final field mapping."""
    rows, warnings = journal_import.parse_csv(body.csv_content, body.field_mapping)
    skip_indices = set()
    if body.skip_duplicates:
        skip_indices = set(journal_import.find_duplicates(user["id"], rows))

    result = journal_import.import_trades(
        user["id"], rows, skip_indices,
        filename=body.filename,
        broker_format=body.broker_format,
    )
    result["warnings"] = warnings
    return result


@router.get("/api/journal/import/history")
def import_history(user: dict = Depends(get_current_user)):
    """List previous import sessions."""
    return journal_import.get_import_history(user["id"])


# ── AI Digest ────────────────────────────────────────────────────────────────

@router.get("/api/journal/ai-digest")
def get_ai_digest(
    week: str = Query(..., description="Week start date YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
):
    """Generate weekly AI digest for the given week."""
    return journal_ai.generate_weekly_digest(user["id"], week)


# ── Trading Accounts ─────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    name: str
    broker: Optional[str] = None
    account_number: Optional[str] = None
    balance: Optional[float] = 50000
    initial_balance: Optional[float] = None
    max_risk_pct: Optional[float] = 1.0
    max_position_pct: Optional[float] = 10.0
    is_default: Optional[bool] = False


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    broker: Optional[str] = None
    account_number: Optional[str] = None
    balance: Optional[float] = None
    initial_balance: Optional[float] = None
    max_risk_pct: Optional[float] = None
    max_position_pct: Optional[float] = None


@router.get("/api/journal/accounts")
def list_accounts(user: dict = Depends(get_current_user)):
    return trading_accounts.list_accounts(user["id"])


@router.post("/api/journal/accounts")
def create_account(body: AccountCreate, user: dict = Depends(get_current_user)):
    data = body.model_dump()
    if data.get("initial_balance") is None:
        data["initial_balance"] = data.get("balance", 50000)
    return trading_accounts.create_account(user["id"], data)


@router.put("/api/journal/accounts/{account_id}")
def update_account(account_id: int, body: AccountUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = trading_accounts.update_account(user["id"], account_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return result


@router.delete("/api/journal/accounts/{account_id}")
def delete_account(account_id: int, user: dict = Depends(get_current_user)):
    if not trading_accounts.delete_account(user["id"], account_id):
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True}


@router.put("/api/journal/accounts/{account_id}/default")
def set_default_account(account_id: int, user: dict = Depends(get_current_user)):
    result = trading_accounts.set_default(user["id"], account_id)
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return result


# ── Portfolio (open positions view) ──────────────────────────────────────────

@router.get("/api/journal/portfolio")
def get_portfolio(user: dict = Depends(get_current_user)):
    from api.services.portfolio_service import get_portfolio
    return get_portfolio(user["id"])


# ── Single Trade Fetch (MUST be after all /api/journal/{specific} routes) ────

@router.get("/api/journal/{entry_id}")
def get_journal_entry(entry_id: str, user: dict = Depends(get_current_user)):
    result = journal_service.get_entry(user["id"], entry_id)
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


# ── Executions ───────────────────────────────────────────────────────────────

@router.get("/api/journal/{trade_id}/executions")
def get_executions(trade_id: str, user: dict = Depends(get_current_user)):
    return list_executions(user["id"], trade_id)


@router.post("/api/journal/{trade_id}/executions")
def add_execution(trade_id: str, exec_data: ExecutionCreate, user: dict = Depends(get_current_user)):
    result = create_execution(user["id"], trade_id, exec_data.model_dump())
    if result is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


@router.delete("/api/journal/{trade_id}/executions/{exec_id}")
def remove_execution(trade_id: str, exec_id: str, user: dict = Depends(get_current_user)):
    if not delete_execution(user["id"], trade_id, exec_id):
        raise HTTPException(status_code=404, detail="Execution not found")
    return {"ok": True}


# ── AI Summary (per-trade) ───────────────────────────────────────────────────

@router.post("/api/journal/{trade_id}/ai-summary")
def generate_ai_summary(
    trade_id: str,
    force: bool = False,
    user: dict = Depends(get_current_user),
):
    """Generate or retrieve AI summary for a trade. User-triggered only."""
    result = journal_ai.generate_trade_summary(user["id"], trade_id, force=force)
    if result.get("error") == "Trade not found":
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


# ── Screenshots ──────────────────────────────────────────────────────────────

@router.get("/api/journal/{trade_id}/screenshots")
def get_screenshots(trade_id: str, user: dict = Depends(get_current_user)):
    return journal_screenshots.list_screenshots(user["id"], trade_id)


@router.post("/api/journal/{trade_id}/screenshots")
async def upload_screenshot(
    trade_id: str,
    file: UploadFile = File(...),
    slot: str = Form("pre_entry"),
    label: str = Form(""),
    user: dict = Depends(get_current_user),
):
    result = await journal_screenshots.upload_screenshot(user["id"], trade_id, file, slot, label)
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.get("/api/journal/{trade_id}/screenshots/{screenshot_id}")
def serve_screenshot(trade_id: str, screenshot_id: str, user: dict = Depends(get_current_user)):
    path = journal_screenshots.get_screenshot_path(user["id"], trade_id, screenshot_id)
    if not path:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=3600"})


@router.delete("/api/journal/{trade_id}/screenshots/{screenshot_id}")
def remove_screenshot(trade_id: str, screenshot_id: str, user: dict = Depends(get_current_user)):
    if not journal_screenshots.delete_screenshot(user["id"], trade_id, screenshot_id):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return {"ok": True}
