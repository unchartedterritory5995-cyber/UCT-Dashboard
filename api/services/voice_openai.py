"""
OpenAI voice client — thin wrapper around openai.audio.speech for TTS.
Centralizes API key resolution + retries + size limits.

Slice 1 covers TTS only. Slice 2 will add Whisper + gpt-4o-mini here;
slice 4 will add Realtime session token minting.
"""

import os
import re
import logging
import time
from openai import OpenAI
from openai import APIConnectionError, APIStatusError, RateLimitError

_log = logging.getLogger(__name__)

# OpenAI TTS hard limit is ~4096 chars PER REQUEST. Stay safely under it.
# Longer text (e.g. the ~11k-char Morning Wire rundown) is split into multiple
# requests at natural boundaries by _chunk_text() and the resulting MP3 streams
# are concatenated — the browser <audio> element plays them back-to-back.
MAX_INPUT_CHARS = 4000

_TTS_MODEL = "tts-1-hd"

_client = None


def _chunk_text(text: str, max_chars: int = MAX_INPUT_CHARS) -> list[str]:
    """
    Split `text` into ordered chunks each <= max_chars, breaking on natural
    boundaries so playback sounds seamless: paragraphs first, then sentences,
    then (only if a single sentence is still too long) words, then — in the
    pathological case of one giant token — a hard slice.

    No content is dropped; concatenating the chunks' words reproduces the input.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # 1) Break into atomic units that are each guaranteed <= max_chars.
    units: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            units.append(para)
            continue
        for sent in re.split(r"(?<=[.!?])\s+", para):
            sent = sent.strip()
            if not sent:
                continue
            if len(sent) <= max_chars:
                units.append(sent)
                continue
            # Sentence too long — pack words greedily.
            cur = ""
            for word in sent.split():
                if len(word) > max_chars:
                    if cur:
                        units.append(cur)
                        cur = ""
                    for i in range(0, len(word), max_chars):
                        units.append(word[i:i + max_chars])
                    continue
                if not cur:
                    cur = word
                elif len(cur) + 1 + len(word) <= max_chars:
                    cur += " " + word
                else:
                    units.append(cur)
                    cur = word
            if cur:
                units.append(cur)

    # 2) Greedily pack units back together up to max_chars, joined by blank
    #    lines so the model reads natural paragraph pauses at the seams.
    chunks: list[str] = []
    cur = ""
    sep = "\n\n"
    for unit in units:
        if not cur:
            cur = unit
        elif len(cur) + len(sep) + len(unit) <= max_chars:
            cur += sep + unit
        else:
            chunks.append(cur)
            cur = unit
    if cur:
        chunks.append(cur)
    return chunks


def _get_client() -> OpenAI:
    """Lazy singleton — fails fast at first use if OPENAI_API_KEY missing."""
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        _client = OpenAI(api_key=api_key)
    return _client


def _synthesize_one_stream(client, chunk: str, *, voice: str, speed: float):
    """Stream MP3 bytes for a single <=MAX_INPUT_CHARS chunk."""
    with client.audio.speech.with_streaming_response.create(
        model=_TTS_MODEL,
        voice=voice,
        input=chunk,
        speed=speed,
        response_format="mp3",
    ) as resp:
        for piece in resp.iter_bytes():
            if piece:
                yield piece


def synthesize_speech_stream(text: str, *, voice: str, speed: float):
    """
    Yield MP3 audio chunks as OpenAI streams them. Generator.
    Used by the /tts router for low-latency client streaming.

    Text longer than the per-request limit is split into multiple chunks
    (paragraph/sentence boundaries) and their MP3 streams are yielded
    back-to-back. The first chunk starts playing while later ones synthesize,
    so long-form read-aloud (e.g. the Morning Wire) stays low-latency.
    Does NOT retry mid-stream.
    """
    if not text or not text.strip():
        raise ValueError("text is empty")

    client = _get_client()
    chunks = _chunk_text(text)
    if len(chunks) > 1:
        _log.info("voice synth: streaming %d chars in %d chunks", len(text), len(chunks))
    for chunk in chunks:
        yield from _synthesize_one_stream(client, chunk, voice=voice, speed=speed)


def synthesize_speech(text: str, *, voice: str, speed: float) -> bytes:
    """
    Synthesize MP3 audio for `text` using OpenAI TTS.
    Returns the full MP3 bytes (callers stream them to the client).
    Long text is chunked; each chunk retries up to 3 times on transient errors
    and the resulting MP3 segments are concatenated.
    """
    if not text or not text.strip():
        raise ValueError("text is empty")

    client = _get_client()
    chunks = _chunk_text(text)
    out = bytearray()
    for chunk in chunks:
        last_err: Exception | None = None
        for attempt in range(1, 4):
            try:
                buf = bytearray()
                for piece in _synthesize_one_stream(client, chunk, voice=voice, speed=speed):
                    buf.extend(piece)
                out.extend(buf)  # commit only after the chunk fully succeeds
                last_err = None
                break
            except (APIConnectionError, RateLimitError) as e:
                last_err = e
                sleep_s = 0.5 * (2 ** (attempt - 1))
                _log.warning("voice synth attempt %d failed: %s — retry in %.1fs", attempt, e, sleep_s)
                time.sleep(sleep_s)
            except APIStatusError:
                # 4xx — do not retry
                raise
        if last_err is not None:
            raise last_err
    return bytes(out)


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


# ── Transcript cleanup (gpt-4o-mini) ────────────────────────────────────────

_CLEANUP_MODEL = "gpt-4o-mini"

_CLEANUP_SYSTEM_PROMPT = """You clean up raw voice-dictation transcripts for a stock-trading journal.

