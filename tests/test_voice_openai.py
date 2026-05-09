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
