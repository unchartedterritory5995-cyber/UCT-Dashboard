"""Notebook widgets wave 10: the seven ready-made "dedicated" kinds, as constants only (Task 10.12, fix round 1).

This module imports nothing but `tool_errors` (itself import-free), so anything may import it without pulling
in the widget engine or the builders: `public_note_payload` (which must stay out of the engine's import
closure) reads `KINDS` here, the two builder modules read `ParamError` here, and `shelf_kinds` re-exports all of
it beside the merged builder tables. One authority for the kind list, and no import cycle.
"""
from __future__ import annotations

from api.services.journal_two import tool_errors

__all__ = ["KINDS", "WAVE", "ParamError"]

#: The release wave whose flag (`NOTEBOOK_WIDGETS_W10_ENABLED`) gates every dedicated kind.
WAVE = 10

#: The seven kinds, in menu order.
KINDS = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan",
         "myAlertsFired")


class ParamError(tool_errors.ToolError):
    """A refused widget setting. Its message is a member sentence (`.sentence`); the router answers
    `{"detail": {"code": e.code, "message": e.sentence}}` with `e.status` and never matches the words (W9-R14)."""
    status = 400
    code = "invalid"
