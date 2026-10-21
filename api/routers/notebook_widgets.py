"""Notebook widgets route.

The service is `api/services/journal_two/notebook_widgets.py`.

  member  GET  /api/j2/notebook-widgets/{kind}   paid  one widget's payload

The rules:
  * DARK PER WAVE: a kind whose wave flag (`NOTEBOOK_WIDGETS_W<n>_ENABLED`) is off answers
    the same 404 as a kind that does not exist, so a gate-off kind is indistinguishable
    from none. The flag is read PER REQUEST (never captured at import).
  * PAID: this router's own `require_paid`.
  * RATE (final review I-4): 60/minute per member, scope `notebook-widgets`, in `api/limiter.py`'s
    in-memory storage (⚠️ PER-PROCESS STATE: a second web process doubles it). Counted after the wave
    gate, so a dark kind is still the one 404. Over it: 429 with one sentence.
  * 400 carries the `WidgetRequestError` text; 200 is `Cache-Control: no-store`.
  * A sync `def` endpoint runs in the threadpool, which is where the builders' blocking
    reads belong (the same shape as the sibling Notebook routers).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import notebook_widgets as widgets
from api.services.journal_two import public_note_payload as public

router = APIRouter(
    prefix="/api/j2/notebook-widgets",
    tags=["journal-2-0", "notebook-widgets"],
)

#: The query params that pass through to the builder's `params`, when present (the service owns the list).
PASS_PARAMS = widgets.SETTING_KEYS

#: Final review I-4: every widget read fans out to vendors (a chip tap reads a ticker card), so a member's
#: reads are bounded per minute.
WIDGET_RATE = "60/minute"
SCOPE_WIDGETS = "notebook-widgets"
WIDGET_RATE_SENTENCE = "You've loaded a lot of widgets in a minute. Try again shortly."


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Notebook widgets require a paid plan")
    return user


@router.get("/{kind}")
def get_widget(kind: str, request: Request, user: dict = Depends(require_paid)) -> Any:
    wave = widgets.KIND_WAVE.get(kind)
    if wave is None or not widgets.notebook_widgets_wave_on(wave):
        raise public.not_found()
    public.enforce_rate(WIDGET_RATE, SCOPE_WIDGETS, f"member:{user['id']}", WIDGET_RATE_SENTENCE, public=False)
    params = {k: request.query_params[k] for k in PASS_PARAMS if k in request.query_params}
    try:
        payload = widgets.build(kind, str(user["id"]), params)
    except widgets.WidgetRequestError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})