Rules:
- Remove filler words (um, uh, like, you know) and false starts.
- Add natural punctuation and capitalization.
- Fix obvious speech-to-text mishears of stock tickers and trading terms
  (e.g. "in video" → "NVDA", "apple" → "AAPL" only when clearly a ticker,
  "tesla" → "TSLA", "spy" → "SPY", "q q q" → "QQQ", "one forty two" → "142",
  "one forty seven fifty" → "147.50").
- Keep the user's wording and meaning. Do NOT summarize, add content, or
  change the substance. Do NOT add commentary.
- Output ONLY the cleaned text, nothing else."""


def cleanup_transcript(text: str) -> str:
    """
    Clean a raw dictation transcript via gpt-4o-mini: strip fillers, add
    punctuation, fix common ticker mishears. Best-effort — on ANY error the
    original text is returned unchanged so a user's dictation is never lost.
    """
    if not text or not text.strip():
        return text
    try:
        client = _get_client()
        completion = client.chat.completions.create(
            model=_CLEANUP_MODEL,
            messages=[
                {"role": "system", "content": _CLEANUP_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            temperature=0.0,
        )
        cleaned = (completion.choices[0].message.content or "").strip()
        return cleaned or text
    except Exception as e:  # noqa: BLE001
        _log.warning("cleanup_transcript failed, returning original: %s", e)
        return text


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
    Mint an ephemeral Realtime client secret.

    Tries the GA endpoint first (POST /v1/realtime/client_secrets, no beta
    header, nested `session` payload), then falls back to the legacy beta
    endpoint (POST /v1/realtime/sessions with OpenAI-Beta: realtime=v1).
    All attempt errors are aggregated so we can see why each leg failed.

    Returns {session_id, client_secret, expires_at, model}.
    """
    import httpx

    api_key = _os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    resolved_model = model or REALTIME_MODEL

    tool_specs = []
    for t in tools or []:
        tool_specs.append({
            "type": "function",
            "name": t["name"],
            "description": t.get("description", ""),
            "parameters": t.get("parameters") or {"type": "object", "properties": {}},
        })

    base_headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # ── Attempt 1: GA endpoint (no beta) ──
    # POST /v1/realtime/client_secrets with body {"session": {...}}
    ga_payload = {
        "session": {
            "type": "realtime",
            "model": resolved_model,
            "instructions": instructions,
            "audio": {
                "output": {"voice": voice},
                "input": {"transcription": {"model": "whisper-1"}},
            },
            "tools": tool_specs,
            "tool_choice": "auto",
        }
    }
    attempts: list[str] = []
    try:
        resp = httpx.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            json=ga_payload, headers=base_headers, timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            # GA shape: {"value": "ek_...", "expires_at": ..., "session": {"id": "..."}}
            session_obj = data.get("session") or {}
            return {
                "session_id": session_obj.get("id") or data.get("id"),
                "client_secret": data.get("value"),
                "expires_at": data.get("expires_at"),
                "model": resolved_model,
            }
        attempts.append(
            f"GA /client_secrets HTTP {resp.status_code}: {(resp.text or '')[:300]}"
        )
    except Exception as e:  # noqa: BLE001
        attempts.append(f"GA /client_secrets transport: {type(e).__name__}: {e}")

    # ── Attempt 2: legacy beta endpoint ──
    # POST /v1/realtime/sessions with flat payload + OpenAI-Beta: realtime=v1
    legacy_payload = {
        "model": resolved_model,
        "voice": voice,
        "modalities": ["audio", "text"],
        "instructions": instructions,
        "tools": tool_specs,
        "tool_choice": "auto",
        "turn_detection": {"type": "server_vad", "threshold": 0.5},
        "input_audio_transcription": {"model": "whisper-1"},
    }
    for beta_value in ("realtime=v1", None):
        headers = dict(base_headers)
        if beta_value:
            headers["OpenAI-Beta"] = beta_value
        try:
            resp = httpx.post(
                "https://api.openai.com/v1/realtime/sessions",
                json=legacy_payload, headers=headers, timeout=10.0,
            )
        except Exception as e:  # noqa: BLE001
            attempts.append(
                f"legacy /sessions (beta={beta_value!r}) transport: "
                f"{type(e).__name__}: {e}"
            )
            continue
        if resp.status_code == 200:
            data = resp.json()
            secret = data.get("client_secret") or {}
            if not isinstance(secret, dict):
                secret = {}
            return {
                "session_id": data.get("id"),
                "client_secret": secret.get("value"),
                "expires_at": secret.get("expires_at"),
                "model": resolved_model,
            }
        attempts.append(
            f"legacy /sessions (beta={beta_value!r}) HTTP {resp.status_code}: "
            f"{(resp.text or '')[:300]}"
        )

    raise RuntimeError(
        "Realtime session mint failed. Attempts:\n  - " + "\n  - ".join(attempts)
    )
