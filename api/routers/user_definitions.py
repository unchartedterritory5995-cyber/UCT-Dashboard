"""USER-AUTHORED INDICATOR DEFINITIONS — the network edge of the append-only store.

  GET    /api/user-definitions            → every live definition (newest version)
  POST   /api/user-definitions            → create; the server mints the `u_<12 hex>` id
  POST   /api/user-definitions/propose    → English in, a canonical tree out (the concierge)
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


class ProposeIn(BaseModel):
    """The English, and the bars the chart is already holding.

    The bars come from the CLIENT because the chart already has them and the
    concierge's compute stage has to run on the same window the user is looking
    at — a formula that computes nothing on the bars in view is refused there.
    """

    prompt: str
    bars: Optional[list] = None


#: A body cap, because an unbounded array is an unbounded request. The chart caps
#: at 5,000 bars on every timeframe (`/api/bars` and `StockChart` both), so this
#: is that number rather than a new one.
MAX_PROPOSE_BARS = 5000


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


@router.post("/propose")
def propose_definition(body: ProposeIn, user: dict = Depends(require_paid)):
    """THE AI DOOR. English in, a canonical tree out — or a refusal.

    ⛔ IT STORES NOTHING. A proposal is a suggestion the user has not confirmed;
    persisting it would make an unconfirmed, model-authored formula a definition
    the alert lane could bind to. The client shows the read-back, the user
    accepts, and the ordinary `POST ""` / `PUT /{def_id}` doors do the writing —
    through the same validation everything else goes through.

    ⛔ AND A REFUSAL IS A 200 WITH `ok: False`, NOT A 4xx. That is
    `brain_service`'s shape and this is the same kind of answer: "I could not turn
    that into a formula" is a legitimate reply, not a transport failure, and the
    caller renders `reason` next to the box the user typed in. `gate` names the
    door that decided so a support question has an answer.

    ⚠️ DECLARED PER HANDLER, like every other route on this router. See the module
    docstring: `main.py` mounts this router with no router-level dependency, so a
    route that omits its own is reachable by anybody.
    """
    bars = body.bars or []
    if not isinstance(bars, list) or len(bars) > MAX_PROPOSE_BARS:
        raise HTTPException(
            status_code=400,
            detail=f"bars: at most {MAX_PROPOSE_BARS} bars, got "
                   f"{len(bars) if isinstance(bars, list) else type(bars).__name__}")
    from api.services import definition_concierge
    return definition_concierge.propose(body.prompt, user_id=user["id"], bars=bars)


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
    """An EDIT. A maths change bumps `rev` and force-migrates every binding.

    ⭐ AND AS OF THIS COMMIT IT HAS A PRODUCT CALLER. `BuilderSheet` opens a saved
    formula, and its Save button routes here through the SAME document builder,
    the SAME `validateUserDefinitions` door and the SAME `installUserDefinitions`
    that a create goes through — one write path, not two. Until now this route
    existed in shape only, which is why `compute.rev` in every stored blob had
    stayed `1` since Phase D shipped: nothing in the product could move it.

    ⛔ AN EDIT REQUIRES SOMETHING TO EDIT — 404, NOT AN UPSERT. `save()` is happy
    to append version 1 at any id in the caller's own namespace, so this route
    used to let a client CHOOSE its definition ids by PUTting one that did not
    exist. That is exactly the property `create_definition` refuses ("THE SERVER
    MINTS THE ID"), arriving one route over, and it makes a typo'd id a silent
    second definition rather than a 404. `history()` is read rather than `get()`
    so a RESURRECT still works: a tombstoned definition has versions, and saving
    over it is an edit that brings it back.
    """
    try:
        exists = bool(svc.history(user["id"], def_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not exists:
        raise HTTPException(status_code=404, detail="Not found")
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
