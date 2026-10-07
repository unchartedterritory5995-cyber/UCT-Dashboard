"""Plan vs execution grading routes (wave 13, lane 13A).

The service is `api/services/journal_two/plan_grading.py` (matching, the freeze, the four
checks, the discipline record) over `plan_extract.py` (the one reader of plan levels). The
client is `app/src/pages/journal-2-0/hooks/usePlanGrade.js`.

  member  GET   /api/j2/plan-grades/trades/{trade_id}          session  the trade's plan + four checks
  member  POST  /api/j2/plan-grades/trades/{trade_id}/relink   session  Re-link: a note, a verdict, or no plan
  member  GET   /api/j2/plan-grades/status?ids=a,b,...         session  planned / unplanned per trade (<= 200)
  member  GET   /api/j2/plan-grades/discipline?accountId=      session  the last 20 and 60 closed trades

The rules (the gallery router's, `notebook_template_gallery.py`):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_PLAN_GRADING_ENABLED` off answers the one 404 for
    every route before the session or the body is read.
  * THE BODY IS READ INSIDE THE DEPENDENCY CHAIN (gate, then member, then body), never as a
    FastAPI body parameter, so a malformed body can never answer 422 ahead of the gate.
  * MEMBER-SCOPED: every read and write is keyed on the session member's id; another member's
    trade id answers 404.
  * No route here writes a trade or a note. A GET may FREEZE a plan (the first match, R4) --
    that is a write to `j2_trade_plan_links` only, and it is idempotent (INSERT OR IGNORE).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.services import request_body_cap as body_cap
from api.middleware.auth_middleware import get_current_user
from api.services.auth_db import get_connection
from api.services.journal_two import plan_grading
from api.services.journal_two import public_note_payload as public

#: Per member, in `api/limiter.py`'s in-memory storage -- the limiter and the read rate the
#: sibling Notebook routes use (`notebook_shares.PUBLIC_RATE`). The three reads share one
#: bucket: they do the same work (a walk over trades and notes), so three routes must not be
#: three budgets. ⚠️ Per-process state: a second web process doubles both.
READ_RATE = "60/minute"
WRITE_RATE = "30/minute"
SCOPE_READ = "notebook-plan-grades-read"
SCOPE_WRITE = "notebook-plan-grades-relink"
RATE_SENTENCE = "Too many requests for your plan grades. Wait a minute and try again."

MAX_BODY_BYTES = 16_000
TOO_LARGE_SENTENCE = "Request too large"


def _require_enabled() -> None:
    """Router-level: an off gate reads no session and parses no body."""
    if not plan_grading.enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(
    prefix="/api/j2/plan-grades",
    tags=["journal-2-0", "notebook-plan-grades"],
    dependencies=[Depends(_require_enabled)],
)


async def _read_json(request: Request) -> dict[str, Any]:
    # ⛔ Capped WHILE it is read (wave 14, cap 2): this was `await request.body()`
    # then a length check, so a chunked or no-length body was buffered whole first.
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, TOO_LARGE_SENTENCE)
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Send a JSON object")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object")
    return data


def reader(user: dict = Depends(get_current_user)) -> dict:
    """The member, after one charge against their read rate. A dependency, so it runs after
    the router-level gate (an off gate answers its 404 and spends nothing) and after the
    session (a signed-out caller answers 401 and spends nothing)."""
    public.enforce_rate(READ_RATE, SCOPE_READ, f"member:{user['id']}", RATE_SENTENCE, public=False)
    return user


def writer(user: dict = Depends(get_current_user)) -> dict:
    """The member, after one charge against their Re-link rate."""
    public.enforce_rate(WRITE_RATE, SCOPE_WRITE, f"member:{user['id']}", RATE_SENTENCE, public=False)
    return user


async def member_body(request: Request, _user: dict = Depends(writer)) -> dict[str, Any]:
    return await _read_json(request)


@router.get("/trades/{trade_id}")
def get_trade_grade(trade_id: str, user: dict = Depends(reader)) -> dict[str, Any]:
    conn = get_connection()
    try:
        t = plan_grading.get_trade(conn, user["id"], trade_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        return plan_grading.grade_payload(conn, user["id"], t)
    finally:
        conn.close()


@router.post("/trades/{trade_id}/relink")
def relink_trade(trade_id: str, body: dict = Depends(member_body),
                 user: dict = Depends(get_current_user)) -> dict[str, Any]:
    note_id = body.get("noteId") if isinstance(body.get("noteId"), str) else None
    verdict_id = body.get("verdictId") if isinstance(body.get("verdictId"), str) else None
    none = body.get("none") is True
    if sum(1 for x in (note_id, verdict_id, none) if x) != 1:
        raise HTTPException(status_code=400, detail="Choose exactly one: a note, a verdict, or no plan")
    conn = get_connection()
    try:
        t = plan_grading.get_trade(conn, user["id"], trade_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        try:
            plan_grading.relink(conn, user["id"], t, note_id=note_id, verdict_id=verdict_id, none=none)
        except plan_grading.RelinkError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return plan_grading.grade_payload(conn, user["id"], t)
    finally:
        conn.close()


@router.get("/status")
def get_statuses(ids: str = Query("", max_length=20_000),
                 user: dict = Depends(reader)) -> dict[str, Any]:
    wanted = [s.strip() for s in ids.split(",") if s.strip()]
    if len(wanted) > plan_grading.MAX_STATUS_IDS:
        raise HTTPException(status_code=400, detail=f"At most {plan_grading.MAX_STATUS_IDS} trades at a time")
    conn = get_connection()
    try:
        return {"statuses": plan_grading.statuses(conn, user["id"], wanted)}
    finally:
        conn.close()


@router.get("/discipline")
def get_discipline(accountId: str | None = Query(None, max_length=128),  # noqa: N803 -- the client's name
                   user: dict = Depends(reader)) -> dict[str, Any]:
    conn = get_connection()
    try:
        return plan_grading.discipline_record(conn, user["id"], accountId or None)
    finally:
        conn.close()
