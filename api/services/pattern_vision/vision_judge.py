"""Opus 4.8 vision judge: given a chart PNG + a setup, decide confirm/reject.

`judge` is pure given an injected Anthropic client (tests pass a fake). Opus 4.8
vision = base64 image block; no sampling/thinking params (4.8 rejects them).
Supports an optional claimed key level (drawn on the chart) and optional
gold-standard reference charts (few-shot) — both fail-open.
"""
import base64
import json
import re

from .rubrics import rubric_for, SETUP_LABEL

_HEADER = (
    "You are a professional swing trader judging the MOST RECENT action on a daily stock chart.\n"
    "Setup to evaluate: {label}.\n\n"
    "{rubric}\n"
)
_KEY_LINE = "\nThe rule engine flags a key trigger level near {kl:.2f} (the dashed line on the chart).\n"
_EXAMPLES_LINE = (
    "\nThe FIRST image(s) are gold-standard examples of a clean {label} — use them as the "
    "visual benchmark. The LAST image is the candidate you must judge.\n"
)
_CANDIDATE_LINE = "\nJudge the chart image.\n"
_INSTRUCT = (
    "\nCheck EACH must-have criterion against the chart. Be strict: if the setup is "
    "ambiguous, messy, or any disqualifier is visible, reject it.\n"
    "Respond with ONLY a JSON object, no prose:\n"
    '{"confirmed": <true|false>, "confidence": <0-100>, "reason": "<one short sentence>", '
    '"key_level": <number or null>, '
    '"checks": [{"criterion": "<copy each must-have>", "passed": <true|false>}]}'
)


def _img_block(png_bytes: bytes) -> dict:
    return {"type": "image", "source": {
        "type": "base64", "media_type": "image/png",
        "data": base64.standard_b64encode(png_bytes).decode("utf-8")}}


def build_messages(setup: str, png_bytes: bytes, *, key_level=None, example_pngs=None) -> list[dict]:
    label = SETUP_LABEL.get(setup, setup)
    text = _HEADER.format(label=label, rubric=rubric_for(setup))
    if key_level is not None:
        try:
            text += _KEY_LINE.format(kl=float(key_level))
        except (TypeError, ValueError):
            pass
    content = []
    if example_pngs:
        text += _EXAMPLES_LINE.format(label=label)
        content.extend(_img_block(p) for p in example_pngs if p)
    else:
        text += _CANDIDATE_LINE
    text += _INSTRUCT
    content.append(_img_block(png_bytes))  # candidate is always last
    content.append({"type": "text", "text": text})
    return [{"role": "user", "content": content}]


def _parse_checks(raw) -> list:
    out = []
    if isinstance(raw, list):
        for it in raw:
            if isinstance(it, dict) and "criterion" in it:
                out.append({"criterion": str(it.get("criterion"))[:160],
                            "passed": bool(it.get("passed"))})
    return out


def parse_verdict(text: str) -> dict:
    base = {"confirmed": False, "confidence": 0, "reason": "unparseable",
            "key_level": None, "checks": []}
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return base
    try:
        d = json.loads(m.group(0))
    except (ValueError, TypeError):
        return base
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
            "reason": str(d.get("reason") or "")[:240], "key_level": kl,
            "checks": _parse_checks(d.get("checks"))}


def judge(setup: str, png_bytes: bytes, *, client, model: str = "claude-opus-4-8",
          key_level=None, example_pngs=None) -> dict:
    msg = client.messages.create(
        model=model, max_tokens=900,
        messages=build_messages(setup, png_bytes, key_level=key_level, example_pngs=example_pngs))
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    verdict = parse_verdict(text)
    usage = getattr(msg, "usage", None)
    verdict["usage"] = {
        "input_tokens": getattr(usage, "input_tokens", 0),
        "output_tokens": getattr(usage, "output_tokens", 0),
    }
    verdict["model"] = model
    return verdict
