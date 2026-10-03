"""Charts in notes: the plan's server doors (wave 13, lane 13H-1) -- sizing, and an alert armed
at a drawn level. A THIN ADAPTER over engines that already exist.

  POST /api/j2/chart-plan/size     the block's plan, read by plan_extract, + the member's sizing
                                   inputs + Compass's `size_a_trade` answer (a long, paid)
  POST /api/j2/chart-plan/alerts   arm a price alert at a drawn level or trendline in one of the
                                   member's notes, THROUGH THE EXISTING watchlist-alert route
  GET  /api/j2/chart-plan/benchmarks?symbol=   (13H-2) the `/vs` choices: SPY, QQQ, the
                                   stock's sector ETF and theme ETF -- a read

  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_CHART_PLAN_ENABLED` off answers the one 404 for
    every route before the session or the body is read.
  * ⛔ NEVER A SECOND ALERT PIPELINE. The alert is created by calling the existing
    `POST /api/watchlist-alerts` handler (`api/routers/watchlist_alerts.create_alert`) with the
    same `AlertCreate` body the chart's own alert button sends, `drawing_id` set to the drawing's
    id. That row is the SAME row type, evaluated by the same checker, delivered by the same
    channels, re-pointed by the same bound PATCH when the line moves, and deleted by the same
    seen-to-absent rule (`useBoundDrawingAlerts.js`). This module writes no table.
    `tests/test_notebook_chart_plan.py` fails if it ever does.
  * The symbol comes from the NOTE, never the client: the chart block is found in the member's
    own live note by its `embedId`, and its `params.symbol` names the ticker. The drawing need
    not be saved yet (autosave lags the click); the level is the geometry the chart measured
    (`drawingAlertAnchors.anchorsForDrawing`), exactly as the chart's own alert button sends it.
  * ⛔ THE SERVER NEVER WRITES A NOTE (R-12). Both routes only read it.
  * Paths are outside `/api/j2/notes/...`, so journal_two's `/api/j2/notes/{note_id}` cannot
    shadow them.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import watchlist_alerts
from api.services.journal_two import chart_plan
from api.services.journal_two import public_note_payload as public

_MAX_BODY_BYTES = 256 * 1024
BAD_BODY_SENTENCE = "That request could not be read."
NO_CHART_SENTENCE = "That chart was not found in this note."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, parses no body, and answers the one not-found."""
    if not chart_plan.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/chart-plan",
    tags=["journal-2-0", "chart-plan"],
    dependencies=[Depends(_require_enabled)],
)


async def _read_json(request: Request) -> dict[str, Any]:
    """The JSON body, read INSIDE the dependency chain: gate, then member, then body."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > _MAX_BODY_BYTES:
            raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE)
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE) from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE)
    return body


async def _member_body(request: Request,
                       _user: dict = Depends(get_current_user_with_plan)) -> dict[str, Any]:
    return await _read_json(request)


@router.post("/size")
def size(body: dict = Depends(_member_body), user: dict = Depends(get_current_user_with_plan)):
    """`{annotations, symbol?, planBlock?, accountId?}` -> the block's plan as plan_extract reads
    it, the member's sizing inputs, and Compass's answer. The client sizes from these with
    `lib/chartPlan.sizePlan` (the starter formulas when Compass did not answer)."""
    anns = body.get("annotations")
    if anns is not None and not isinstance(anns, list):
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE)
    attrs: dict[str, Any] = {"widgetId": chart_plan.CHART_WIDGET, "annotations": anns or []}
    symbol = chart_plan.clean_symbol(body.get("symbol"))
    if symbol:
        attrs["params"] = {"symbol": symbol}
    if isinstance(body.get("planBlock"), dict):
        attrs["ta"] = {"planBlock": body["planBlock"]}
    plan = chart_plan.read_block_plan(attrs, symbol)
    account_id = body.get("accountId") if isinstance(body.get("accountId"), str) else None
    account = chart_plan.account_inputs(user["id"], account_id)
    compass = chart_plan.compass_size(plan["entry"], plan["stop"], account["accountSize"],
                                      account["riskPct"], paid=is_paid_user(user))
    return {"plan": plan, "account": account, "compass": compass}


@router.get("/benchmarks")
def benchmarks(symbol: str = "", _user: dict = Depends(get_current_user_with_plan)):
    """Wave 13 lane 13H-2: the `/vs` choices for one stock -- SPY, QQQ, its sector ETF and its
    theme ETF, each from an existing authority (`chart_plan.benchmark_options`). A read; a
    stock with no known sector or theme ETF gets a reason instead of an invented benchmark."""
    if not chart_plan.clean_symbol(symbol):
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE)
    return chart_plan.benchmark_options(symbol)


def _note_body(user_id: str, note_id: str) -> Any:
    from api.services.auth_db import get_connection  # noqa: PLC0415
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT body_json FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (note_id, user_id)).fetchone()
    finally:
        conn.close()
    return None if row is None else row[0]


@router.post("/alerts")
def arm_alert(body: dict = Depends(_member_body), user: dict = Depends(get_current_user_with_plan)):
    """`{noteId, embedId, drawingId, direction, alert_type, target_price, anchor_*}` -> the alert
    the EXISTING watchlist-alert route created, bound to `drawingId`."""
    note_id, embed_id, drawing_id = body.get("noteId"), body.get("embedId"), body.get("drawingId")
    if not all(isinstance(v, str) and v.strip() and len(v) <= 200 for v in (note_id, embed_id, drawing_id)):
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE)
    stored = _note_body(user["id"], note_id)
    attrs = chart_plan.find_chart_block(stored, embed_id) if stored is not None else None
    params = attrs.get("params") if isinstance(attrs, dict) and isinstance(attrs.get("params"), dict) else {}
    symbol = chart_plan.clean_symbol(params.get("symbol"))
    if attrs is None or not symbol:
        # another member's note, a trashed note, or a chart that is not there: one answer
        raise HTTPException(status_code=404, detail=NO_CHART_SENTENCE)
    fields = {k: body.get(k) for k in ("direction", "alert_type", "target_price",
                                       "anchor_t1", "anchor_p1", "anchor_t2", "anchor_p2")
              if body.get(k) is not None}
    try:
        create = watchlist_alerts.AlertCreate(sym=symbol, drawing_id=drawing_id, **fields)
    except ValidationError:
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE) from None
    # ⛔ THE existing door, called as itself: its validation, its row, its checker.
    alert = watchlist_alerts.create_alert(create, user)
    return {"alert": alert, "noteId": note_id, "embedId": embed_id, "symbol": symbol}
