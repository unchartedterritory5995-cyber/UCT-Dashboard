"""
OpenAI voice client — thin wrapper around openai.audio.speech for TTS.
Centralizes API key resolution + retries + size limits.

Slice 1 covers TTS only. Slice 2 will add Whisper + gpt-4o-mini here;
slice 4 will add Realtime session token minting.
"""

import os
import logging
import time
from openai import OpenAI
from openai import APIConnectionError, APIStatusError, RateLimitError

_log = logging.getLogger(__name__)

# OpenAI tts-1 hard limit is ~4096 chars. Stay safely under.
MAX_INPUT_CHARS = 4000

_TTS_MODEL = "tts-1-hd"

_client = None


def _get_client() -> OpenAI:
    """Lazy singleton — fails fast at first use if OPENAI_API_KEY missing."""
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        _client = OpenAI(api_key=api_key)
    return _client


def synthesize_speech_stream(text: str, *, voice: str, speed: float):
    """
    Yield MP3 audio chunks as OpenAI streams them. Generator.
    Used by the /tts router for low-latency client streaming.
    Does NOT retry mid-stream (retries happen in synthesize_speech which uses
    this under the hood for the simple bytes-result path).
    """
    if not text or not text.strip():
        raise ValueError("text is empty")
    if len(text) > MAX_INPUT_CHARS:
        _log.warning("voice synth: truncating %d -> %d chars", len(text), MAX_INPUT_CHARS)
        text = text[:MAX_INPUT_CHARS]

    client = _get_client()
    with client.audio.speech.with_streaming_response.create(
        model=_TTS_MODEL,
        voice=voice,
        input=text,
        speed=speed,
        response_format="mp3",
    ) as resp:
        for chunk in resp.iter_bytes():
            if chunk:
                yield chunk


def synthesize_speech(text: str, *, voice: str, speed: float) -> bytes:
    """
    Synthesize MP3 audio for `text` using OpenAI tts-1.
    Returns the full MP3 bytes (callers stream them to the client).
    Retries up to 3 times on transient errors.
    """
    if not text or not text.strip():
        raise ValueError("text is empty")
    if len(text) > MAX_INPUT_CHARS:
        _log.warning("voice synth: truncating %d -> %d chars", len(text), MAX_INPUT_CHARS)
        text = text[:MAX_INPUT_CHARS]

    client = _get_client()
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            with client.audio.speech.with_streaming_response.create(
                model=_TTS_MODEL,
                voice=voice,
                input=text,
                speed=speed,
                response_format="mp3",
            ) as resp:
                buf = bytearray()
                for chunk in resp.iter_bytes():
                    buf.extend(chunk)
                return bytes(buf)
        except (APIConnectionError, RateLimitError) as e:
            last_err = e
            sleep_s = 0.5 * (2 ** (attempt - 1))
            _log.warning("voice synth attempt %d failed: %s — retry in %.1fs", attempt, e, sleep_s)
            time.sleep(sleep_s)
        except APIStatusError as e:
            # 4xx — do not retry
            raise
    assert last_err is not None
    raise last_err
