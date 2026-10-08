"""The active setups board and find more like this (wave 13, lane 13J).

  member  GET  /api/j2/setups-board                                  session  the board, closest first
  paid    GET  /api/j2/similar-names/templates                       session  the member's tagged charts
  paid    GET  /api/j2/similar-names/{note_id}/{embed_key}           session  one chart's stored matches

The services are `api/services/journal_two/setups_board.py` (the board: levels read only through
`plan_extract`) and `api/services/journal_two/similar_matches.py` (the nightly precompute into
`j2_similar_matches`, and the reads below). Pages: `components/notebook/SetupsBoard.jsx`,
`BoardCard.jsx`, `SimilarNames.jsx`.

  * TWO ROUTERS, TWO GATES, EACH A ROUTER DEPENDENCY: `NOTEBOOK_SETUPS_BOARD_ENABLED` off answers
    the one 404 for the board, and `NOTEBOOK_FIND_SIMILAR_ENABLED` off answers it for the
    similar routes, before any session, plan or parameter is read.
  * THE BOARD IS A MEMBER ROUTE (the member's own notes and the last price). FIND SIMILAR IS
    PAID, like the fingerprint it ranks on (the Screener's columns and the pattern engine's
    confirmed verdicts are paid surfaces; `notebook_fingerprint.require_paid`).
  * ⛔⛔ THE SIMILAR ROUTES ONLY READ PRECOMPUTED ROWS. Nothing reachable from here opens the
    screener store, ranks the universe, computes a fingerprint or reads the pattern store
    (`tests/test_notebook_similar_matches.py`, mutation-proved).
  * Nothing here writes a note. Paths are outside `/api/j2/notes/...`, so journal_two's
    `/api/j2/notes/{note_id}` cannot shadow them.
"""
from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.auth_db import get_connection
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import setups_board, similar_matches

log = logging.getLogger(__name__)

UNREADABLE_SENTENCE = "Your setups could not be read just now. Try again in a minute."


def _gate(enabled):
    """One router-level gate per flag, each named `_require_enabled` like every Notebook
    router's (the route census finds a gate by that name and exercises it with its env var).
    An off gate reads no session and answers the one not-found."""
    def _require_enabled() -> None:
        if not enabled():
            raise public.not_found()
    # The census reads a dependency's qualified name; a closure's would be
    # `_gate.<locals>._require_enabled`, which no census row expects.
    _require_enabled.__qualname__ = "_require_enabled"
    return _require_enabled


router = APIRouter(prefix="/api/j2/setups-board", tags=["journal-2-0", "notebook-setups-board"],
                   dependencies=[Depends(_gate(setups_board.enabled))])
similar_router = APIRouter(prefix="/api/j2/similar-names", tags=["journal-2-0", "notebook-find-similar"],
                           dependencies=[Depends(_gate(similar_matches.enabled))])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The setups board and Find more like this require a paid plan")
    return user


def _conn() -> sqlite3.Connection:
    c = get_connection()
    c.row_factory = sqlite3.Row
    return c


@router.get("")
def get_board(user: dict = Depends(require_paid)):
    conn = _conn()
    try:
        return setups_board.build_cards(conn, str(user["id"]))
    except sqlite3.Error:
        log.warning("[setups_board] board unreadable", exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
    finally:
        conn.close()


@similar_router.get("/templates")
def get_templates(user: dict = Depends(require_paid)):
    conn = _conn()
    try:
        items = similar_matches.list_templates(conn, str(user["id"]))
        return {"templates": items, "count": len(items), "maxTemplates": similar_matches.MAX_TEMPLATES}
    except sqlite3.Error:
        log.warning("[similar_matches] templates unreadable", exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
    finally:
        conn.close()


@similar_router.get("/{note_id}/{embed_key}")
def get_matches(note_id: str, embed_key: str, user: dict = Depends(require_paid)):
    conn = _conn()
    try:
        out = similar_matches.read_matches(conn, str(user["id"]), note_id, embed_key)
    except sqlite3.Error:
        log.warning("[similar_matches] matches unreadable", exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
    finally:
        conn.close()
    if out is None:
        raise public.not_found()
    return out
