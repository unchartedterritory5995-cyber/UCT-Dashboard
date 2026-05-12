"""
Chart vision — pipe a chart image to GPT-4o and get back a structured
setup description.

Usage:
  - From the model via voice tool `describe_chart(image_url, symbol?)`
  - From the UI via POST /api/voice/vision/describe (multipart upload
    or JSON {image_url})

The model gets a structured prompt that asks for:
  - Pattern detected (e.g. "tight flag", "VCP", "parabolic")
  - Key levels (entry, stop, target, recent pivot)
  - Bars-in-pattern, depth, volume profile
  - Regime fit (does this work in the current regime — caller provides)
  - Recommendation (READY / WATCH / SKIP) + reasoning
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

VISION_MODEL = "gpt-4o"  # GPT-4o has native vision

_PROMPT_TEMPLATE = """You are a world-class chart reader. Analyze this chart and return a structured response.

Symbol context (caller-supplied, may be empty): {symbol_context}
Current market regime (caller-supplied, may be empty): {regime_context}

Identify:
1. **pattern**: One canonical pattern name from this list, or "none":
   tight_flag, classic_flag, vcp, htf_powerplay, episodic_pivot, stage_2_launch,
   parabolic_long, parabolic_short, wedge_pop, double_bottom, double_top,
   cup_and_handle, base_breakout, undercut_and_rally, ascending_triangle,
   descending_triangle, head_and_shoulders, none.
2. **key_levels**: object with proposed entry, stop, target1, recent_pivot
   (numeric prices or null if not clear).
3. **structure_notes**: 1-2 sentences on bars in pattern, depth %,
   volume profile, MA stack relationship.
4. **regime_fit**: one of "favorable", "neutral", "unfavorable" given
   the supplied regime.
5. **recommendation**: one of "READY", "WATCH", "SKIP".
6. **reasoning**: 1-2 sentences justifying the recommendation.
7. **confidence**: integer 0-100 — how confident you are in the read.

Return ONLY valid JSON with these exact keys. Round prices to 2 decimals.
"""


def describe_chart(
    *,
    image_url: str | None = None,
    image_b64: str | None = None,
    symbol: str | None = None,
    regime: str | None = None,
) -> dict[str, Any]:
    """
    Send a chart image to GPT-4o vision. Returns the structured response
    plus the raw model output for debugging.

    Provide exactly one of image_url or image_b64.
    """
    if not image_url and not image_b64:
        return {"ok": False, "narration": "Need an image URL or base64."}

    # Compose the vision request
    user_content: list[dict[str, Any]] = [
        {"type": "text",
         "text": _PROMPT_TEMPLATE.format(
             symbol_context=(symbol or "n/a").upper(),
             regime_context=regime or "n/a",
         )},
    ]
    if image_url:
        user_content.append({"type": "image_url",
                              "image_url": {"url": image_url, "detail": "high"}})
    else:
        # base64 inline
        user_content.append({"type": "image_url",
                              "image_url": {"url": f"data:image/png;base64,{image_b64}",
                                            "detail": "high"}})

    try:
        from api.services.voice_openai import _get_client
        client = _get_client()
        resp = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": user_content}],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=600,
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("[vision] describe_chart API call failed: %s", e)
        return {"ok": False, "narration": "Vision API call failed.", "error": str(e)}

    raw = resp.choices[0].message.content or ""
    parsed: dict[str, Any] = {}
    import json as _json
    try:
        parsed = _json.loads(raw)
    except _json.JSONDecodeError:
        return {"ok": False, "narration": "Vision response wasn't valid JSON.",
                "raw": raw[:500]}

    pattern = parsed.get("pattern") or "none"
    rec = parsed.get("recommendation") or "SKIP"
    conf = parsed.get("confidence") or 0
    reasoning = parsed.get("reasoning") or ""

    narration = (
        f"{pattern.replace('_', ' ').title()} — {rec} ({conf}% confidence). "
        f"{reasoning}"
    )[:500]

    return {
        "ok": True,
        "narration": narration,
        "pattern": pattern,
        "recommendation": rec,
        "confidence": int(conf) if isinstance(conf, (int, float)) else 0,
        "key_levels": parsed.get("key_levels") or {},
        "structure_notes": parsed.get("structure_notes") or "",
        "regime_fit": parsed.get("regime_fit") or "neutral",
        "reasoning": reasoning,
        "raw": parsed,
    }
