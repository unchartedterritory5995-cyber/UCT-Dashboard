"""USER-AUTHORED INDICATOR DEFINITIONS — the network edge of the append-only store.

  GET    /api/user-definitions            → every live definition (newest version)
  POST   /api/user-definitions            → create; the server mints the `u_<12 hex>` id
  GET    /api/user-definitions/{def_id}   → one definition; `?version=N` serves a PIN
  PUT    /api/user-definitions/{def_id}   → save an edit (appends a version)
  DELETE /api/user-definitions/{def_id}   → soft delete (appends a tombstone version)

⛔ `require_paid` IS DECLARED PER HANDLER, NOT ON THE ROUTER — and the shape is
copied from `api/routers/signature.py:174`, which defines its own and repeats it
on every route. `main.py` calls `include_router` without a router-level
dependency, so a route that omits its own is reachable by anybody.

⛔ AND THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED.
Phase C Task 13 MEASURED the failure this prevents: the shipped test hand-listed
THREE paths while the router had FIVE, so two paid-gated endpoints rode with no
auth coverage at all and deleting a `Depends(require_paid)` passed every test.
`tests/test_user_definitions.py` reads the route table, asserts the count so a
router that stopped mounting cannot pass by iterating zero times, and checks the
gate both structurally (dependency identity) and behaviourally (a free user gets
402 on every route).

⚠️ EVERYTHING HERE IS PAID (owner ruling). There is no free read: a definition
list is user content on a premium surface, and a "just the list" exemption is the
sixth route that rides in uncovered.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import user_definitions as svc

router = APIRouter(prefix="/api/user-definitions", tags=["user-definitions"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(
            status_code=402,
            detail="Custom indicators require a paid plan",
        )
    return user


class DefinitionIn(BaseModel):
    definition: dict


def _save_or_400(user_id, def_id: str, definition: dict) -> dict:
    """Every store refusal is a 400 that carries the store's own sentence.

    ⛔ THE MESSAGE IS NOT REWRITTEN HERE. The caps live in one place and their
    wording names the number that was exceeded; a router-local paraphrase is a
    second vocabulary for the same refusal.
    """
    try:
        return svc.save(user_id, def_id, definition)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
def list_definitions(user: dict = Depends(require_paid)):
    return {"definitions": svc.list_for_user(user["id"])}


@router.post("")
def create_definition(body: DefinitionIn, user: dict = Depends(require_paid)):
    """Create. THE SERVER MINTS THE ID.

    A client-supplied id would let one member write into another's namespace by
    guessing, and it would let a definition claim a native id (`rsi`) whose
    bindings a rev bump would then force-migrate.
    """
    def_id = svc.new_def_id()
    definition = dict(body.definition or {})
    definition["id"] = def_id
    return _save_or_400(user["id"], def_id, definition)


@router.get("/{def_id}")
def get_definition(def_id: str,
                   version: Optional[int] = Query(None, ge=1),
                   user: dict = Depends(require_paid)):
    try:
        row = svc.get(user["id"], def_id, version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.put("/{def_id}")
def save_definition(def_id: str, body: DefinitionIn,
                    user: dict = Depends(require_paid)):
    """An EDIT. A maths change bumps `rev` and force-migrates every binding."""
    definition = dict(body.definition or {})
    definition["id"] = def_id
    return _save_or_400(user["id"], def_id, definition)


@router.delete("/{def_id}")
def delete_definition(def_id: str, user: dict = Depends(require_paid)):
    try:
        removed = svc.soft_delete(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "def_id": def_id}
