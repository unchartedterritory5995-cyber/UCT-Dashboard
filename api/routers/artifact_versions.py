"""COV-06 — version history on a member's own saved screens, named layouts and watchlists.

  GET  /api/artifact-versions/status                              → 200 while armed (the UI's probe)
  GET  /api/artifact-versions/{kind}/deleted                      → my DELETED artefacts that kept a history
  GET  /api/artifact-versions/{kind}/{artifact_id}                → the history, newest first
  GET  /api/artifact-versions/{kind}/{artifact_id}/{version}      → one version, with its payload
  POST /api/artifact-versions/{kind}/{artifact_id}/restore        → restore {version, base_version}
  POST /api/artifact-versions/{kind}/{artifact_id}/undelete       → bring a deleted one back {version, base_version}

``kind`` is ``screen`` (``screener_saved_screens``), ``layout`` (a user-scope row of
``charts_layouts``) or ``watchlist`` (one of the member's own ``watchlists`` whose contents are
theirs — never the flagged shadow list, an admin INDEX list, or a LINKED list). DARK behind
``ARTIFACT_VERSIONS_ENABLED``: unset, every route answers 404 — the same answer as a route that
does not exist — before the caller is even identified.

OWNER-SCOPED: an artefact that is not the caller's own answers 404 (never 403 — from the caller's
side somebody else's screen does not exist). Not even an admin reads another member's history; a
prebuilt (global) layout has none. A saved screen is paid content (``/api/screener/saved-screens``
is ``require_paid``), so its history is too: a free caller gets 402.

DELETED ARTEFACTS. A delete while armed leaves a tombstone in the history
(``artifact_versions.record_delete``), so the history OUTLIVES the artefact. A history row is
keyed by its owner, so "this member has history for an id that no longer exists" is enough to
show it under Recently deleted and to read it — never another member's. ``undelete`` recreates the
artefact under its OLD id from any kept version (compare-and-set like a restore; 409 if the
artefact exists again), unpublished / unshared, and records it as a new ``restore`` version.

RESTORE is compare-and-set on ``base_version`` (the head the list was read at); a stale base is
409 and nothing is written. Both writes are explicit POSTs only — no read path ever writes.

Plain ``def`` routes: the stores are blocking SQLite (``tests/test_async_routes_do_not_block.py``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import artifact_versions as av
from api.services import charts_layout_service as layouts
from api.services import watchlist_service
from api.services.auth_db import get_connection
from api.services.screener import saved_screens

router = APIRouter(prefix="/api/artifact-versions", tags=["artifact-versions"])


def _armed() -> None:
    if not av.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class RestoreIn(BaseModel):
    version: int
    base_version: int


def _id(kind: str, raw: str):
    """The artefact id in its store's own type: integer for screens and layouts, text for lists."""
    if kind not in av.KINDS:
        raise HTTPException(status_code=404, detail="Not Found")
    if kind == av.KIND_WATCHLIST:
        return raw
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Not found")


def _gate_kind(kind: str, user: dict) -> None:
    if kind not in av.KINDS:
        raise HTTPException(status_code=404, detail="Not Found")
    if kind == av.KIND_SCREEN and not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Saved screens require a paid plan")


def _exists(kind: str, artifact_id) -> bool:
    """Does the artefact exist at all (anyone's)? Used only to tell a DELETED one from a live one."""
    if kind == av.KIND_SCREEN:
        saved_screens.init()
        from api.services import auth_db
        with auth_db.get_connection() as c:
            return c.execute("SELECT 1 FROM screener_saved_screens WHERE id=?",
                             (artifact_id,)).fetchone() is not None
    if kind == av.KIND_LAYOUT:
        return layouts.get(artifact_id) is not None
    conn = get_connection()
    try:
        return conn.execute("SELECT 1 FROM watchlists WHERE id = ?", (artifact_id,)).fetchone() is not None
    finally:
        conn.close()


def _live(kind: str, artifact_id, user: dict):
    """The caller's own LIVE, versionable artefact, or ``None``."""
    uid = user["id"]
    if kind == av.KIND_SCREEN:
        saved_screens.init()
        return saved_screens.get(artifact_id, uid)
    if kind == av.KIND_LAYOUT:
        row = layouts.get(artifact_id)
        if row and (row["scope"] != "user" or str(row["user_id"]) != str(uid)):
            return None
        return row
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM watchlists WHERE id = ? AND user_id = ?",
                           (artifact_id, uid)).fetchone()
        return dict(row) if row is not None and watchlist_service.is_versionable(row) else None
    finally:
        conn.close()


def _owned(kind: str, artifact_id, user: dict) -> dict:
    """The caller's own live artefact, or 404. Raises 402 for a free caller on a screen."""
    _gate_kind(kind, user)
    row = _live(kind, artifact_id, user)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


def _owned_or_deleted(kind: str, artifact_id, user: dict) -> None:
    """Readable history: the caller's live artefact, or one of theirs that was deleted and kept a
    history (history rows are keyed by their owner, so this never reaches another member's)."""
    _gate_kind(kind, user)
    if _live(kind, artifact_id, user):
        return
    if not _exists(kind, artifact_id) and av.head(user["id"], kind, artifact_id) is not None:
        return
    raise HTTPException(status_code=404, detail="Not found")


