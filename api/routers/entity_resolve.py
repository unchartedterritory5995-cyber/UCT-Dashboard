"""TERM-023 (FB-S3-01) -- `GET /api/entity/resolve`, the Entity Master's member door.

A ticker is ambiguous user input; an entity is not. This route turns a ticker
(and optionally a date) into the entity the store holds for it, keyed by
`entityId`, with the entity's dated alias history -- so a ticker that changed
hands resolves to the right company for the right date.

⛔ DARK behind `ENTITY_MASTER_MEMBER_ENABLED` (read per request, unset = OFF).
Unset, the route answers the FastAPI 404 body to EVERY caller, admin included,
before any identity is read -- the same answer as a route that does not exist
-- and `entity_master.db` is never opened. `_armed` is the first dependency on
purpose.

⛔ PAID. `require_paid` is defined HERE with its own 402 sentence
(`tests/test_user_definitions_auth.py` walks `api/routers/` and fails on a
shared import).

Service: `api/services/entity_master/member_resolve.py`. Rails:
`tests/test_entity_master_member_path.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.entity_master import member_resolve

router = APIRouter(prefix="/api/entity", tags=["entity-master-member"])


def _armed() -> None:
    if not member_resolve.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for Entity Master resolution."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Entity resolution requires a paid plan")
    return user


@router.get("/resolve", dependencies=[Depends(_armed)])
def resolve_entity(
    q: str = Query(..., min_length=1, max_length=32),
    as_of: str | None = Query(None, max_length=10),
    _user: dict = Depends(require_paid),
):
    """`{query, asOf, status, entityId, entity, aliases, candidates}`.

    `status` is `resolved` | `not_found` | `ambiguous`. Only `resolved` carries
    an `entityId`; `ambiguous` names every candidate and keys to no one.
    `as_of` (YYYY-MM-DD) asks "who held this ticker on that date"; omitted means
    now. A malformed date is 422, never read as "now"."""
    try:
        when = member_resolve.parse_as_of(as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not member_resolve.normalize_query(q):
        raise HTTPException(status_code=422, detail="q is blank")
    return member_resolve.resolve_for_member(q, when)
