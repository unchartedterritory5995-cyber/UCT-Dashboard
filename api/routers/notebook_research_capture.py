"""Research capture routes (wave 13, lane 13G-1).

Two capabilities, two routers in one module (both always on: their flags were retired 2026-11-04):

  transcript capture
    GET   /api/j2/research-capture/transcripts/{symbol}/quarters     quarters UCT holds
    GET   /api/j2/research-capture/transcripts/{symbol}/{quarter}    that call, as turns
    POST  /api/j2/research-capture/transcripts/save                  a passage -> a cited excerpt

  passed setups
    GET     /api/j2/research-capture/passed-setups          refresh (idempotent) + list
    POST    /api/j2/research-capture/passed-setups          add a name by hand
    DELETE  /api/j2/research-capture/passed-setups/{id}     remove one from the list

The rules (the template gallery's, `notebook_template_gallery.py`, and 13C's):
  * PAID, on every route (transcripts are paid data on the Calendar; bars likewise).
  * Services: `journal_two/transcript_capture.py`, `journal_two/passed_setups.py`. Zero model
    calls; transcripts are read only from what UCT already holds, never AlphaVantage.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.journal_two import passed_setups as ps
from api.services.journal_two import transcript_capture as tc


transcripts_router = APIRouter(
    prefix="/api/j2/research-capture/transcripts",
    tags=["journal-2-0", "notebook-research-capture"],
)

passed_router = APIRouter(
    prefix="/api/j2/research-capture/passed-setups",
    tags=["journal-2-0", "notebook-research-capture"],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router module, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Research capture requires a paid plan")
    return user


# ⛔ FIN (2026-10-06, security review I-5): neither body is a declared parameter.
# FastAPI reads a declared body before it solves any dependency, so with the flag
# off these doors answered 422 to malformed JSON (every other request: 404) and
# buffered an anonymous body of any size. `_json` reads it capped, after the
# router's gate and after the plan check. Rail: tests/test_notebook_body_census.py.
# The largest body is a saved passage and its annotation, each at most one
# transcript turn (`tc.MAX_TURN_CHARS` characters, at most 4 bytes each).
TOO_LARGE_SENTENCE = "Request too large"


def _body_max() -> int:
    return 8 * tc.MAX_TURN_CHARS + 16 * 1024


def _json(annotation):
    return body_cap.capped_json(annotation, _body_max, lambda: TOO_LARGE_SENTENCE, after=require_paid)


def _fail(e: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(e, "status", 400), detail=str(e))


# ── transcripts ──────────────────────────────────────────────────────────────

@transcripts_router.post("/save")
def save_passage(payload: dict[str, Any] = Depends(_json(dict[str, Any])), user: dict = Depends(require_paid)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    try:
        return tc.save_passage(
            str(user["id"]), payload.get("noteId"),
            symbol=payload.get("symbol"), quarter=payload.get("quarter"),
            turn=payload.get("turn"), passage=payload.get("passage"),
            annotation=payload.get("annotation"))
    except tc.TranscriptCaptureError as e:
        raise _fail(e) from e


@transcripts_router.get("/{symbol}/quarters")
def list_quarters(symbol: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        sym = tc.clean_symbol(symbol)
        return {"symbol": sym, "quarters": tc.quarters(sym), "source": tc.SOURCE_LABEL}
    except tc.TranscriptCaptureError as e:
        raise _fail(e) from e


@transcripts_router.get("/{symbol}/{quarter}")
def read_transcript(symbol: str, quarter: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        t = tc.read_transcript(symbol, quarter)
    except tc.TranscriptCaptureError as e:
        raise _fail(e) from e
    if t is None:
        raise HTTPException(status_code=404, detail=(
            "UCT does not hold that transcript yet. Open it in the UCT Terminal's transcript "
            "panel first, then save from it here."))
    return t


# ── passed setups ────────────────────────────────────────────────────────────

@passed_router.get("")
def list_passed(background_tasks: BackgroundTasks, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """A PLAIN READ (security review I-3). This used to run `ps.refresh` first: collect, then a
    write for each open row, before answering -- a list view that could hold auth.db's write
    lock. The refresh is now queued for AFTER the response, at most once per member per
    `REFRESH_MIN_INTERVAL_S`, and commits row by row. `refreshQueued` tells the client a
    fresher list is on its way, so it can read once more."""
    uid = str(user["id"])
    queued = ps.claim_refresh(uid)
    if queued:
        background_tasks.add_task(ps.run_claimed_refresh, uid)
    return {**ps.list_items(uid), "refreshQueued": queued}


@passed_router.post("")
def add_passed(payload: dict[str, Any] = Depends(_json(dict[str, Any])), user: dict = Depends(require_paid)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    try:
        return ps.add_manual(str(user["id"]), payload.get("symbol"), payload.get("savedOn"))
    except ps.PassedSetupError as e:
        raise _fail(e) from e


@passed_router.delete("/{item_id}")
def remove_passed(item_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    if not ps.dismiss(str(user["id"]), item_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}
