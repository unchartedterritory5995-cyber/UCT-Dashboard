"""
End-to-end one-shot voice pipeline:
  transcript + context + user → tool call → narration string

Used by /api/voice/oneshot. Keeps the router thin.
"""

import logging
import string

from api.services.voice_openai import classify_intent
from api.services.voice_tools import get_schema_for_context, dispatch

# Make sure tool implementations register on import
from api.services import voice_tool_impls  # noqa: F401

_log = logging.getLogger(__name__)


class _SafeDict(dict):
    """Dict that returns a stub if a key is missing."""
    def __missing__(self, key):
        return f"({key})"


def _safe_format(template: str, values: dict) -> str:
    """Format template with format_map; never raises on missing keys."""
    try:
        return string.Formatter().vformat(template, (), _SafeDict(values or {}))
    except Exception:
        return template


def run_oneshot(*, transcript: str, context: str, user: dict) -> dict:
    """
    Returns: {tool, args, narration, raw_result}

    `narration` is the assistant's spoken response, ready for TTS.
    `raw_result` is the dict the tool returned (or None for refusal).
    """
    transcript = (transcript or "").strip()
    if not transcript:
        return {"tool": None, "args": {}, "narration": "I didn't catch that. Try again?", "raw_result": None}

    tools_schema = get_schema_for_context(context or "global")
    classifier_out = classify_intent(transcript, tools_schema)

    tool_name = classifier_out.get("tool")
    template = classifier_out.get("narration_template") or "Done."

    if not tool_name:
        return {
            "tool": None,
            "args": {},
            "narration": template,
            "raw_result": None,
        }

    args = classifier_out.get("args") or {}
    try:
        result = dispatch(tool_name, args, user=user)
    except (KeyError, ValueError, TypeError) as e:
        _log.warning("voice tool %s failed: %s", tool_name, e)
        return {
            "tool": tool_name,
            "args": args,
            "narration": "Something went wrong looking that up. Try again?",
            "raw_result": None,
        }

    narration = _safe_format(template, result)
    narration = " ".join(narration.split())
    if len(narration) > 600:
        narration = narration[:600]

    return {
        "tool": tool_name,
        "args": args,
        "narration": narration,
        "raw_result": result,
    }
