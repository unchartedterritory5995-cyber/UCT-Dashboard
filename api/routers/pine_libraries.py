"""Pine library store - the read door the chart's Pine translators fetch from.

`GET /api/pine/libraries/{author}/{name}/{version}` answers one library version:
its published source and, beside it, the licence and attribution the member is
shown. `GET /api/pine/libraries` lists what the store holds (metadata only).

The client fetches a library only when a script it is translating says
`import Author/Library/Version` (`app/src/components/chart/builder/usePineLibraries.js`);
the store is `api/services/pine_library_store.py` (a data directory, never git).

Signed-in members only. A version the store does not hold is a 404, never a
neighbouring version: the translators refuse that import line by name. A version
it holds but the promotion allowlist does not promote at that code is a 409
`library:denied` (`pine_library_store.entry_status`).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user
from api.services import pine_library_store as store

router = APIRouter(prefix="/api/pine/libraries", tags=["pine-libraries"])


@router.get("")
def list_libraries(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {"libraries": store.list_entries()}


@router.get("/{author}/{name}/{version}")
def get_library(author: str, name: str, version: str,
                user: dict = Depends(get_current_user)) -> dict[str, Any]:
    path = "%s/%s/%s" % (author, name, version)
    if not store.parse_import_path(path):
        raise HTTPException(status_code=400, detail="not an Author/Library/Version import path")
    status, entry = store.entry_status(path)
    if status == "denied":
        # ⭐⭐ U15 -- on the deny list: never served, whatever the store holds, by name
        raise HTTPException(status_code=409, detail={
            "code": store.DENIED, "reason": "the library %s is not served: %s" % (path, "; ".join(entry))})
    if status in (store.HELD, store.UNPROMOTED):
        # ⭐⭐ (fail closed, 2026-11-17) -- held out, or on no `promote` row of the allowlist (or held
        # under other code than the row pins): never served, by name, as the deny list answers. The
        # reason is the member's sentence alone: the client says "the library X is not served: " first.
        raise HTTPException(status_code=409, detail={"code": store.DENIED, "reason": "; ".join(entry)})
    if status == "licence":
        # ⭐⭐ U15 -- a non-commercial licence is never served on this paid product, by name
        raise HTTPException(status_code=409, detail={
            "code": store.NON_COMMERCIAL, "reason": "the library %s is not served: %s" % (path, "; ".join(entry))})
    if status == "unservable":
        # ⭐ U15 -- held, not served (no verified sha256): the import line names the reason
        raise HTTPException(status_code=409, detail={
            "code": store.NO_SHA, "reason": "the library store holds %s but does not serve it (%s)" % (
                path, "; ".join(entry))})
    if status != "ok":
        raise HTTPException(status_code=404, detail="the library %s is not in the library store" % path)
    out = store.public_metadata(entry)
    out["source"] = entry["source"]
    return out
