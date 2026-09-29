"""TERM-021 (FB-S5-01) — the versioned workspace document: read, history, restore, delete.

DARK behind ``WORKSPACE_DOC_STORE_ENABLED`` (read per request). Unset, every route answers 404 —
the same answer as a route that does not exist — and nothing opens or creates the store.

WRITE-BOTH / READ-NEW. While armed, ``GET /api/auth/preferences`` reads the board's keys from
the document head (``workspace_doc_store.read_prefs``), and ``user_preferences`` keeps being
written on every path, so disarming is a flag flip. Two routes here write BOTH stores, and each
is ONE document write first, then the same values into ``user_preferences`` under the SAME keys:

  * RESTORE appends a copy of an older version, so a member's board is what that version held.
  * APPLY (a template apply, New Layout, UCT Default) appends every key of the board change as
    ONE version, compare-and-set on the head the client read. A 409 changes nothing.

Each of those versions carries a ``pending`` row in the write-back ledger from the instant it is
appended, and a ``done`` row once every ``user_preferences`` write succeeded — so a crash in
between leaves the document complete and read-new serving it. A key the version does not carry
is left untouched — never deleted. DELETE appends a tombstone to the document only; it does not
touch the board.

Gate: ``get_current_user`` — the same gate as ``/api/auth/preferences``, whose data this is.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user
from api.services import auth_service
from api.services import workspace_doc_store as wds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace/doc", tags=["workspace-doc"])


def _armed() -> None:
    if not wds.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _board(board: str) -> str:
    if board not in wds.BOARDS:
        raise HTTPException(status_code=400, detail=f"Unknown board {board!r}.")
    return board


def _conflict(exc: wds.VersionConflict) -> HTTPException:
    return HTTPException(status_code=409, detail={
        "error": "version_conflict",
        "base_version": exc.base_version,
        "head_version": exc.head_version,
    })


class RestoreRequest(BaseModel):
    version: int
    base_version: int
    board: str = wds.BOARD_CHARTS


class ApplyRequest(BaseModel):
    base_version: int
    prefs: dict[str, Optional[str]] = Field(default_factory=dict)
    board: str = wds.BOARD_CHARTS


def _write_back(uid: str, values: dict) -> tuple[list, list, list]:
    """Put ``values`` into ``user_preferences`` under the same keys. ``(written, unchanged,
    failed)``, each by NAME: a failed key is reported, never swallowed, and never deleted."""
    current = auth_service.get_user_preferences(uid)
    written, unchanged, failed = [], [], []
    for key in sorted(values):
        value = values[key]
        if key in current and current[key] == value:
            unchanged.append(key)
            continue
        try:
            auth_service.set_user_preference(uid, key, value)
            written.append(key)
        except Exception as exc:  # noqa: BLE001 -- reported by name, never swallowed
            logger.warning("[workspace_doc] write-back failed %s/%s: %s", uid, key, exc)
            failed.append(key)
    return written, unchanged, failed


@router.get("/health", dependencies=[Depends(_armed)])
def health(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only.")
    return wds.stats()


@router.get("", dependencies=[Depends(_armed)])
def read_doc(board: str = Query(wds.BOARD_CHARTS), user: dict = Depends(get_current_user)):
    """The head document. The first read COPIES the board out of ``user_preferences``."""
    board = _board(board)
    wds.ensure_snapshot(user["id"], auth_service.get_user_preferences, board)
    h = wds.head(user["id"], board)
    return {
        "board": board,
        "version": h["version"],
        "tombstone": h["tombstone"],
        "source": h["source"],
        "doc": h["doc"],
        "parse_failures": wds.parse_failure_count(user["id"], board),
    }


@router.get("/versions", dependencies=[Depends(_armed)])
def list_versions(board: str = Query(wds.BOARD_CHARTS), limit: int = Query(50, ge=1, le=500),
                  user: dict = Depends(get_current_user)):
    board = _board(board)
    return {"board": board, "versions": wds.history(user["id"], board, limit)}


@router.get("/versions/{version}", dependencies=[Depends(_armed)])
def read_version(version: int, board: str = Query(wds.BOARD_CHARTS), user: dict = Depends(get_current_user)):
    board = _board(board)
    v = wds.get_version(user["id"], board, version)
    if v is None:
        raise HTTPException(status_code=404, detail="No such version.")
    return v


@router.post("/restore", dependencies=[Depends(_armed)])
def restore(req: RestoreRequest, user: dict = Depends(get_current_user)):
    """Restore version N (usually N-1). Compare-and-set on ``base_version``: a stale base is 409."""
    board = _board(req.board)
    uid = user["id"]
    try:
        res = wds.restore(uid, board, req.version, base_version=req.base_version)
    except wds.VersionConflict as exc:
        raise _conflict(exc)
    except LookupError:
        raise HTTPException(status_code=404, detail="No such version, or it is a tombstone.")

    restored = wds.prefs_from_doc(res["doc"])
    written, unchanged, failed = _write_back(uid, restored)
    if res["appended"] and not failed:
        wds.mark_writeback_done(uid, board, [res["version"]])
    current = auth_service.get_user_preferences(uid)
    untouched = sorted(k for k in current if k in wds.WORKSPACE_PREF_KEYS and k not in restored)
    return {
        "board": board,
        "version": res["version"],
        "appended": res["appended"],
        "restored_from": res["restored_from"],
        "prefs_written": written,
        "prefs_unchanged": unchanged,
        "prefs_failed": failed,
        "left_untouched": untouched,
        "complete": not failed,
    }


@router.post("/apply", dependencies=[Depends(_armed)])
def apply(req: ApplyRequest, user: dict = Depends(get_current_user)):
    """Apply a board change (a layout template, New Layout, UCT Default) as ONE document write.

    Compare-and-set on ``base_version``, the head the client read: a stale base is 409 and
    NOTHING is written, to either store — the client re-reads and reports, never retries. On a
    200 the version is already the member's board (read-new serves it); ``prefs_failed`` names
    any ``user_preferences`` key that did not follow, and the next read completes it."""
    from api.routers.auth import _validate_preference   # the old endpoint's own allow-list + schemas

    board = _board(req.board)
    if not req.prefs:
        raise HTTPException(status_code=400, detail="Nothing to apply.")
    for key, value in req.prefs.items():
        _validate_preference(key, value if value is not None else "")
    uid = user["id"]
    try:
        res = wds.apply_patch(uid, board, req.prefs, base_version=req.base_version,
                              prefs_reader=auth_service.get_user_preferences)
    except wds.VersionConflict as exc:
        raise _conflict(exc)
    except wds.InvalidDocument as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    written, unchanged, failed = _write_back(uid, req.prefs)
    if res["appended"] and not failed:
        wds.mark_writeback_done(uid, board, [res["version"]])
    return {
        "board": board,
        "version": res["version"],
        "appended": res["appended"],
        "prefs_written": written,
        "prefs_unchanged": unchanged,
        "prefs_failed": failed,
        "complete": not failed,
    }


@router.delete("", dependencies=[Depends(_armed)])
def delete_doc(base_version: int = Query(...), board: str = Query(wds.BOARD_CHARTS),
               user: dict = Depends(get_current_user)):
    """Append a TOMBSTONE. Every earlier version stays restorable; the board itself is untouched."""
    board = _board(board)
    try:
        res = wds.tombstone(user["id"], board, base_version=base_version)
    except wds.VersionConflict as exc:
        raise _conflict(exc)
    return {"board": board, **res}
