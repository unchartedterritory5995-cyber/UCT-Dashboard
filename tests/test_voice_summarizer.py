"""Voice summarizer — gpt-4o-mini summarization of a session's transcripts."""

import json
from unittest.mock import MagicMock, patch
from api.services import voice_summarizer


def test_summarize_returns_text_and_topics():
    fake_msg = MagicMock()
    fake_msg.content = json.dumps({
        "summary": "Discussed NVDA earnings and TSLA short setup.",
        "key_topics": ["NVDA", "TSLA", "earnings"],
    })
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    transcripts = [
        {"role": "user", "text": "What's NVDA at?"},
        {"role": "assistant", "text": "NVDA is at 487."},
        {"role": "user", "text": "And TSLA?"},
        {"role": "assistant", "text": "TSLA at 230, weak setup short."},
    ]

    with patch.object(voice_summarizer, "_get_client", return_value=fake_client):
        out = voice_summarizer.summarize_transcripts(transcripts)

    assert "NVDA" in out["summary"]
    assert "NVDA" in out["key_topics"]
    assert "TSLA" in out["key_topics"]


def test_summarize_returns_empty_for_no_transcripts():
    out = voice_summarizer.summarize_transcripts([])
    assert out["summary"] == ""
    assert out["key_topics"] == []


def test_summarize_handles_malformed_json():
    fake_msg = MagicMock()
    fake_msg.content = "not-valid-json"
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    with patch.object(voice_summarizer, "_get_client", return_value=fake_client):
        out = voice_summarizer.summarize_transcripts([
            {"role": "user", "text": "hi"},
            {"role": "assistant", "text": "hello"},
        ])

    assert isinstance(out["summary"], str)
    assert out["key_topics"] == []
