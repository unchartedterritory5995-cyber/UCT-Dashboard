"""The ready-made dedicated widgets: `POST /api/j2/notebook-shelf-widgets/{kind}` (Notebook widgets wave 10,
Task 10.12, ruling W10-R4).

The seven kinds (`shelf_kinds.KINDS`: tilt check, revenge-clean, plan vs actual, risk left today, prop-firm
rules, game plan, alerts that fired) refresh ONLY through this door, with `{"params": {...}}` in the body, so a
member's prop-firm limits never appear in a query string or an access log. The phase 1 GET
(`api/routers/notebook_widgets.py`) refuses these kinds, so each kind has exactly one door (W10-R1).

The order, and each step answers before the next runs:
  1. DARK: the kind is not a dedicated kind, or wave 10 is off (`notebook_widgets_wave_on(shelf_kinds.WAVE)`,
     the reader `notebook_widget_definitions._gate_w10` uses, read PER REQUEST): the one `public.not_found()`
     404, the same for both, before the session or the paid check (a router-level dependency runs first).
  2. PAID: this router's own `require_paid`, with its own sentence.
  3. RATE: the phase 1 widget budget itself (`notebook_widgets.WIDGET_RATE` / `SCOPE_WIDGETS` /
     `WIDGET_RATE_SENTENCE`, imported, never retyped), keyed on the member, so a phase 1 read and a dedicated
     refresh spend one budget (⚠️ PER-PROCESS STATE, as there).
  4. BODY: at most `MAX_BODY` bytes (413 `invalid`), a JSON object (400 `invalid`); `params` an object.
  5. `shelf_kinds.clean_params`: a refusal is a `ParamError` answered with ITS `status` and `code` (W9-R14).
  6. `notebook_widgets.build(kind, uid, params)` inline on the request thread, holding one shared
     `run.admit(uid, "run")` permit (the same pool and builder slots as a built widget's run; no second pool).
     `WidgetRequestError` is 400; `run.EngineBusy` / `run.EngineTooLong` are 503 with their sentences.

Errors are `{"detail": {"code", "message"}}` (the 402 and the 404 keep their shared string bodies). EVERY
response carries `Cache-Control: no-store`: the route class adds it to any response or error that lacks it, so
an error raised outside this file (the session's 401) is covered too.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import notebook_widgets as phase1
from api.services.journal_two import notebook_widgets as widgets
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import shelf_kinds, tool_errors
from api.services.journal_two.widget_engine import run as wrun

#: The largest body this door reads (`{"params": {...}}` is a handful of short fields).
MAX_BODY = 8 * 1024

NO_STORE = {"Cache-Control": "no-store"}
S_BODY_TOO_LARGE = "That is too much to send at once."
S_UNREADABLE_BODY = "That request couldn't be read."


class _NoStoreRoute(APIRoute):
    """Every response this router produces, success or error, carries `Cache-Control: no-store` unless it
    already names its own (the shared 404 carries the public headers, which include it)."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def no_store(request: Request):
            try:
                response = await handler(request)
            except HTTPException as e:
                headers = dict(e.headers or {})
                if not any(k.lower() == "cache-control" for k in headers):
                    headers.update(NO_STORE)
                    e.headers = headers
                raise
            if "cache-control" not in response.headers:
                response.headers["Cache-Control"] = NO_STORE["Cache-Control"]
            return response

        return no_store


def _gate(kind: str) -> None:
    """Router-level, so it runs before the session, the paid check and the body: dark is one 404 for all."""
    if kind not in shelf_kinds.KINDS or not widgets.notebook_widgets_wave_on(shelf_kinds.WAVE):
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/notebook-shelf-widgets",
    tags=["journal-2-0", "notebook-widgets"],
    dependencies=[Depends(_gate)],
    route_class=_NoStoreRoute,
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Ready-made widgets require a paid plan", headers=dict(NO_STORE))
    return user


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=dict(NO_STORE))


def _rate(user: dict = Depends(require_paid)) -> dict:
    """One hit on the phase 1 widget budget, keyed on the member (`public.enforce_rate`, phase 1's constants)."""
    try:
        public.enforce_rate(phase1.WIDGET_RATE, phase1.SCOPE_WIDGETS, f"member:{user['id']}",
                            phase1.WIDGET_RATE_SENTENCE, public=False)
    except HTTPException as e:
        raise _err(e.status_code, "rate", str(e.detail))
    return user


async def _body(request: Request) -> dict:
    """The body as a JSON object, at most `MAX_BODY` bytes. With no Content-Length (a chunked body) the stream
    is read only up to `MAX_BODY` + 1 bytes."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            too_big = int(declared) > MAX_BODY
        except ValueError:
            raise _err(400, "invalid", S_UNREADABLE_BODY)
        if too_big:
            raise _err(413, "invalid", S_BODY_TOO_LARGE)
        raw = await request.body()
    else:
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > MAX_BODY:
                break
        raw = bytes(buf)
    if len(raw) > MAX_BODY:
        raise _err(413, "invalid", S_BODY_TOO_LARGE)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    if not isinstance(body, dict):
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    return body


@router.post("/{kind}")
def post_widget(kind: str, user: dict = Depends(_rate), body: dict = Depends(_body)) -> Any:
    raw = body.get("params")
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    uid = str(user["id"])
    try:
        params = shelf_kinds.clean_params(kind, raw)
        with wrun.admit(uid, "run"):
            payload = widgets.build(kind, uid, params)
    except tool_errors.ToolError as e:
        raise _err(e.status, e.code, e.sentence)
    except widgets.WidgetRequestError as e:
        raise _err(400, "invalid", str(e))
    except wrun.EngineBusy as e:
        raise _err(503, "busy", e.sentence)
    except wrun.EngineTooLong as e:
        raise _err(503, "too_long", e.sentence)
    return JSONResponse(content=payload, headers=dict(NO_STORE))
