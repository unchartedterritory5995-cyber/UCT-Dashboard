"""The CLIENT half of indicator-journey telemetry.

Only `import_submitted` and `compile_finished` are ever fired from here —
see `api/services/indicator_telemetry.py::CLIENT_FIREABLE_EVENTS` for why the
other three events (`import_accepted`, `delivery_configured`,
`execution_finished`) are refused at this door: they are the record of a
SERVER decision (validated, saved, delivered, executed) and a client must
never be able to assert one of those about its own unconfirmed input.

⛔ AUTHENTICATED, UNLIKE `landing_analytics.py`. That router is deliberately
open (anonymous marketing visitors have no session); this one is not — the
indicator/screener surface is a signed-in feature, and an open write endpoint
here would let anybody post events under an arbitrary `visitor_id`, corrupting
another member's journey data. `get_current_user` (not `require_paid`): a
free member can still attempt an import and hit the paid wall at save time,
and knowing that this happens is itself a real product signal.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from api.middleware.auth_middleware import get_current_user
from api.services import indicator_telemetry as telemetry

router = APIRouter(prefix="/api/indicator-telemetry", tags=["indicator-telemetry"])


class EventBody(BaseModel):
    event: str = Field(..., min_length=1, max_length=64)
    import_id: str = Field(..., min_length=1, max_length=64)
    dialect: Optional[str] = Field(default=None, max_length=32)
    # ⛔⛔ 2026-09-04: NEVER the source text itself, and NEVER shape-only by
    # length alone — see indicator_telemetry.py's module docstring. `props`
    # is checked against that module's OWN `EVENT_SCHEMAS` (the same table
    # `log_event` enforces server-side): an unknown key, a wrong type, a
    # nested list/dict, or an over-length string is REJECTED (422) here
    # rather than silently stored. One allowlist, not two — see
    # `_props_must_be_allowed_for_this_event` below.
    props: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def _props_must_be_allowed_for_this_event(self) -> "EventBody":
        for key, value in (self.props or {}).items():
            reason = telemetry._prop_violation(self.event, key, value)
            if reason is not None:
                raise ValueError(f"props rejected: {reason}")
        return self


@router.post("/event")
def track_event(body: EventBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if body.event not in telemetry.CLIENT_FIREABLE_EVENTS:
        raise HTTPException(status_code=400, detail="event not client-fireable")
    logged = telemetry.log_event(
        user["id"], body.event,
        import_id=body.import_id, dialect=body.dialect,
        **(body.props or {}),
    )
    return {"ok": True, "logged": logged}
