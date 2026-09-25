"""Wave 7 lane H (H2) — `POST /api/j2/notes/{note_id}/writing-help/stream`.

Editor writing help, streamed as SSE. The service (and every rule about the
prompt, the budget and the gate) is `api/services/journal_two/writing_help.py`;
this file is the door.

⛔ DARK: `NOTEBOOK_WRITING_HELP_ENABLED` unset means every route here answers
404 with FastAPI's own unknown-route body, BEFORE any credential is read --
router-level, the same shape as the personal API's gate. Read per request.

⛔ NOT MOUNTED BY THIS FILE. The controller adds, in `api/main.py`:
  * `app.include_router(notebook_writing_help.router)`;
  * this path to `_is_gzip_exempt` -- GZip buffers the whole body, so a
    streamed draft would never flush (rail `tests/api/test_sse_gzip_exempt.py`
    derives SSE routes from the app and will name it the moment it is mounted).

SSE events, in order:
  start -> {action, model, scope, instruction}
  delta -> {text}                     (repeated)
  final -> {text, action, model}
  error -> {detail}                   (the member-facing sentence)

⛔ The server never writes the note. The editor inserts the text the member
ACCEPTS, as one `askInsert` block; a discarded draft was never in the note.
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import note_ask
from api.services.journal_two import notes as notes_service
from api.services.journal_two import writing_help as wh

import logging

logger = logging.getLogger(__name__)

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off
    gate reads no credential and looks like no route at all."""
    if not wh.writing_help_enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2",
    tags=["journal-2-0", "writing-help"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py) -- an LLM call on the firm's key."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Writing help requires a paid plan")
    return user


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/notes/{note_id}/writing-help/stream")
async def writing_help_stream(
    note_id: str,
    payload: dict[str, Any] | None = None,
    user: dict = Depends(require_paid),
):
    user_id = user["id"]
    try:
        req = wh.parse_request(payload or {})
    except wh.WritingHelpRequestError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # ⛔ 404 FOR A NOTE THE MEMBER DOES NOT OWN, without saying why: another
    # member's note is indistinguishable from one that does not exist.
    # Off the event loop: this is a sync SQLite read inside an `async def`
    # route, and the web pod has ONE loop for every member (review M-3).
    if await run_in_threadpool(notes_service.get_note, user_id, note_id) is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not note_ask.reserve_writing_help(user_id):
        # Say WHICH limit refused (review M-2): the shared dollar cap is not
        # the member's own 60, and they may have used none of it.
        raise HTTPException(status_code=429, detail=(
            wh.SHARED_CAP_SENTENCE if note_ask.shared_cap_reached() else wh.BUDGET_SENTENCE))
    # Claimed AFTER the reservation so the failure path has one thing to undo.
    # ⛔ The SAME slots as Ask (ruling D-H2): one member's open drafts and open
    # answers share the two a member may hold at once.
    if not note_ask.begin_stream(user_id):
        note_ask.refund_writing_help(user_id)
        raise HTTPException(status_code=429, detail=wh.BUSY_SENTENCE)

    model = wh.model_name()
    kwargs = wh.request_kwargs(req, model=model)
    head = {"type": "start", "action": req["action"], "model": model,
            "scope": req["scope"], "instruction": wh.instruction(req)}
    t0 = time.time()
    # ⛔ CHARGED FROM THE FIRST DELTA (review I-3, rule `note_ask.refund_due`):
    # an abort after the member has text in hand keeps the charge; only a
    # server failure or a stream that sent nothing refunds.
    charge = note_ask.StreamCharge(user_id, note_ask.refund_writing_help)

    async def gen():
        settled = False
        text = ""
        try:
            # INSIDE the try (review M-3): a disconnect at this very first
            # chunk still reaches `finally`, so the slot is released and the
            # untouched reservation refunded.
            yield _sse(head)
            async for delta in wh.stream_text(kwargs):
                if not delta:
                    continue
                text += delta
                if delta.strip():
                    # Set BEFORE the yield (an abort at it still counts), and
                    # only for VISIBLE text: whitespace is not a draft in hand.
                    charge.sent = True
                yield _sse({"type": "delta", "text": delta})
            settled = True
        except Exception:
            # ⛔ NO PASSAGE OR OUTPUT TEXT IN THE LOG -- the action is enough.
            charge.failed = True
            logger.exception(f"[writing-help] synthesis failed action={req['action']}")
            yield _sse({"type": "error", "detail": wh.FAILED_SENTENCE})
        finally:
            # RELEASE FIRST, AND ALWAYS: a disconnect, an exception and a
            # cancellation all land here; a leaked slot locks the member out
            # until the process restarts. Synchronous on purpose: under
            # anyio's level-triggered cancellation an `await` in this finally
            # would be cancelled again and skip what follows it.
            charge.close()
            notes_service._log_notebook_event(
                user_id, "notebook_writing_help_used",
                wh.telemetry(req, started=t0, settled=settled, produced=bool(text.strip())))
        if settled:
            yield _sse({"type": "final", "text": text, "action": req["action"], "model": model})

    # The background task is the second door to `charge.close()`: Starlette can
    # cancel a response before this generator ever starts, and a generator that
    # never ran has no `finally`. Idempotent -- a finished stream closed already.
    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        background=BackgroundTask(charge.close))
