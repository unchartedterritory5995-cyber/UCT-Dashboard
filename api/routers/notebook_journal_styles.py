"""Journal styles (Notebook P1) routes. Service: api/services/journal_two/journal_styles.py and
note_kinds.py. Client: app/src/pages/journal-2-0/lib/journalStyles.js (shapes pinned by the contract
fixtures `journal-styles.*` and `note-kinds.*`, tools/notebook_contract_fixtures.py).

  GET    /api/j2/journal-styles                         kinds, styles, block kinds
  POST   /api/j2/journal-styles                         create, or save a note's setup ({fromNoteId})
  POST   /api/j2/journal-styles/preview                 compose without writing ({styleId} or {style})
  GET    /api/j2/journal-styles/{style_id}              one style in full
  PUT    /api/j2/journal-styles/{style_id}              patch (a content change bumps the version)
  DELETE /api/j2/journal-styles/{style_id}              soft delete (Undo = restore)
  POST   /api/j2/journal-styles/{style_id}/restore      undo a delete
  POST   /api/j2/journal-styles/{style_id}/default      make it its kind's default
  GET    /api/j2/note-kinds                             built-in and member kinds
  POST   /api/j2/note-kinds                             a member kind
  PUT    /api/j2/note-kinds/{kind_id}                   rename / icon / order
  DELETE /api/j2/note-kinds/{kind_id}                   409 while in use; answers purgedDeletedStyles
  GET    /api/j2/note-kinds/mapping-offer               the one-shot Research Type -> Kind offer
  POST   /api/j2/note-kinds/mapping-offer               apply it; answers the moved revisions and
                                                        the notes it skipped (locked, or changed
                                                        under it), never a 500 mid-loop
  GET    /api/j2/notes/{note_id}/style-update-plan      the "Update layout" dry run (writes nothing)
  POST   /api/j2/notes/{note_id}/apply-style-update     the one compare-and-set write ({styleId?,
                                                        baseUpdatedAt}). baseUpdatedAt is REQUIRED
                                                        (400 without it): the revision the member is
                                                        looking at, which the client lands the answer
                                                        against. 409 stale base, 423 locked

The rules (the template gallery router's):
  * THE GATE IS A ROUTER DEPENDENCY: NOTEBOOK_JOURNAL_STYLES_ENABLED off answers the one 404 for
    every route before the session, the plan or the body is read.
  * Every route takes this router's own `require_paid` (402, one sentence). journal_two's
    `POST /api/j2/notes {styleId|kindId}` branch calls THIS module's `_require_enabled` and
    `require_paid` too, so the switch and the plan check have one authority.
  * The body is read inside the dependency chain (`paid_body`), never as a FastAPI body parameter,
    so a malformed body can never answer 422 ahead of the gate.
  * The two `/api/j2/notes/{note_id}/...` routes have one more segment than journal_two's
    `/notes/{note_id}` routes, so they cannot be shadowed (railed against api.main:app in
    tests/test_notebook_journal_styles_router.py).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.journal_two import journal_styles as js
from api.services.journal_two import note_kinds as nk
from api.services.journal_two import notes as notes_service

MAX_BODY_BYTES = 512_000
TOO_LARGE_SENTENCE = "Request too large"
NOT_FOUND = "Not found"
# Integrator ruling (review M1): the base revision is required. Without it a caller that lands the
# answer would record as its own a revision that may fold in another writer's change it never saw.
BASE_REQUIRED_SENTENCE = "Send baseUpdatedAt, the revision of the note you are looking at."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies."""
    if not js.enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(prefix="/api/j2", tags=["journal-2-0", "notebook-journal-styles"],
                   dependencies=[Depends(_require_enabled)])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py reads
    the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Journal styles require a paid plan")
    return user


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
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


def _bad(e: Exception) -> HTTPException:
    if isinstance(e, nk.KindInUse):
        return HTTPException(status_code=409, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


def _found(value: Any) -> Any:
    if value is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return value


def _optional_text(body: dict, key: str) -> str | None:
    value = body.get(key)
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise HTTPException(status_code=400, detail=f"{key} must be text")
    return value


# ── styles ───────────────────────────────────────────────────────────────────────────

@router.get("/journal-styles")
def list_styles_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"kinds": nk.list_kinds(user["id"]), "styles": js.list_styles(user["id"]),
            "blockKinds": [k["id"] for k in js.BLOCK_KINDS]}


