"""Voice OpenAI wrapper — TTS streaming + retry."""

from unittest.mock import MagicMock, patch
import pytest
from api.services import voice_openai


def test_synthesize_returns_bytes_from_sdk():
    fake_resp = MagicMock()
    fake_resp.iter_bytes.return_value = iter([b"chunk1", b"chunk2"])
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_resp
    fake_ctx.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = fake_ctx

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.synthesize_speech("hello", voice="verse", speed=1.0)

    assert out == b"chunk1chunk2"
    fake_client.audio.speech.with_streaming_response.create.assert_called_once()
    kwargs = fake_client.audio.speech.with_streaming_response.create.call_args.kwargs
    assert kwargs["model"] == "tts-1-hd"
    assert kwargs["voice"] == "verse"
    assert kwargs["input"] == "hello"
    assert kwargs["speed"] == 1.0
    assert kwargs["response_format"] == "mp3"


def test_synthesize_truncates_oversize_text():
    fake_resp = MagicMock()
    fake_resp.iter_bytes.return_value = iter([b"x"])
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_resp
    fake_ctx.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = fake_ctx

    long_text = "a" * (voice_openai.MAX_INPUT_CHARS + 500)
    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        voice_openai.synthesize_speech(long_text, voice="verse", speed=1.0)

    sent = fake_client.audio.speech.with_streaming_response.create.call_args.kwargs["input"]
    assert len(sent) <= voice_openai.MAX_INPUT_CHARS


def test_synthesize_rejects_empty_text():
    with pytest.raises(ValueError, match="empty"):
        voice_openai.synthesize_speech("", voice="verse", speed=1.0)
    with pytest.raises(ValueError, match="empty"):
        voice_openai.synthesize_speech("   ", voice="verse", speed=1.0)


# ── Whisper ─────────────────────────────────────────────────────────────────

def test_transcribe_audio_returns_text_from_sdk():
    fake_resp = MagicMock()
    fake_resp.text = "what is NVDA at right now"

    fake_client = MagicMock()
    fake_client.audio.transcriptions.create.return_value = fake_resp

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.transcribe_audio(b"FAKE-WEBM", filename="audio.webm")

    assert out == "what is NVDA at right now"
    fake_client.audio.transcriptions.create.assert_called_once()
    kwargs = fake_client.audio.transcriptions.create.call_args.kwargs
    assert kwargs["model"] == "whisper-1"


def test_transcribe_audio_rejects_empty_blob():
    with pytest.raises(ValueError, match="empty"):
        voice_openai.transcribe_audio(b"", filename="audio.webm")


# ── Intent classifier ───────────────────────────────────────────────────────

def test_classify_intent_returns_tool_and_args():
    fake_msg = MagicMock()
    fake_msg.content = '{"tool":"get_quote","args":{"symbol":"NVDA"},"narration_template":"{symbol} is at {last}."}'
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    tools_schema = [{"name": "get_quote", "description": "Get a stock quote",
                     "parameters": {"type": "object", "properties": {"symbol": {"type": "string"}}}}]

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.classify_intent("what's NVDA at", tools_schema)

    assert out["tool"] == "get_quote"
    assert out["args"] == {"symbol": "NVDA"}
    assert "{last}" in out["narration_template"]
    fake_client.chat.completions.create.assert_called_once()
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["response_format"] == {"type": "json_object"}


def test_classify_intent_handles_no_match():
    fake_msg = MagicMock()
    fake_msg.content = '{"tool":null,"args":{},"narration_template":"Sorry, I can\'t help with that."}'
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.classify_intent("tell me a joke", [])

    assert out["tool"] is None
    assert "Sorry" in out["narration_template"]


# ── Transcript cleanup (gpt-4o-mini) ────────────────────────────────────────

def test_cleanup_transcript_returns_cleaned_text():
    fake_msg = MagicMock()
    fake_msg.content = "Add an NVDA long position at $142."
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.cleanup_transcript("um add a in video long position at one forty two")

    assert out == "Add an NVDA long position at $142."
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini"


def test_cleanup_transcript_passthrough_on_empty():
    out = voice_openai.cleanup_transcript("")
    assert out == ""
    out2 = voice_openai.cleanup_transcript("   ")
    assert out2.strip() == ""


def test_cleanup_transcript_returns_original_on_api_error():
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = RuntimeError("api down")

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.cleanup_transcript("raw spoken text here")

    # Cleanup is best-effort: a failure must NOT lose the user's dictation.
    assert out == "raw spoken text here"


# ── Realtime session minting ────────────────────────────────────────────────

def test_mint_realtime_session_uses_ga_endpoint_first(monkeypatch):
    """First attempt is POST /v1/realtime/client_secrets with nested session payload."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")

    ga_response = MagicMock()
    ga_response.status_code = 200
    ga_response.json.return_value = {
        "value": "ek_ga_999",
        "expires_at": 1234567890,
        "session": {"id": "sess_ga_abc"},
    }

    calls = []
    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json, "headers": headers})
        return ga_response

    import httpx
    monkeypatch.setattr(httpx, "post", fake_post)

    out = voice_openai.mint_realtime_session(
        voice="verse", tools=[{"name": "get_quote", "description": "d",
                               "parameters": {"type": "object", "properties": {}}}],
        instructions="be helpful",
    )

    assert out["session_id"] == "sess_ga_abc"
    assert out["client_secret"] == "ek_ga_999"
    assert out["expires_at"] == 1234567890
    assert len(calls) == 1
    assert calls[0]["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    assert "OpenAI-Beta" not in calls[0]["headers"]
    session = calls[0]["json"]["session"]
    assert session["type"] == "realtime"
    assert session["instructions"] == "be helpful"
    assert session["audio"]["output"]["voice"] == "verse"


def test_mint_realtime_session_falls_back_to_legacy_endpoint(monkeypatch):
    """If GA /client_secrets fails, fall back to legacy /sessions with beta header."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")

    ga_fail = MagicMock(status_code=404, text='{"error":"not found"}')
    legacy_ok = MagicMock()
    legacy_ok.status_code = 200
    legacy_ok.json.return_value = {
        "id": "sess_legacy",
        "client_secret": {"value": "ek_legacy", "expires_at": 0},
    }

    calls = []
    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "beta": headers.get("OpenAI-Beta")})
        if url.endswith("/client_secrets"):
            return ga_fail
        return legacy_ok

    import httpx
    monkeypatch.setattr(httpx, "post", fake_post)

    out = voice_openai.mint_realtime_session(
        voice="verse", tools=[], instructions="x",
    )
    assert out["session_id"] == "sess_legacy"
    assert out["client_secret"] == "ek_legacy"
    assert calls[0]["url"].endswith("/client_secrets")
    assert calls[1]["url"].endswith("/sessions")
    assert calls[1]["beta"] == "realtime=v1"


def test_mint_realtime_session_aggregates_all_errors(monkeypatch):
    """When every attempt fails, the error message includes all of them."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")

    def fake_post(url, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 400
        resp.text = f'{{"error":"bad {url[-15:]}"}}'
        return resp

    import httpx
    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RuntimeError) as exc:
        voice_openai.mint_realtime_session(voice="verse", tools=[], instructions="x")
    msg = str(exc.value)
    assert "GA /client_secrets" in msg
    assert "legacy /sessions" in msg
