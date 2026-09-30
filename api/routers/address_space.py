"""TERM-038 — GET /api/address/search and /api/address/resolve (api/services/address_space.py).

DARK behind ADDRESS_SPACE_ENABLED: unset, both routes answer FastAPI's 404 body before
any identity is read -- the same answer as a route that does not exist.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services import address_space

router = APIRouter()


def _armed() -> None:
    if not address_space.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/address/search", dependencies=[Depends(_armed)])
def address_search(q: str = Query(..., min_length=1, max_length=120),
                   user: dict = Depends(get_current_user)):
    return address_space.search(str(user["id"]), q)


@router.get("/api/address/resolve", dependencies=[Depends(_armed)])
def address_resolve(a: str = Query(..., min_length=3, max_length=100),
                    user: dict = Depends(get_current_user)):
    row = address_space.resolve(str(user["id"]), a)
    if row is None:
        raise HTTPException(status_code=404, detail="No such address")
    return row
