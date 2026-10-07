"""Wave 11 lane 11A -- voice and meeting notes. The door; the rules live in
`api/services/journal_two/voice_notes.py`.

    GET    /api/j2/voice-notes/status                         limits + this month's minutes
    POST   /api/j2/voice-notes/jobs                           multipart `audio` (+ `source`)
    POST   /api/j2/voice-notes/jobs/{job_id}/transcribe       the NEXT part, in order (also the retry)
    POST   /api/j2/voice-notes/jobs/{job_id}/summarize        one Anthropic call, validated
    DELETE /api/j2/voice-notes/jobs/{job_id}                  discard the audio and the transcript
    GET    /api/j2/voice-notes/desk-sessions                  Desk sessions that carry a transcript
    POST   /api/j2/voice-notes/desk-sessions/{video_id}/summarize

⛔ DARK: `NOTEBOOK_VOICE_NOTES_ENABLED` unset means every route here answers
404 with FastAPI's own unknown-route body, BEFORE any credential is read --
router-level, the shape writing help's gate has.

⛔ PAID ONLY, for two reasons that agree: transcription spends the voice
allowance (`requires_voice_access` is paid-or-trial), and Desk transcripts are
paid content (`/api/education/videos/{id}/transcript` is `require_paid`). A
free member reads the same 402 on every route, including the Desk list.

⛔ THE SERVER NEVER WRITES A NOTE. Every route answers data; the member previews
it and saves it through the canonical create door (`createNoteViaApi`) or, for
the note already open, as an editor transaction.
"""
from __future__ import annotations

import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import note_ask
from api.services import request_body_cap as body_cap
from api.services.journal_two import voice_notes as vn

import logging

logger = logging.getLogger(__name__)

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body


