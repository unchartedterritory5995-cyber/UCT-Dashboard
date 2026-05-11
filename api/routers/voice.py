"""
Voice router — TTS, settings, usage. Slice 1 (Mode A only).
Future slices add /oneshot, /session_token, /exec, /transcripts, /tools.
"""

import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from api.limiter import limiter
from api.middleware.auth_middleware import requires_voice_access
from api.services.voice_settings_service import (
    get_voice_settings,
    update_voice_settings,
    ALLOWED_VOICES,
    MIN_SPEED,
    MAX_SPEED,
)
from api.services.voice_usage import (
    record_mode_a_seconds,
    get_monthly_usage,
    is_within_mode_a_cap,
    MODE_A_DEFAULT_CAP_SECONDS,
)
from api.services.voice_audio_cache import get_cached, put_cached
from api.services.voice_openai import synthesize_speech, synthesize_speech_stream, MAX_INPUT_CHARS
from fastapi import UploadFile, File, Form
from urllib.parse import quote as _urlquote
from api.services.voice_openai import transcribe_audio
from api.services.voice_intent import run_oneshot
from api.services.voice_tools import get_schema_for_context
from api.services.voice_usage import (
    record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
    record_mode_c_seconds, is_within_mode_c_cap, MODE_C_DEFAULT_CAP_SECONDS,
)
from api.services.voice_openai import mint_realtime_session
from api.services.voice_session_service import (
    create_session as _create_voice_session, end_session as _end_voice_session,
    append_transcript, session_belongs_to_user,
)
from api.services.voice_dispatch import run_tool
from api.services.voice_memory_service import (
    build_memory_context, add_summary,
    add_fact as _mem_add_fact,
    list_facts as _mem_list_facts,
    delete_fact as _mem_delete_fact,
    list_summaries as _mem_list_summaries,
    ALLOWED_CATEGORIES as _MEM_CATEGORIES,
)
from api.services.voice_session_service import get_transcripts as _get_session_transcripts
from api.services.voice_summarizer import summarize_transcripts

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)


class SettingsUpdateRequest(BaseModel):
    enabled: bool | None = None
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)
    retention_days: int | None = Field(None, ge=1, le=3650)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _estimate_seconds(text: str, speed: float) -> int:
    """
    Rough estimate used for usage tracking.
    English read-aloud ≈ 150 wpm at speed=1.0 ≈ 2.5 words/sec.
    Speed scales linearly. Always returns at least 1.
    """
    words = max(1, len(text.split()))
    base_seconds = words / 2.5
    seconds = int(round(base_seconds / max(speed, 0.1)))
    return max(1, seconds)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/tts")
@limiter.limit("30/minute")
def tts(request: Request, body: TtsRequest, user: dict = Depends(requires_voice_access)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"text exceeds max length ({MAX_INPUT_CHARS} chars)",
        )

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")
    voice = body.voice or settings["voice"]
    speed = body.speed if body.speed is not None else settings["speed"]
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail=f"unknown voice: {voice}")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_a_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly read-aloud cap reached")

    cached = get_cached(text, voice=voice, speed=speed)
    if cached is not None:
        return Response(content=cached, media_type="audio/mpeg")

    # Pre-check OpenAI client config so we can return 503 BEFORE starting the stream.
    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    accumulated = bytearray()
    user_id = user["id"]

    def streamer():
        try:
            for chunk in synthesize_speech_stream(text, voice=voice, speed=speed):
                accumulated.extend(chunk)
                yield chunk
        except Exception as e:
            _log.exception("voice synth streaming failed: %s", e)
            # Stream truncates; browser <audio> shows error. Nothing more we can do mid-stream.

    def on_complete():
        if accumulated:
            put_cached(text, voice, speed, bytes(accumulated))
            record_mode_a_seconds(user_id, _estimate_seconds(text, speed))

    return StreamingResponse(
        streamer(),
        media_type="audio/mpeg",
        background=BackgroundTask(on_complete),
    )


@router.get("/settings")
def settings_get(user: dict = Depends(requires_voice_access)):
    return get_voice_settings(user["id"])


