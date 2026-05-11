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


# ── Whisper STT ─────────────────────────────────────────────────────────────

_WHISPER_MODEL = "whisper-1"
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # OpenAI Whisper limit


def transcribe_audio(audio_bytes: bytes, *, filename: str = "audio.webm") -> str:
    """
    Transcribe an audio blob via OpenAI Whisper.
    Returns the text. Raises ValueError if blob is empty / too large.
    """
    if not audio_bytes:
        raise ValueError("audio is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError(f"audio exceeds {MAX_AUDIO_BYTES} bytes")

    client = _get_client()
    import io
    buf = io.BytesIO(audio_bytes)
    buf.name = filename
    resp = client.audio.transcriptions.create(
        model=_WHISPER_MODEL,
        file=buf,
        response_format="text",
    )
    if hasattr(resp, "text"):
        return resp.text.strip()
    return str(resp).strip()


# ── Intent classification (gpt-4o-mini) ─────────────────────────────────────

_CLASSIFIER_MODEL = "gpt-4o-mini"

_CLASSIFIER_SYSTEM_PROMPT = """You are an intent classifier for a stock-trading dashboard's voice assistant.
The user speaks a short query. Choose the single best matching tool from the catalog and extract its arguments.

You MUST respond with a single JSON object of the shape:
{
  "tool": "<tool_name>" | null,
  "args": { ... },
  "narration_template": "<short spoken response template>"
}

The narration_template is a sentence the assistant will speak after the tool runs.
Use {placeholder} markers for values that come from the tool's result.
Common placeholders include {symbol}, {last}, {direction}, {abs_pct}, {volume}, {count}, {top_movers}, etc.
Keep narration short — one sentence, max ~25 words.
Use natural spoken language. Avoid technical jargon. Round numbers reasonably.

If no tool matches, set "tool" to null and write a polite refusal in narration_template (no placeholders).
"""


def classify_intent(transcript: str, tools_schema: list[dict]) -> dict:
    """
    Classify a user transcript against a tool catalog.
    Returns {tool, args, narration_template}.
    """
    if not transcript or not transcript.strip():
        return {"tool": None, "args": {}, "narration_template": "I didn't catch that. Try again?"}
    if not tools_schema:
        return {"tool": None, "args": {}, "narration_template": "Sorry, no tools are available right now."}

    catalog_lines = []
    for t in tools_schema:
        params = t.get("parameters", {}).get("properties", {})
        param_str = ", ".join(f"{n}: {p.get('type', 'any')}" for n, p in params.items())
        catalog_lines.append(f"- {t['name']}({param_str}): {t.get('description', '')}")

    user_msg = (
        f"Available tools:\n" + "\n".join(catalog_lines) +
        f"\n\nUser said: {transcript!r}\n\n"
        "Respond with JSON."
    )

    client = _get_client()
    completion = client.chat.completions.create(
        model=_CLASSIFIER_MODEL,
        messages=[
            {"role": "system", "content": _CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
    )

    import json
    raw = completion.choices[0].message.content
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        return {"tool": None, "args": {}, "narration_template": "Something went wrong. Try again."}

    return {
        "tool": out.get("tool"),
        "args": out.get("args", {}) or {},
        "narration_template": out.get("narration_template") or "Done.",
    }


# ── Realtime session minting ────────────────────────────────────────────────

import os as _os

REALTIME_MODEL = _os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime")


def mint_realtime_session(
    *,
    voice: str,
    tools: list[dict],
    instructions: str,
    model: str | None = None,
) -> dict:
    """
    Create an ephemeral Realtime session via the OpenAI SDK.
    Returns {session_id, client_secret, expires_at, model}.

    The browser uses client_secret as Bearer auth in the WebRTC SDP exchange.
    """
    client = _get_client()
    tool_specs = []
    for t in tools or []:
        tool_specs.append({
            "type": "function",
            "name": t["name"],
            "description": t.get("description", ""),
            "parameters": t.get("parameters") or {"type": "object", "properties": {}},
        })

    session = client.beta.realtime.sessions.create(
        model=model or REALTIME_MODEL,
        voice=voice,
        modalities=["audio", "text"],
        instructions=instructions,
        tools=tool_specs,
        tool_choice="auto",
        turn_detection={"type": "server_vad", "threshold": 0.5},
        input_audio_transcription={"model": "whisper-1"},
    )

    secret_obj = getattr(session, "client_secret", None)
    secret_value = getattr(secret_obj, "value", None) if secret_obj else None
    expires_at = getattr(secret_obj, "expires_at", None) if secret_obj else None

    return {
        "session_id": session.id,
        "client_secret": secret_value,
        "expires_at": expires_at,
        "model": model or REALTIME_MODEL,
    }