def _require_enabled() -> None:
    """Router-level: an off gate reads no credential and looks like no route."""
    if not vn.enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2/voice-notes",
    tags=["journal-2-0", "voice-notes"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        # A LITERAL, read by the per-router census (tests/test_user_definitions_auth.py);
        # tests/test_notebook_voice_notes.py pins it equal to `vn.PAID_SENTENCE`.
        raise HTTPException(status_code=402, detail="Voice notes are part of a paid plan.")
    return user


def _refuse(e: vn.VoiceNoteError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.sentence)


@router.get("/status")
def status(user: dict = Depends(require_paid)) -> dict[str, Any]:
    cap = vn.cap_state(user)
    return {"limits": vn.limits(), "cap": cap,
            "summariesLeft": max(0, note_ask.voice_note_peruser_cap() - note_ask.voice_note_used(user["id"]))}


async def _read_audio(request: Request, _user: dict = Depends(require_paid)) -> AsyncIterator[tuple[Any, str]]:
    """The multipart body, read INSIDE the dependency chain (writing help's M-1
    lesson): the gate (router level) and the paid check run first, so an off
    gate or a free member never makes this process spool an upload.

    ⛔ CAPPED WHILE IT IS READ (wave 14, census row :264). It used to check only
    the DECLARED length, so a chunked upload or one with no Content-Length was
    spooled to a temp file IN FULL before the service's 90 MiB read cap ever
    ran. `request_body_cap` counts every byte as it arrives and stops at the cap
    plus multipart framing; the file part's own size is then held to
    `vn.MAX_UPLOAD_BYTES` exactly, read per request. Past either: 413, and every
    spooled part is already closed."""
    limit = vn.MAX_UPLOAD_BYTES
    try:
        form = await body_cap.read_capped_form(request, limit + body_cap.FRAMING_SLACK,
                                               vn.TOO_BIG_SENTENCE, max_files=1, max_fields=4)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 -- a body that is not multipart is the member's empty upload
        raise HTTPException(status_code=400, detail=vn.EMPTY_AUDIO_SENTENCE) from None
    try:
        audio = form.get("audio")
        if audio is None or isinstance(audio, str):
            raise HTTPException(status_code=400, detail=vn.EMPTY_AUDIO_SENTENCE)
        if audio.size is None or audio.size > limit:
            raise HTTPException(status_code=413, detail=vn.TOO_BIG_SENTENCE)
        source = form.get("source")
        yield audio, (source if isinstance(source, str) else vn.SOURCE_UPLOAD)
    finally:
        # The spooled part is closed when the request ends, kept or refused --
        # `create_job` copies it into the job's own directory first.
        await form.close()


@router.post("/jobs")
async def create_job(
    payload: tuple[Any, str] = Depends(_read_audio),
    user: dict = Depends(require_paid),
) -> dict[str, Any]:
    audio, source = payload
    try:
        job = await run_in_threadpool(vn.create_job, user, source, audio.filename, audio.file)
    except vn.VoiceNoteError as e:
        raise _refuse(e) from None
    return job.public()


@router.post("/jobs/{job_id}/transcribe")
def transcribe_next(job_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        job = vn.transcribe_next(user, job_id)
    except vn.VoiceNoteError as e:
        raise _refuse(e) from None
    return job.public()


@router.delete("/jobs/{job_id}")
def discard(job_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    vn.discard_job(user["id"], job_id)
    return {"ok": True}


async def _summarize(user: dict, *, transcript: str, source: str, title: str,
                     duration: int | None = None, name: str = "",
                     desk: dict[str, Any] | None = None) -> dict[str, Any]:
    """ONE model call behind the shared caps; ANY failure still answers the
    transcript (the note can always be saved without a summary)."""
    if not (transcript or "").strip():
        raise HTTPException(status_code=422, detail=vn.NO_SPEECH_SENTENCE)
    from api.services.journal_two import writing_help as wh
    user_id = user["id"]
    model = wh.model_name()
    cost = vn.estimate_cost(transcript, model=model)
    day = note_ask.charge_day()
    common = dict(source=source, title=title, transcript=transcript, model=model,
                  duration=duration, name=name, desk=desk)
    if not await run_in_threadpool(note_ask.reserve_voice_note, user_id, cost=cost, day=day):
        shared = await run_in_threadpool(note_ask.shared_cap_reached, cost=cost)
        return vn.result(ai=None, ai_sentence=(vn.AI_SHARED_CAP_SENTENCE if shared
                                               else vn.AI_BUDGET_SENTENCE), **common)
    from api.services import ai_population_cap
    refusal = await run_in_threadpool(ai_population_cap.admit, "notebook_voice_note")
    if refusal:
        await run_in_threadpool(note_ask.refund_voice_note, user_id, cost=cost, day=day)
        return vn.result(ai=None, ai_sentence=refusal, **common)
    if not note_ask.begin_stream(user_id):
        await run_in_threadpool(note_ask.refund_voice_note, user_id, cost=cost, day=day)
        return vn.result(ai=None, ai_sentence=vn.AI_BUSY_SENTENCE, **common)

    answer = None
    t0 = time.time()
    try:
        # ⛔ Read at CALL time (`vn.complete`), so a test's stub reaches it.
        raw = await vn.complete(vn.request_kwargs(transcript, model=model))
        answer = vn.validate_answer(raw, transcript)
    except Exception:
        # ⛔ NO TRANSCRIPT OR MODEL TEXT IN THE LOG.
        logger.exception("[voice-notes] summary failed source=%s", source)
    finally:
        note_ask.end_stream(user_id)
    if answer is None:
        await run_in_threadpool(note_ask.refund_voice_note, user_id, cost=cost, day=day)
        out = vn.result(ai=None, ai_sentence=vn.AI_FAILED_SENTENCE, **common)
    else:
        out = vn.result(ai=answer, **common)
    from api.services.journal_two import notes as notes_service
    note_ask.run_in_background(
        notes_service._log_notebook_event, user_id, "notebook_voice_note_summarized",
        {**vn.telemetry(source=source, parts=0, settled=answer is not None,
                        tickers=len(out["tickers"]), items=len(out["actionItems"])),
         "ms": int((time.time() - t0) * 1000)})
    return out


@router.post("/jobs/{job_id}/summarize")
async def summarize_job(job_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        job = await run_in_threadpool(vn.get_job, user["id"], job_id)
    except vn.VoiceNoteError as e:
        raise _refuse(e) from None
    if job.transcript is None:
        raise HTTPException(status_code=409, detail=vn.NOT_READY_SENTENCE)
    title = "Voice note" if job.source == vn.SOURCE_RECORDING else (
        f"Recording — {job.name}" if job.name else "Uploaded recording")
    return await _summarize(user, transcript=job.transcript, source=job.source, title=title,
                            duration=int(round(job.duration)), name=job.name)


@router.get("/desk-sessions")
def desk_sessions(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"sessions": vn.desk_sessions()}


@router.post("/desk-sessions/{video_id}/summarize")
async def summarize_desk(video_id: int, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        meta, transcript = await run_in_threadpool(vn.desk_transcript, video_id)
    except vn.VoiceNoteError as e:
        raise _refuse(e) from None
    return await _summarize(user, transcript=transcript, source=vn.SOURCE_DESK,
                            title=meta["title"] or "Desk session", desk=meta)
