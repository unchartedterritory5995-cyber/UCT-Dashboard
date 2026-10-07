"""The technical fingerprint and the chart-block index (wave 13, lane 13I-1).

  paid  GET  /api/j2/notebook-fingerprint/meta                              field list + missing codes
  paid  GET  /api/j2/notebook-fingerprint/compute?symbol=&asOf=             a LIVE fingerprint (not stored)
  paid  GET  /api/j2/notebook-fingerprint/blocks?symbol=&setupTag=&noteId=&limit=
                                                                            the member's chart blocks
  paid  GET  /api/j2/notebook-fingerprint/blocks/{note_id}/{embed_key}      one block
  paid  POST /api/j2/notebook-fingerprint/blocks/{note_id}/{embed_key}/freeze
                                                                            freeze it now (idempotent)

The services are `api/services/journal_two/tech_fingerprint.py` (the ONE authority for a
chart's fingerprint) and `api/services/journal_two/chart_blocks.py` (the index and the freeze
ledger). The API contract 13I-2 and 13J build on is `docs/notebook/wave13-13i1.md`.

  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_TA_FINGERPRINT_ENABLED` off answers the one
    404 for every route before the session, the plan or a parameter is read.
  * PAID: every route takes this router's own `require_paid`. The fingerprint is the
    Screener's columns and the pattern engine's confirmed verdicts, both paid surfaces
    (`screener.require_paid`, `patterns.require_paid`); a free door here would make
    their gates decorative.
  * READS NEVER WRITE A NOTE. The block routes bring the member's index up to their notes
    (`chart_blocks.catch_up`) and may freeze a bounded number of new blocks; neither ever
    writes `j2_notes` (plan R-12). No model call and no vendor call is reachable.
  * Paths are outside `/api/j2/notes/...`, so journal_two's `/api/j2/notes/{note_id}` cannot
    shadow them.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import chart_blocks
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import tech_fingerprint as tfp

log = logging.getLogger(__name__)

UNREADABLE_SENTENCE = "The chart data could not be read just now. Try again in a minute."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, parses no parameter, and answers the one not-found."""
    if not tfp.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/notebook-fingerprint",
    tags=["journal-2-0", "notebook-fingerprint"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The technical fingerprint requires a paid plan")
    return user


@router.get("/meta")
def meta(_user: dict = Depends(require_paid)):
    return {"version": tfp.FINGERPRINT_VERSION, "fields": list(tfp.FIELDS),
            "missingReasons": dict(tfp.MISSING_REASONS),
            "transientMissing": sorted(tfp.TRANSIENT_MISSING)}


@router.get("/compute")
def compute(symbol: str = Query(..., max_length=16),
            asOf: Optional[str] = Query(default=None, max_length=10),
            _user: dict = Depends(require_paid)):
    try:
        return {"fingerprint": tfp.compute(symbol, asOf)}
    except tfp.FingerprintRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        log.warning("[notebook_fingerprint] compute unreadable for %s %s", symbol, asOf, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None


@router.get("/blocks")
def list_blocks(symbol: Optional[str] = Query(default=None, max_length=16),
                setupTag: Optional[str] = Query(default=None, max_length=80),
                noteId: Optional[str] = Query(default=None, max_length=64),
                limit: int = Query(default=chart_blocks.LIST_LIMIT, ge=1, le=chart_blocks.LIST_LIMIT),
                user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        progress = chart_blocks.catch_up(uid, note_id=noteId)
        blocks = chart_blocks.list_blocks(uid, symbol=symbol, setup_tag=setupTag,
                                          note_id=noteId, limit=limit)
    except tfp.FingerprintRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        log.warning("[notebook_fingerprint] block list unreadable for %s", uid, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
    return {"blocks": blocks, "count": len(blocks), "pending": progress["pending"]}


def _one(uid: str, note_id: str, embed_key: str) -> dict:
    block = chart_blocks.get_block(uid, note_id, embed_key)
    if block is None:
        raise public.not_found()
    return block


@router.get("/blocks/{note_id}/{embed_key}")
def get_block(note_id: str, embed_key: str, user: dict = Depends(require_paid)):
    uid = str(user["id"])
    try:
        chart_blocks.catch_up(uid, note_id=note_id)
        return {"block": _one(uid, note_id, embed_key)}
    except sqlite3.Error:
        log.warning("[notebook_fingerprint] block unreadable for %s", uid, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None


@router.post("/blocks/{note_id}/{embed_key}/freeze")
def freeze_block(note_id: str, embed_key: str, user: dict = Depends(require_paid)):
    """Freeze one block's fingerprint NOW, from the note's own symbol and day (never from a
    client-supplied pair). Idempotent: a block already frozen answers its frozen value
    unchanged. 13I-2 calls this right after inserting a chart, so the panel is exact to the
    insert moment rather than to the next catch-up."""
    uid = str(user["id"])
    try:
        chart_blocks.catch_up(uid, note_id=note_id, freeze_budget=0)
        block = _one(uid, note_id, embed_key)
        if block["fingerprint"] is None:
            if not block["symbol"] or not block["asOf"]:
                raise HTTPException(status_code=422,
                                    detail="This chart names no symbol or day, so it has no fingerprint.")
            conn = chart_blocks._connect()
            try:
                frozen = chart_blocks.freeze(conn, uid, note_id, embed_key, block["symbol"], block["asOf"])
            finally:
                conn.close()
            if frozen is None:
                raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE)
            block = _one(uid, note_id, embed_key)
        return {"block": block}
    except sqlite3.Error:
        log.warning("[notebook_fingerprint] freeze unreadable for %s", uid, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
