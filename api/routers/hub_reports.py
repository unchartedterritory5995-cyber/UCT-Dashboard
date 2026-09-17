"""api/routers/hub_reports.py — the joystick hub's one-tap owner report. W2 / owner ruling R2.

Routes (read the router, not this list):
    POST /api/hub/reports   → file one report        — ADMIN
    GET  /api/hub/reports   → newest reports first   — ADMIN

⛔⛔ ADMIN ON BOTH VERBS. The hub is admin-preview surface at stage 1, and this endpoint carries a
gesture trace and device details. A member gets 403 and an anonymous request gets 401 — all three
answers are railed in `tests/test_hub_reports.py`, because "the happy path works" says nothing about
who else it works for.

⭐ VALIDATION IS AN ALLOW-LIST, IN THE STYLE THAT CLOSED BOX 4. `POST /api/auth/preferences` refuses
an unknown KEY by name while accepting unknown FIELDS inside a known key, and the reason transfers
exactly: an older bundle on somebody's phone will send a payload shaped like the build it came from,
and refusing it would turn a stale tab into a permanent 400 on the one action this whole workstream
exists to make frictionless. So: the top-level key set is closed and named; the interiors are not.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import require_admin
from api.services import hub_reports

router = APIRouter(prefix="/api/hub", tags=["hub-reports"])

# ⛔ CLOSED AND NAMED. A key outside this set is refused BY NAME so a client author reads what was
# wrong rather than guessing. Adding one here is a deliberate, reviewable edit.
ALLOWED_KEYS = frozenset({
    "note",        # the owner's one line, optional — the only human-written field
    "trace",       # gestureTrace.js's existing payload shape, verbatim
    "device",      # viewport, dpr, userAgent
    "visibility",  # the PRESENT-IS-NOT-SHOWING triple: hidden attr, computed display, box
    "page",        # route the report was filed from
    "mode",        # the hub mode under the thumb, or null
    "stage",       # ROLLOUT_STAGE at capture time
    "flags",       # HUB_VISUAL_V2 / HUB_SURFACE — which variant produced this report (W4/W5)
    "clientTime",  # the device's own clock, so a skew against created_at is visible
})

NOTE_MAX = 280
PAYLOAD_MAX_BYTES = 512 * 1024


class ReportIn(BaseModel):
    # Deliberately permissive at the pydantic layer; the allow-list below is the real gate, so that
    # a refusal names the offending key instead of surfacing a schema dump.
    model_config = {"extra": "allow"}


@router.post("/reports")
def file_report(payload: ReportIn, admin: dict = Depends(require_admin)) -> dict[str, Any]:
    body: dict[str, Any] = payload.model_dump()

    unknown = sorted(set(body) - ALLOWED_KEYS)
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"unknown key(s) for a hub report: {', '.join(unknown)}. "
                   f"Accepted: {', '.join(sorted(ALLOWED_KEYS))}",
        )

    note = body.get("note")
    if note is not None:
        if not isinstance(note, str):
            raise HTTPException(status_code=400, detail="note must be a string or null")
        note = note.strip()
        if len(note) > NOTE_MAX:
            raise HTTPException(status_code=400, detail=f"note is longer than {NOTE_MAX} characters")
        # ⭐ An EMPTY note is stored as null, not "". A one-tap report with no note is the designed
        # case — "this, here, now" — and `''` vs `None` reading differently downstream is exactly
        # `lesson_chosen_with_nullish_consumed_with_truthiness`.
        note = note or None
        body["note"] = note

    encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
    if len(encoded) > PAYLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"report payload is {len(encoded)} bytes, over the {PAYLOAD_MAX_BYTES} limit. "
                   "The trace ring is capped; a payload this size means something else grew.",
        )

    report_id = hub_reports.add_report(
        user_id=str(admin.get("id") or admin.get("user_id") or ""),
        user_email=admin.get("email"),
        note=note,
        payload=body,
    )
    return {"ok": True, "id": report_id}


@router.get("/reports")
def read_reports(limit: int = 200, since: int | None = None,
                 _admin: dict = Depends(require_admin)) -> dict[str, Any]:
    reports = hub_reports.list_reports(limit=limit, since=since)
    return {"ok": True, "count": len(reports), "total": hub_reports.count_reports(),
            "reports": reports}