@router.get("/status", dependencies=[Depends(_armed)])
def status(user: dict = Depends(get_current_user_with_plan)):
    """The client's availability probe: 200 only while armed. Carries no member data."""
    return {"enabled": True, "kinds": list(av.KINDS), "retain": av.RETAIN_VERSIONS}


@router.get("/{kind}/deleted", dependencies=[Depends(_armed)])
def list_deleted(kind: str, user: dict = Depends(get_current_user_with_plan)):
    """My artefacts of ``kind`` that no longer exist but kept a history, newest delete first."""
    _gate_kind(kind, user)
    out = []
    for h in av.owned_ids(user["id"], kind):
        aid = _id(kind, h["artifact_id"])
        if _exists(kind, aid):
            continue
        out.append({
            "artifact_id": aid,
            "label": h["label"],
            "head": h["version"],
            "deleted_at": h["created_at"] if h["source"] == av.SOURCE_DELETE else None,
        })
    return {"kind": kind, "deleted": out}


@router.get("/{kind}/{artifact_id}", dependencies=[Depends(_armed)])
def list_versions(kind: str, artifact_id: str, user: dict = Depends(get_current_user_with_plan)):
    aid = _id(kind, artifact_id)
    _owned_or_deleted(kind, aid, user)
    versions = av.history(user["id"], kind, aid)
    return {
        "kind": kind,
        "artifact_id": aid,
        "head": versions[0]["version"] if versions else None,
        "retain": av.RETAIN_VERSIONS,
        "versions": versions,
    }


@router.get("/{kind}/{artifact_id}/{version}", dependencies=[Depends(_armed)])
def read_version(kind: str, artifact_id: str, version: int,
                 user: dict = Depends(get_current_user_with_plan)):
    aid = _id(kind, artifact_id)
    _owned_or_deleted(kind, aid, user)
    v = av.get_version(user["id"], kind, aid, version)
    if v is None:
        raise HTTPException(status_code=404, detail="No such version.")
    return v


def _cas(uid, kind, aid, req: RestoreIn) -> dict:
    h = av.head(uid, kind, aid)
    head_v = h["version"] if h else 0
    if req.base_version != head_v:
        raise HTTPException(status_code=409, detail={
            "error": "version_conflict", "base_version": req.base_version, "head_version": head_v})
    target = av.get_version(uid, kind, aid, req.version)
    if target is None:
        raise HTTPException(status_code=404, detail="No such version.")
    return target


@router.post("/{kind}/{artifact_id}/restore", dependencies=[Depends(_armed)])
def restore(kind: str, artifact_id: str, req: RestoreIn,
            user: dict = Depends(get_current_user_with_plan)):
    aid = _id(kind, artifact_id)
    _owned(kind, aid, user)
    uid = user["id"]
    target = _cas(uid, kind, aid, req)
    payload = av.content(kind, target["payload"])
    if kind == av.KIND_SCREEN:
        out = saved_screens.restore_content(aid, uid, payload, restored_from=req.version)
    elif kind == av.KIND_LAYOUT:
        out = layouts.restore_content(aid, uid, payload, restored_from=req.version)
    else:
        out = watchlist_service.restore_content(uid, aid, payload, restored_from=req.version)
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    row, res = out
    return {
        "kind": kind,
        "artifact_id": aid,
        "restored_from": req.version,
        "appended": bool(res and res["appended"]),
        "version": res["version"] if res else None,
        "recorded": res is not None,
        "artifact": row,
    }


@router.post("/{kind}/{artifact_id}/undelete", dependencies=[Depends(_armed)])
def undelete(kind: str, artifact_id: str, req: RestoreIn,
             user: dict = Depends(get_current_user_with_plan)):
    aid = _id(kind, artifact_id)
    _gate_kind(kind, user)
    uid = user["id"]
    if _exists(kind, aid):
        raise HTTPException(status_code=409, detail={
            "error": "exists", "message": "This was not deleted, or it has already been brought back."})
    if av.head(uid, kind, aid) is None:
        raise HTTPException(status_code=404, detail="Not found")
    target = _cas(uid, kind, aid, req)
    payload = av.content(kind, target["payload"])
    if kind == av.KIND_SCREEN:
        out = saved_screens.undelete_content(aid, uid, payload, restored_from=req.version)
    elif kind == av.KIND_LAYOUT:
        out = layouts.undelete_content(aid, uid, payload, name=target.get("label") or "",
                                       restored_from=req.version)
    else:
        out = watchlist_service.undelete_content(uid, aid, payload, restored_from=req.version)
    if out is None:
        raise HTTPException(status_code=409, detail={
            "error": "exists", "message": "This was not deleted, or it has already been brought back."})
    row, res = out
    return {
        "kind": kind,
        "artifact_id": aid,
        "restored_from": req.version,
        "version": res["version"] if res else None,
        "recorded": res is not None,
        "artifact": row,
    }
