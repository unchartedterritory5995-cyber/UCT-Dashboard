"""Chart vision — GPT-4o image analysis."""

import json
from unittest.mock import MagicMock, patch

import pytest

from api.services import voice_chart_vision as vcv


def _fake_response(payload: dict) -> MagicMock:
    """Build a mock OpenAI completion that returns `payload` as JSON content."""
    msg = MagicMock()
    msg.content = json.dumps(payload)
    choice = MagicMock(message=msg)
    return MagicMock(choices=[choice])


def test_describe_chart_requires_image():
    out = vcv.describe_chart()
    assert out["ok"] is False
    assert "URL" in out["narration"] or "image" in out["narration"].lower()


def test_describe_chart_happy_path():
    fake = _fake_response({
        "pattern": "tight_flag",
        "key_levels": {"entry": 200.50, "stop": 195.00, "target1": 215.00,
                        "recent_pivot": 200.50},
        "structure_notes": "4-bar tight pullback, volume drying up",
        "regime_fit": "favorable",
        "recommendation": "READY",
        "reasoning": "Tight orderly base + bull regime",
        "confidence": 78,
    })
    client = MagicMock()
    client.chat.completions.create.return_value = fake
    from api.services import voice_openai as _vo
    with patch.object(_vo, "_get_client", return_value=client):
        out = vcv.describe_chart(image_url="https://example.com/chart.png",
                                 symbol="NVDA", regime="bull_trend")
    assert out["ok"] is True
    assert out["pattern"] == "tight_flag"
    assert out["recommendation"] == "READY"
    assert out["confidence"] == 78
    assert out["key_levels"]["entry"] == 200.50
    assert "READY" in out["narration"]


def test_describe_chart_handles_b64():
    fake = _fake_response({
        "pattern": "vcp", "recommendation": "WATCH", "confidence": 55,
        "key_levels": {}, "structure_notes": "", "regime_fit": "neutral",
        "reasoning": "needs another tighten",
    })
    client = MagicMock()
    client.chat.completions.create.return_value = fake
    from api.services import voice_openai as _vo
    with patch.object(_vo, "_get_client", return_value=client):
        out = vcv.describe_chart(image_b64="ABCDEF", symbol="MSFT")
    assert out["ok"] is True
    assert out["pattern"] == "vcp"
    # Verify the call sent a data: URI for the b64 image
    args, kwargs = client.chat.completions.create.call_args
    content = kwargs["messages"][0]["content"]
    assert any(c.get("type") == "image_url" and
                "data:image/png;base64" in c["image_url"]["url"]
                for c in content)


def test_describe_chart_handles_invalid_json_response():
    msg = MagicMock()
    msg.content = "this is not JSON {"
    choice = MagicMock(message=msg)
    fake = MagicMock(choices=[choice])
    client = MagicMock()
    client.chat.completions.create.return_value = fake
    from api.services import voice_openai as _vo
    with patch.object(_vo, "_get_client", return_value=client):
        out = vcv.describe_chart(image_url="https://x/y.png")
    assert out["ok"] is False
    assert "JSON" in out["narration"]


def test_describe_chart_handles_api_exception():
    client = MagicMock()
    client.chat.completions.create.side_effect = RuntimeError("rate limited")
    from api.services import voice_openai as _vo
    with patch.object(_vo, "_get_client", return_value=client):
        out = vcv.describe_chart(image_url="https://x/y.png")
    assert out["ok"] is False
    assert "Vision" in out["narration"] or "fail" in out["narration"].lower()


def test_describe_chart_passes_regime_into_prompt():
    fake = _fake_response({"pattern": "none", "recommendation": "SKIP",
                            "confidence": 0, "key_levels": {},
                            "structure_notes": "", "regime_fit": "unfavorable",
                            "reasoning": "bear regime"})
    client = MagicMock()
    client.chat.completions.create.return_value = fake
    from api.services import voice_openai as _vo
    with patch.object(_vo, "_get_client", return_value=client):
        vcv.describe_chart(image_url="https://x/y.png", regime="bear_trend")
    args, kwargs = client.chat.completions.create.call_args
    text_content = next(c["text"] for c in kwargs["messages"][0]["content"]
                         if c.get("type") == "text")
    assert "bear_trend" in text_content
