"""
Voice router — TTS, settings, usage. Slice 1 (Mode A only).
Future slices add /oneshot, /session_token, /exec, /transcripts, /tools.
"""

import logging
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

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
)
from api.services.voice_audio_cache import get_cached, put_cached
from api.services.voice_openai import synthesize_speech, MAX_INPUT_CHARS

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)


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
        # Truncation also happens in synthesize_speech, but reject obviously oversize.
        raise HTTPException(
            status_code=400,
            detail=f"text exceeds max length ({MAX_INPUT_CHARS} chars)",
        )

    settings = get_voice_settings(user["id"])
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

    try:
        audio_bytes = synthesize_speech(text, voice=voice, speed=speed)
    except RuntimeError as e:
        # Missing API key etc.
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001 — bubble OpenAI errors as 502
        _log.exception("voice synth failed")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")

    put_cached(text, voice, speed, audio_bytes)
    record_mode_a_seconds(user["id"], _estimate_seconds(text, speed))
    return Response(content=audio_bytes, media_type="audio/mpeg")