@router.put("/settings")
@limiter.limit("30/minute")
def settings_put(
    request: Request,
    body: SettingsUpdateRequest,
    user: dict = Depends(requires_voice_access),
):
    try:
        return update_voice_settings(
            user["id"],
            enabled=body.enabled,
            voice=body.voice,
            speed=body.speed,
            retention_days=body.retention_days,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/usage")
def usage_get(user: dict = Depends(requires_voice_access)):
    is_admin = user.get("role") == "admin"
    cap = float("inf") if is_admin else MODE_A_DEFAULT_CAP_SECONDS
    u = get_monthly_usage(user["id"])
    return {
        **u,
        "cap_seconds": cap if cap != float("inf") else None,
        "uncapped": is_admin,
    }


# ── Slice 2: One-Shot (Mode B) ──────────────────────────────────────────────

@router.get("/tools")
def tools_get(context: str = "global", user: dict = Depends(requires_voice_access)):
    """Return the tool catalog visible from the given page context."""
    return {"context": context, "tools": get_schema_for_context(context)}


@router.post("/oneshot")
@limiter.limit("60/minute")
def oneshot(
    request: Request,
    audio: UploadFile = File(...),
    context: str = Form("global"),
    user: dict = Depends(requires_voice_access),
):
    audio_bytes = audio.file.read() if audio else b""
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_b_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly voice query cap reached")

    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        transcript = transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _log.exception("Whisper failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    pipeline = run_oneshot(transcript=transcript, context=context, user=user)
    narration = pipeline["narration"]

    voice_name = settings["voice"]
    speed = settings["speed"]
    accumulated = bytearray()
    user_id = user["id"]

    def streamer():
        try:
            for chunk in synthesize_speech_stream(narration, voice=voice_name, speed=speed):
                accumulated.extend(chunk)
                yield chunk
        except Exception as e:
            _log.exception("oneshot synth streaming failed: %s", e)

    def on_complete():
        if accumulated:
            record_mode_b_call(user_id)

    headers = {
        "X-Voice-Transcript": _urlquote(transcript[:500]),
        "X-Voice-Narration": _urlquote(narration[:500]),
        "X-Voice-Tool": pipeline.get("tool") or "",
    }

    return StreamingResponse(
        streamer(),
        media_type="audio/mpeg",
        headers=headers,
        background=BackgroundTask(on_complete),
    )


# ── Slice 4: Realtime (Mode C) ─────────────────────────────────────────────

class SessionTokenRequest(BaseModel):
    context: str = "global"


class ExecRequest(BaseModel):
    session_id: int
    tool: str
    args: dict = {}


_REALTIME_INSTRUCTIONS = (
    "You are UCT Intelligence, a voice trading assistant inside a stock-market "
    "dashboard. You can see the user's available tools and call them to look up "
    "real-time data. Be concise and natural. Round numbers reasonably. Never "
    "invent prices or data — if a tool fails, say so and offer to try a different "
    "approach. Avoid disclaimers; the user is an experienced trader. Speak like "
    "a sharp colleague, not a chatbot.\n\n"
    "MEMORY: You have tools to remember things across sessions. When the user "
    "tells you a preference, account alias, trading style, or any clear fact "
    "about themselves, call the `remember` tool to save it for future "
    "conversations. When they say 'forget X' or 'stop remembering Y', call "
    "`forget`. When they ask 'what did we discuss about X?' or 'remind me about "
    "Y from last time', call `recall_session`. You can also call `list_my_facts` "
    "to read back everything you currently know about them. Don't pre-announce — "
    "just call the tool and confirm naturally.\n\n"
    "BRIEFINGS: For higher-level requests prefer the agentic flow tools over "
    "calling multiple smaller tools yourself. If the user says 'morning briefing' "
    "or asks for a market overview, call `morning_briefing`. For EOD recap, use "
    "`closing_briefing`. To check a specific ticker before trading, use "
    "`pre_trade_check`. To recap a recent trade, `post_trade_review`. For a daily "
    "plan, `plan_my_day`. These return a pre-assembled narration — just speak it "
    "naturally and pause for follow-up questions afterward."
)


@router.post("/session_token")
@limiter.limit("10/minute")
def session_token(
    request: Request,
    body: SessionTokenRequest,
    user: dict = Depends(requires_voice_access),
):
    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_c_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly conversation cap reached")

    tools_schema = get_schema_for_context(body.context or "global")

    memory_context = build_memory_context(user["id"])
    session_instructions = _REALTIME_INSTRUCTIONS
    if memory_context:
        session_instructions = (
            _REALTIME_INSTRUCTIONS
            + "\n\n=== USER CONTEXT ===\n"
            + memory_context
            + "\n=== END USER CONTEXT ==="
        )

    try:
        mint = mint_realtime_session(
            voice=settings["voice"],
            tools=tools_schema,
            instructions=session_instructions,
        )
    except Exception as e:  # noqa: BLE001
        _log.exception("realtime session mint failed")
        raise HTTPException(status_code=502, detail=f"Realtime session mint failed: {e}")

    sess_db_id = _create_voice_session(
        user_id=user["id"], mode="c", source="orb", page_context=body.context or "global",
    )

    return {
        "session_id": sess_db_id,
        "openai_session_id": mint["session_id"],
        "client_secret": mint["client_secret"],
        "expires_at": mint["expires_at"],
        "model": mint["model"],
        "voice": settings["voice"],
        "tools": tools_schema,
    }


@router.post("/exec")
@limiter.limit("120/minute")
def exec_tool(
    request: Request,
    body: ExecRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")

    return run_tool(
        session_id=body.session_id,
        user_id=user["id"],
        tool_name=body.tool,
        args=body.args or {},
    )


class TranscriptRequest(BaseModel):
    session_id: int
    role: str
    text: str


class SessionEndRequest(BaseModel):
    session_id: int
    duration_seconds: int


@router.post("/transcript")
@limiter.limit("180/minute")
def transcript_post(
    request: Request,
    body: TranscriptRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    if body.role not in {"user", "assistant", "tool"}:
        raise HTTPException(status_code=400, detail="invalid role")
    append_transcript(body.session_id, role=body.role, text=body.text or "")
    return {"ok": True}


@router.post("/session/end")
@limiter.limit("60/minute")
def session_end_post(
    request: Request,
    body: SessionEndRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    duration = max(0, int(body.duration_seconds or 0))
    estimated_cost = duration * 0.005
    _end_voice_session(body.session_id, duration_seconds=duration,
                       estimated_cost_usd=estimated_cost)
    if duration > 0:
        record_mode_c_seconds(user["id"], duration)

    # Schedule background summarization (non-blocking)
    background_tasks.add_task(_summarize_session_background, body.session_id, user["id"])

    return {"ok": True, "duration_seconds": duration}


def _summarize_session_background(session_id: int, user_id: str) -> None:
    """Runs after /session/end returns. Best-effort; failures are logged but swallowed."""
    try:
        transcripts = _get_session_transcripts(session_id) or []
        roles = {t.get("role") for t in transcripts}
        if "user" not in roles or "assistant" not in roles:
            return
        result = summarize_transcripts(transcripts)
        summary = result.get("summary") or ""
        if not summary.strip():
            return
        add_summary(
            session_id=session_id, user_id=user_id,
            summary_text=summary,
            key_topics=result.get("key_topics") or [],
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("session summarization failed for %s: %s", session_id, e)


# ── Memory endpoints ───────────────────────────────────────────────────────

class FactCreate(BaseModel):
    text: str
    category: str = "general"


@router.get("/memory/facts")
def memory_facts_get(user: dict = Depends(requires_voice_access)):
    return {"facts": _mem_list_facts(user["id"])}


@router.post("/memory/facts")
@limiter.limit("30/minute")
def memory_facts_post(
    request: Request,
    body: FactCreate,
    user: dict = Depends(requires_voice_access),
):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    category = body.category if body.category in _MEM_CATEGORIES else "general"
    try:
        fid = _mem_add_fact(user["id"], text=text, category=category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": fid, "text": text, "category": category}


@router.delete("/memory/facts/{fact_id}")
def memory_fact_delete(
    fact_id: int,
    user: dict = Depends(requires_voice_access),
):
    _mem_delete_fact(fact_id, user_id=user["id"])
    return {"ok": True}


@router.get("/memory/summaries")
def memory_summaries_get(user: dict = Depends(requires_voice_access)):
    return {"summaries": _mem_list_summaries(user["id"], limit=20)}
