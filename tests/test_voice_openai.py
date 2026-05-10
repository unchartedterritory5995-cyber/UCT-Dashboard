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


# ── Realtime session minting ────────────────────────────────────────────────

def test_mint_realtime_session_returns_client_secret():
    fake_session = MagicMock()
    fake_session.id = "sess_abc123"
    fake_session.client_secret = MagicMock(value="ek_xyz999", expires_at=1234567890)

    fake_client = MagicMock()
    fake_client.beta.realtime.sessions.create.return_value = fake_session

    tools_schema = [{"name": "get_quote", "description": "d",
                     "parameters": {"type": "object", "properties": {}}}]

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.mint_realtime_session(
            voice="verse",
            tools=tools_schema,
            instructions="be helpful",
        )

    assert out["session_id"] == "sess_abc123"
    assert out["client_secret"] == "ek_xyz999"
    assert out["expires_at"] == 1234567890
    fake_client.beta.realtime.sessions.create.assert_called_once()
    kwargs = fake_client.beta.realtime.sessions.create.call_args.kwargs
    assert kwargs["voice"] == "verse"
    assert kwargs["instructions"] == "be helpful"
    assert isinstance(kwargs["tools"], list)
