"""Voice intent service — full transcribe → classify → dispatch → narrate pipeline."""

from unittest.mock import patch, MagicMock
from api.services import voice_intent


def test_run_oneshot_pipeline_happy_path():
    from api.services import voice_tools, voice_tool_impls  # noqa: F401

    fake_classifier_result = {
        "tool": "get_quote",
        "args": {"symbol": "NVDA"},
        "narration_template": "{symbol} is at {last}, {direction} {abs_pct} percent.",
    }

    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result), \
         patch("api.services.voice_intent.dispatch", return_value={
             "symbol": "NVDA", "last": 487.20, "direction": "up", "abs_pct": 2.1, "volume": 35_000_000
         }):
        out = voice_intent.run_oneshot(
            transcript="what's NVDA at",
            context="global",
            user={"id": "u-1"},
        )

    assert out["tool"] == "get_quote"
    assert "NVDA" in out["narration"]
    assert "487" in out["narration"]
    assert "up" in out["narration"]


def test_run_oneshot_no_match():
    fake_classifier_result = {
        "tool": None, "args": {}, "narration_template": "Sorry, I can't help with that."
    }
    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result):
        out = voice_intent.run_oneshot(transcript="tell me a joke", context="global", user={"id": "u"})
    assert out["tool"] is None
    assert "Sorry" in out["narration"]


def test_run_oneshot_handles_missing_placeholder():
    fake_classifier_result = {
        "tool": "get_quote",
        "args": {"symbol": "X"},
        "narration_template": "{symbol} is at {nonexistent_key}.",
    }
    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result), \
         patch("api.services.voice_intent.dispatch", return_value={"symbol": "X"}):
        out = voice_intent.run_oneshot(transcript="quote X", context="global", user={"id": "u"})
    assert "X" in out["narration"]
    assert out["tool"] == "get_quote"
