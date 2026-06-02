"""
Pre-synthesize the daily Morning Wire read-aloud audio.

Run when the engine pushes a fresh rundown (and on startup as a safety net) so
the first listener gets INSTANT playback instead of waiting ~8s for a cold
synth — and, because cache hits don't record usage, nobody burns their monthly
read-aloud cap on the default-voice briefing.

Best-effort and idempotent: never raises, skips if already cached, gated behind
OPENAI_API_KEY and READ_ALOUD_PREWARM_DISABLED.
"""

import os
import logging
import threading

from api.services.rundown_speech import extract_rundown_speech_text
from api.services.voice_text_normalize import normalize_for_speech
from api.services.voice_audio_cache import cached_file_path, put_cached
from api.services.voice_settings_service import DEFAULT_VOICE, DEFAULT_SPEED

_log = logging.getLogger(__name__)
_lock = threading.Lock()


def prewarm_rundown_audio(html: str, *, voice: str | None = None, speed: float | None = None) -> bool:
    """Synthesize + cache the briefing audio in the default voice. Returns True
    if the audio is warm (freshly cached or already present)."""
    if os.environ.get("READ_ALOUD_PREWARM_DISABLED") == "1":
        return False
    if not os.environ.get("OPENAI_API_KEY"):
        return False

    voice = voice or DEFAULT_VOICE
    speed = DEFAULT_SPEED if speed is None else speed
    try:
        text = extract_rundown_speech_text(html or "")
        if not text or len(text.strip()) < 50:
            return False
        # Must match the live request path exactly (same normalization) so the
        # user's first play is a cache hit.
        norm = normalize_for_speech(text)
        if cached_file_path(norm, voice=voice, speed=speed):
            return True
        from api.services.voice_openai import synthesize_speech
        audio = synthesize_speech(norm, voice=voice, speed=speed)
        if audio:
            put_cached(norm, voice, speed, audio)
            _log.info("read-aloud pre-warm: cached %d-char briefing (voice=%s)", len(norm), voice)
            return True
    except Exception as e:  # noqa: BLE001 — best-effort
        _log.warning("read-aloud pre-warm failed: %s", e)
    return False


def prewarm_rundown_async(html: str) -> None:
    """Fire-and-forget pre-warm on a daemon thread (serialized via a lock)."""
    def _run():
        with _lock:
            prewarm_rundown_audio(html)
    threading.Thread(target=_run, daemon=True, name="read-aloud-prewarm").start()
