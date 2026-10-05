"""The market context frozen at the fill (wave 13, lane 13E-1).

  paid  GET  /api/j2/entry-context/meta                          fields, missing codes, limits
  paid  GET  /api/j2/entry-context?symbol=&entryDay=             one context by its KEY (no capture)
  paid  GET  /api/j2/entry-context/list?since=&until=&symbol=&limit=
                                                                 the member's contexts
  paid  GET  /api/j2/entry-context/position/{position_id}        a position's context (captures on
                                                                 demand when the entry is today's)
  paid  GET  /api/j2/entry-context/trade/{trade_id}              a trade's context, by the key
                                                                 (a broker trade's position id is
                                                                 a sentinel), same on-demand rule
  paid  PUT  /api/j2/entry-context/why                           {symbol, entryDay, text}: set or
                                                                 clear the "why did you take it"
  paid  POST /api/j2/entry-context/backfill                      freeze TODAY's market for open
                                                                 positions with none, labelled
                                                                 captured late

The service is `api/services/journal_two/entry_context.py`, the ONE authority; 13E-2 (the card
and the prompt), 13F and 13I-2 build on it (contract: `docs/notebook/wave13-13e1.md`).

  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_ENTRY_CONTEXT_ENABLED` off answers the one 404
    for every route before the session, the plan or a parameter is read.
  * PAID: the context carries the Screener's RS rank, the scanner's lists and the technical
    fingerprint, all paid surfaces; a free door here would make their gates decorative.
  * MEMBER-SCOPED: every read and write is `WHERE user_id = <the session member>`; another
    member's position or trade answers the one 404.
  * Never edits a position, a trade or a note. No model call is reachable.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.services import request_body_cap as body_cap
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import entry_context as ectx
from api.services.journal_two import public_note_payload as public

log = logging.getLogger(__name__)

UNREADABLE_SENTENCE = "The entry context could not be read just now. Try again in a minute."
NO_CONTEXT_SENTENCE = ("No market context was captured for this entry, so there is nothing to "
                       "attach the note to.")

#: A why note is at most WHY_MAX_CHARS characters; the body is bounded well above that.
MAX_BODY_BYTES = 8 * 1024
TOO_LARGE_SENTENCE = "Request too large"


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, parses no parameter, and answers the one not-found."""
    if not ectx.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/entry-context",
    tags=["journal-2-0", "notebook-entry-context"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The entry context requires a paid plan")
    return user


async def _read_json(request: Request) -> dict[str, Any]:
    # ⛔ Capped WHILE it is read (wave 14, cap 2): this was `await request.body()`
    # then a length check, so a chunked or no-length body was buffered whole first.
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, TOO_LARGE_SENTENCE)
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        raise HTTPException(status_code=422, detail="Send a JSON object") from None
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object")
    return data


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    return await _read_json(request)


def _unreadable(what: str, uid: str) -> HTTPException:
    log.warning("[notebook_entry_context] %s unreadable for %s", what, uid, exc_info=True)
    return HTTPException(status_code=503, detail=UNREADABLE_SENTENCE)


@router.get("/meta")
def meta(_user: dict = Depends(require_paid)):
    return {"version": ectx.CONTEXT_VERSION, "fields": list(ectx.FIELDS),
            "missingReasons": dict(ectx.MISSING_REASONS),
            "notCaptured": dict(ectx.NOT_CAPTURED_REASONS),
            "captureKinds": list(ectx.CAPTURE_KINDS), "whyMaxChars": ectx.WHY_MAX_CHARS}


@router.get("")
def by_key(symbol: str = Query(..., max_length=16), entryDay: str = Query(..., max_length=10),
           user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        ctx = ectx.get_context(uid, symbol, entryDay)
    except ectx.EntryContextRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        raise _unreadable("context", uid) from None
    key = {"symbol": ectx.clean_symbol(symbol), "entryDay": ectx.clean_day(entryDay)}
    if ctx is None:
        return {"status": "not_captured", "key": key, "context": None,
                "reason": ectx.NOT_CAPTURED_REASONS["not_captured"]}
    return {"status": "captured", "key": key, "context": ctx, "reason": None}


@router.get("/list")
def list_contexts(since: Optional[str] = Query(default=None, max_length=10),
                  until: Optional[str] = Query(default=None, max_length=10),
                  symbol: Optional[str] = Query(default=None, max_length=16),
                  limit: int = Query(default=ectx.LIST_LIMIT, ge=1, le=ectx.LIST_LIMIT),
                  user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        rows = ectx.list_contexts(uid, since=since, until=until, symbol=symbol, limit=limit)
    except ectx.EntryContextRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        raise _unreadable("list", uid) from None
    return {"contexts": rows, "count": len(rows)}


def _for(kind: str, item_id: str, user: dict) -> dict:
    uid = str(user["id"])
    try:
        out = ectx.read_for(uid, kind, item_id)
    except sqlite3.Error:
        raise _unreadable(kind, uid) from None
    if out is None:
        raise public.not_found()
    return out


@router.get("/position/{position_id}")
def for_position(position_id: str, user: dict = Depends(require_paid)):
    return _for("position", position_id, user)


@router.get("/trade/{trade_id}")
def for_trade(trade_id: str, user: dict = Depends(require_paid)):
    return _for("trade", trade_id, user)


@router.put("/why")
def put_why(body: dict = Depends(paid_body), user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        ctx = ectx.set_why(uid, body.get("symbol"), body.get("entryDay"), body.get("text"))
    except ectx.EntryContextRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        raise _unreadable("why", uid) from None
    if ctx is None:
        raise HTTPException(status_code=409, detail=NO_CONTEXT_SENTENCE)
    return {"context": ctx}


@router.post("/backfill")
def backfill(user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        return {"backfill": ectx.backfill_open_positions(uid)}
    except sqlite3.Error:
        raise _unreadable("backfill", uid) from None