@router.post("/journal-styles")
def create_style_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        if body.get("fromNoteId") is not None:
            if not isinstance(body["fromNoteId"], str):
                raise HTTPException(status_code=400, detail="fromNoteId must be text")
            left: list = []
            s = js.create_style_from_note(user["id"], body["fromNoteId"], body.get("name"), body.get("kindId"),
                                          left_out=left)
            # `leftOut` (review M-4, additive): each widget that did not become a block, so the confirmation
            # names it rather than dropping it silently.
            return {"style": _found(s), "leftOut": left}
        return {"style": js.create_style(user["id"], body)}
    except (js.StyleValidationError, nk.KindValidationError) as e:
        raise _bad(e)


@router.post("/journal-styles/preview")
def preview_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return js.preview(user["id"], body)
    except js.StyleNotFound:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except js.StyleValidationError as e:
        raise _bad(e)


@router.get("/journal-styles/{style_id}")
def get_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"style": _found(js.get_style(user["id"], style_id))}


@router.put("/journal-styles/{style_id}")
def update_style_endpoint(style_id: str, body: dict = Depends(paid_body),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"style": _found(js.update_style(user["id"], style_id, body))}
    except js.StyleValidationError as e:
        raise _bad(e)


@router.delete("/journal-styles/{style_id}")
def delete_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"ok": True, "style": _found(js.delete_style(user["id"], style_id))}
    except js.StyleValidationError as e:
        raise _bad(e)


@router.post("/journal-styles/{style_id}/restore")
def restore_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"style": _found(js.restore_style(user["id"], style_id))}
    except js.StyleValidationError as e:
        raise _bad(e)


@router.post("/journal-styles/{style_id}/default")
def default_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"style": _found(js.set_default(user["id"], style_id))}


# ── kinds ────────────────────────────────────────────────────────────────────────────

@router.get("/note-kinds")
def list_kinds_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"kinds": nk.list_kinds(user["id"])}


@router.get("/note-kinds/mapping-offer")
def mapping_offer_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"offer": nk.mapping_offer(user["id"])}


@router.post("/note-kinds/mapping-offer")
def apply_mapping_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    exclude = body.get("excludeNoteIds") or []
    if not isinstance(exclude, list):
        raise HTTPException(status_code=400, detail="excludeNoteIds must be a list")
    skipped: list[dict] = []
    try:
        done = nk.apply_mapping(user["id"], exclude, skipped_out=skipped)
    except nk.KindValidationError as e:
        raise _bad(e)
    return {"notes": done, "count": len(done), "skipped": skipped}


@router.post("/note-kinds")
def create_kind_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"kind": nk.create_kind(user["id"], body.get("name"), body.get("icon"))}
    except nk.KindValidationError as e:
        raise _bad(e)


@router.put("/note-kinds/{kind_id}")
def update_kind_endpoint(kind_id: str, body: dict = Depends(paid_body),
                         user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"kind": _found(nk.update_kind(user["id"], kind_id, name=body.get("name"), icon=body.get("icon"),
                                              sort_order=body.get("sortOrder")))}
    except nk.KindValidationError as e:
        raise _bad(e)


@router.delete("/note-kinds/{kind_id}")
def delete_kind_endpoint(kind_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        done = nk.delete_kind(user["id"], kind_id)
    except nk.KindValidationError as e:
        raise _bad(e)
    if not done:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return {"ok": True, "purgedDeletedStyles": done["purgedDeletedStyles"]}


# ── "Update layout to vN" (Task 10's service, served here) ─────────────────────────────

@router.get("/notes/{note_id}/style-update-plan")
def style_update_plan_endpoint(note_id: str, styleId: str | None = None,
                               user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"plan": js.plan_style_update(user["id"], note_id, style_id=styleId or None)}
    except js.StyleNotFound:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except js.StyleValidationError as e:
        raise _bad(e)


@router.post("/notes/{note_id}/apply-style-update")
def apply_style_update_endpoint(note_id: str, body: dict = Depends(paid_body),
                                user: dict = Depends(require_paid)) -> dict[str, Any]:
    style_id = _optional_text(body, "styleId")
    base = _optional_text(body, "baseUpdatedAt")
    if base is None:
        raise HTTPException(status_code=400, detail=BASE_REQUIRED_SENTENCE)
    try:
        note, plan = js.apply_style_update(user["id"], note_id, style_id=style_id, expected_updated_at=base)
    except js.StyleNotFound:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except js.StyleValidationError as e:
        raise _bad(e)
    except notes_service.NoteConflictError:
        raise HTTPException(status_code=409, detail=js.CONFLICT_SENTENCE)
    except notes_service.NoteLockedError as e:
        raise HTTPException(status_code=423, detail=str(e))
    # The note as journal_two serves every note: an over-deep stored body is withheld, never sent.
    from api.routers.journal_two import _servable_note
    return {"note": _servable_note(note), "plan": plan}
