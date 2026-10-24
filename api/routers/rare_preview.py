"""Admin routes for the rare-pattern preview (api/services/rare_preview.py). ADMIN ONLY, DARK.

Every route answers 404 while AUTO_STRUCTURES_RARE_PREVIEW_ENABLED is off (the surface does not exist), and
403/401 to anyone who is not an admin (require_admin). Nothing here writes a member literal, a registry set,
pattern_detections or the judge's verdicts / exemplars.

    GET  /api/patterns/admin/rare-preview/instances?pattern=   every recorded instance + the release status
    POST /api/patterns/admin/rare-preview/instances/{id}/verdict   {verdict: approve|reject, note?}
    POST /api/patterns/admin/rare-preview/scan                 start one pass over the scan universe now
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/patterns/admin/rare-preview", tags=["patterns"])

#: An instance id is "<pattern_id>|<TICKER>|<start_t>" (rare_preview.instance_id).
_IID_RE = re.compile(r"^draw:[a-z-]{2,32}\|[A-Z0-9.\-]{1,12}\|\d{8}$")


def _gate():
    from api.services import auto_structures
    if not auto_structures.rare_preview_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class VerdictBody(BaseModel):
    verdict: str = Field(..., pattern="^(approve|reject)$")
    note: Optional[str] = Field(None, max_length=2000)


@router.get("/instances")
def rare_preview_instances(pattern: Optional[str] = Query(None, max_length=40),
                           _user=Depends(require_admin)):
    _gate()
    from api.services import auto_structures, rare_preview
    if pattern is not None and pattern not in auto_structures.RARE_PREVIEW_IDS:
        raise HTTPException(status_code=422, detail="unknown pattern")
    return {"instances": rare_preview.list_instances(pattern_id=pattern),
            "release": rare_preview.release_status(),
            "patterns": [{"id": p, "name": auto_structures.RARE_PREVIEW_NAMES[p]}
                         for p in auto_structures.RARE_PREVIEW_IDS],
            "scan": rare_preview.scan_state()}


@router.post("/instances/{iid}/verdict")
def rare_preview_verdict(iid: str, body: VerdictBody, _user=Depends(require_admin)):
    _gate()
    from api.services import rare_preview
    if not _IID_RE.match(iid or ""):
        raise HTTPException(status_code=422, detail="bad instance id")
    note = (body.note or "").strip() or None
    try:
        vid = rare_preview.add_verdict(iid, body.verdict, note=note, by_user=str(_user.get("id") or ""))
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown instance")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True, "verdict_id": vid, "release": rare_preview.release_status()}


@router.post("/scan")
def rare_preview_scan(_user=Depends(require_admin)):
    """Start one pass over the daily scan universe on a background thread (the same pass the nightly universe
    scan runs after it completes). One at a time."""
    _gate()
    from api.services import rare_preview
    from api.main import _load_patterns_universe_ordered
    loaded = _load_patterns_universe_ordered(_log)
    if loaded is None:
        raise HTTPException(status_code=503, detail="scan universe missing")
    started = rare_preview.start_background_pass(loaded[0])
    return {"ok": True, "started": started, "scan": rare_preview.scan_state()}
