"""COV-06 — version history on a member's own saved screens and named layouts.

  GET  /api/artifact-versions/{kind}/{artifact_id}                → the history, newest first
  GET  /api/artifact-versions/{kind}/{artifact_id}/{version}      → one version, with its payload
  POST /api/artifact-versions/{kind}/{artifact_id}/restore        → restore {version, base_version}

``kind`` is ``screen`` (``screener_saved_screens``) or ``layout`` (a user-scope row of
``charts_layouts``). DARK behind ``ARTIFACT_VERSIONS_ENABLED``: unset, every route answers 404 —
the same answer as a route that does not exist — before the caller is even identified.

OWNER-SCOPED: an artefact that is not the caller's own answers 404 (never 403 — from the caller's
side somebody else's screen does not exist). Not even an admin reads another member's history; a
prebuilt (global) layout has none. A saved screen is paid content (``/api/screener/saved-screens``
is ``require_paid``), so its history is too: a free caller gets 402.

RESTORE is compare-and-set on ``base_version`` (the head the list was read at); a stale base is
409 and nothing is written. It is an explicit POST only — no read path ever writes. The old
payload goes back through the artefact's OWN store and is recorded as a NEW version, so the
restore is undone by restoring the version before it.

Plain ``def`` routes: the stores are blocking SQLite (``tests/test_async_routes_do_not_block.py``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import artifact_versions as av
from api.services import charts_layout_service as layouts
from api.services.screener import saved_screens

router = APIRouter(prefix="/api/artifact-versions", tags=["artifact-versions"])


def _armed() -> None:
    if not av.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class RestoreIn(BaseModel):
    version: int
    base_version: int


def _owned(kind: str, artifact_id: int, user: dict) -> dict:
    """The caller's own artefact, or 404. Raises 402 for a free caller on a screen."""
    uid = user["id"]
    if kind == av.KIND_SCREEN:
        if not is_paid_user(user):
            raise HTTPException(status_code=402, detail="Saved screens require a paid plan")
        saved_screens.init()
        row = saved_screens.get(artifact_id, uid)
    elif kind == av.KIND_LAYOUT:
        row = layouts.get(artifact_id)
        if row and (row["scope"] != "user" or str(row["user_id"]) != str(uid)):
            row = None
    else:
        raise HTTPException(status_code=404, detail="Not Found")
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.get("/{kind}/{artifact_id}", dependencies=[Depends(_armed)])
def list_versions(kind: str, artifact_id: int, user: dict = Depends(get_current_user_with_plan)):
    _owned(kind, artifact_id, user)
    versions = av.history(user["id"], kind, artifact_id)
    return {
        "kind": kind,
        "artifact_id": artifact_id,
        "head": versions[0]["version"] if versions else None,
        "retain": av.RETAIN_VERSIONS,
        "versions": versions,
    }


@router.get("/{kind}/{artifact_id}/{version}", dependencies=[Depends(_armed)])
def read_version(kind: str, artifact_id: int, version: int,
                 user: dict = Depends(get_current_user_with_plan)):
    _owned(kind, artifact_id, user)
    v = av.get_version(user["id"], kind, artifact_id, version)
    if v is None:
        raise HTTPException(status_code=404, detail="No such version.")
    return v


@router.post("/{kind}/{artifact_id}/restore", dependencies=[Depends(_armed)])
def restore(kind: str, artifact_id: int, req: RestoreIn,
            user: dict = Depends(get_current_user_with_plan)):
    _owned(kind, artifact_id, user)
    uid = user["id"]
    h = av.head(uid, kind, artifact_id)
    head_v = h["version"] if h else 0
    if req.base_version != head_v:
        raise HTTPException(status_code=409, detail={
            "error": "version_conflict", "base_version": req.base_version, "head_version": head_v})
    target = av.get_version(uid, kind, artifact_id, req.version)
    if target is None:
        raise HTTPException(status_code=404, detail="No such version.")
    payload = av.content(kind, target["payload"])
    if kind == av.KIND_SCREEN:
        out = saved_screens.restore_content(artifact_id, uid, payload, restored_from=req.version)
    else:
        out = layouts.restore_content(artifact_id, uid, payload, restored_from=req.version)
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    row, res = out
    return {
        "kind": kind,
        "artifact_id": artifact_id,
        "restored_from": req.version,
        "appended": bool(res and res["appended"]),
        "version": res["version"] if res else None,
        "recorded": res is not None,
        "artifact": row,
    }
