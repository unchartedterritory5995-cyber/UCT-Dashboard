"""Notebook widgets wave 10: the seven ready-made "dedicated" kinds, as constants only (Task 10.12, fix round 1).

This module imports nothing but `tool_errors` (itself import-free), so anything may import it without pulling
in the widget engine or the builders: `public_note_payload` (which must stay out of the engine's import
closure) reads `KINDS` here, the two builder modules read `ParamError` here, and `shelf_kinds` re-exports all of
it beside the merged builder tables. One authority for the kind list, and no import cycle.
"""
from __future__ import annotations

from api.services.journal_two import tool_errors

__all__ = ["KINDS", "WAVE", "TITLES", "DESCRIPTIONS", "KEYWORDS", "ParamError"]

#: The release wave whose flag (`NOTEBOOK_WIDGETS_W10_ENABLED`) gates every dedicated kind.
WAVE = 10

#: The seven kinds, in menu order.
KINDS = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan",
         "myAlertsFired")

#: Each kind's member-facing title (Task 10.14). Written ONCE, here: the builder modules' `TITLES` and so
#: `shelf_kinds.TITLES` read these, and `notebook_widgets.KIND_TITLE` (which the client's `WIDGET_KINDS` is railed
#: against) reads them at import without pulling in a builder.
TITLES = {
    "myTiltCheck": "Tilt check",
    "myRevengeClean": "Revenge trades",
    "myPlanVsActual": "Plan vs actual",
    "myRiskLeftToday": "Risk left today",
    "myPropFirm": "Prop-firm rules",
    "myGamePlan": "Pre-market game plan",
    "myAlertsFired": "Alerts that fired",
}

#: Each kind's one-line description in the ready-made widget list (`GET /api/j2/widget-definitions/shelf`'s
#: `dedicated`, Task 10.13, spec section 8). Written ONCE, here; the router reads it and restates none of it.
DESCRIPTIONS = {
    "myTiltCheck": "Trades soon after a loss compared with the rest.",
    "myRevengeClean": "Clean days in the last 30 trading days.",
    "myPlanVsActual": "One trade's plan against its fills.",
    "myRiskLeftToday": "Your daily loss limit against today's P&L and open risk.",
    "myPropFirm": "Room left under your daily loss and max drawdown limits.",
    "myGamePlan": "The wire's read, your names reporting today and your open risk.",
    "myAlertsFired": "Your alerts since the last session.",
}

#: The words a member may search the ready-made list with to find each kind (Task 10.13).
KEYWORDS = {
    "myTiltCheck": ("tilt", "after a loss", "emotional trading", "cooling off"),
    "myRevengeClean": ("revenge trading", "clean days", "discipline", "overtrading"),
    "myPlanVsActual": ("trade review", "execution", "fills", "slippage"),
    "myRiskLeftToday": ("daily loss limit", "max loss", "risk", "open risk"),
    "myPropFirm": ("prop firm", "funded account", "trailing drawdown", "daily loss limit"),
    "myGamePlan": ("pre-market", "morning", "earnings today", "watchlist"),
    "myAlertsFired": ("alerts", "notifications", "triggered", "fired"),
}


class ParamError(tool_errors.ToolError):
    """A refused widget setting. Its message is a member sentence (`.sentence`); the router answers
    `{"detail": {"code": e.code, "message": e.sentence}}` with `e.status` and never matches the words (W9-R14)."""
    status = 400
    code = "invalid"
