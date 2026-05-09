"""
Voice router — TTS, settings, usage. Slice 1 (Mode A only).
Future slices add /oneshot, /session_token, /exec, /transcripts, /tools.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
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
)

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
