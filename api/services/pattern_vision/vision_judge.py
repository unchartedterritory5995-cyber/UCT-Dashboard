"""Opus 4.8 vision judge: given a chart PNG + a setup, decide confirm/reject.

`judge` is pure given an injected Anthropic client (tests pass a fake). Opus 4.8
vision = base64 image block; no sampling/thinking params (4.8 rejects them).
"""
import base64
import json
import re

from .rubrics import rubric_for, SETUP_LABEL

_PROMPT = (
    "You are a professional swing trader judging a daily stock chart.\n"
    "Setup to evaluate: {label}.\n"
    "Definition: {rubric}\n\n"
    "Look ONLY at the chart image. Decide whether the most recent action is a CLEAN, "
    "textbook instance of this setup. Be strict — if it's ambiguous or messy, reject it.\n"
    "Respond with ONLY a JSON object, no prose:\n"
    '{{"confirmed": <true|false>, "confidence": <0-100>, "reason": "<one short sentence>", '
    '"key_level": <number or null>}}'
)


def build_messages(setup: str, png_bytes: bytes) -> list[dict]:
    b64 = base64.standard_b64encode(png_bytes).decode("utf-8")
    text = _PROMPT.format(label=SETUP_LABEL.get(setup, setup), rubric=rubric_for(setup))
    return [{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": text},
        ],
    }]


def parse_verdict(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return {"confirmed": False, "confidence": 0, "reason": "unparseable", "key_level": None}
    try:
        d = json.loads(m.group(0))
    except (ValueError, TypeError):
        return {"confirmed": False, "confidence": 0, "reason": "unparseable", "key_level": None}
    try:
        conf = int(round(float(d.get("confidence"))))
    except (TypeError, ValueError):
        conf = 0
    kl = d.get("key_level")
    try:
        kl = float(kl) if kl is not None else None
    except (TypeError, ValueError):
        kl = None
    return {"confirmed": bool(d.get("confirmed")), "confidence": max(0, min(100, conf)),
            "reason": str(d.get("reason") or "")[:240], "key_level": kl}


def judge(setup: str, png_bytes: bytes, *, client, model: str = "claude-opus-4-8") -> dict:
    msg = client.messages.create(model=model, max_tokens=600,
                                 messages=build_messages(setup, png_bytes))
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    verdict = parse_verdict(text)
    usage = getattr(msg, "usage", None)
    verdict["usage"] = {
        "input_tokens": getattr(usage, "input_tokens", 0),
        "output_tokens": getattr(usage, "output_tokens", 0),
    }
    verdict["model"] = model
    return verdict
