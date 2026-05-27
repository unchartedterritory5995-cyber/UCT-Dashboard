"""Passive Trader Profile auto-populator.

After every voice session, an async pass reads the transcript, asks Claude
Haiku to extract any concrete trader-preference signals (style, risk
tolerance, A+ setups, time preferences, behavioral patterns), and writes
them as `j2_profile_suggestions` rows.

User reviews suggestions on the Compass tab and one-click approves.

Non-invasive: never auto-applies profile changes — every signal is just
a suggestion. Reuses the existing profile_suggestions table.
"""

import json
import logging
import os
from typing import Any

_log = logging.getLogger(__name__)

_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_MAX_SUGGESTIONS_PER_SESSION = 4
_MIN_TRANSCRIPT_TURNS = 4   # Don't bother with tiny sessions

_EXTRACT_SYSTEM = (
    "You are extracting trader-preference signals from a voice conversation "
    "between a trader and their AI coach (Compass). Read the transcript and "
    "identify up to 4 CONCRETE, NEW signals about the trader's style, risk "
    "tolerance, preferred setups, mistakes, time-of-day patterns, or "
    "psychology that would be worth ADDING to their long-term Trader Profile.\n"
    "\n"
    "Strict rules:\n"
    "- Only extract STATEMENTS THE TRADER MADE about themselves. Ignore what "
    "  Compass said.\n"
    "- Skip vague / one-off comments. Look for durable preferences, rules, or "
    "  patterns.\n"
    "- If nothing concrete is in the transcript, return an empty list.\n"
    "- Each suggestion should be 1-2 sentences max, written in third person "
    "  as if the trader profile was updating: 'Prefers X', 'Avoids Y', etc.\n"
    "\n"
    "Output STRICT JSON: {\"suggestions\": [\"...\", \"...\"]}. No prose."
)


def extract_suggestions_from_transcript(transcripts: list[dict]) -> list[str]:
    """Run Haiku over a transcript and return up to N profile suggestions.
    Empty list if there's nothing usable or if the API fails."""
    if not transcripts or len(transcripts) < _MIN_TRANSCRIPT_TURNS:
        return []

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return []

    # Build a clean transcript string — only user turns matter for extraction,
    # but include assistant turns for context.
    lines = []
    for t in transcripts[:60]:  # cap to avoid token blowout
        role = t.get("role") or ""
        text = (t.get("text") or "").strip().replace("\n", " ")
        if role and text:
            lines.append(f"{role.upper()}: {text[:600]}")
    if not lines:
        return []
    convo = "\n".join(lines)[:8000]

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key, timeout=20)
        resp = client.messages.create(
            model=_HAIKU_MODEL,
            max_tokens=400,
            system=_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": f"Transcript:\n\n{convo}"}],
        )
        raw = "".join(b.text for b in (resp.content or []) if hasattr(b, "text")).strip()
    except Exception as e:
        _log.warning("trader_profile_auto Haiku call failed: %s", e)
        return []

    # Parse the JSON response
    try:
        # Strip code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        data = json.loads(cleaned)
        out = data.get("suggestions") or []
        if not isinstance(out, list):
            return []
        # Sanitize: strings only, trim, cap count
        return [str(s).strip()[:500] for s in out if s and isinstance(s, str)][:_MAX_SUGGESTIONS_PER_SESSION]
    except (json.JSONDecodeError, TypeError, KeyError):
        _log.warning("trader_profile_auto JSON parse failed for raw: %s", raw[:200])
        return []


def auto_populate_after_session(session_id: int, user_id: str) -> dict[str, Any]:
    """Entry point — called as a background task after /session/end.

    Reads transcript, extracts suggestions, persists them to
    j2_profile_suggestions for user review. Returns summary dict.
    """
    try:
        from api.routers.voice import _get_session_transcripts
        from api.services.voice_tool_impls import _voice_account_id
        from api.services.journal_two.profile_suggestions import create_suggestion
    except Exception as e:
        _log.warning("trader_profile_auto wiring failed: %s", e)
        return {"created": 0, "error": str(e)}

    transcripts = _get_session_transcripts(session_id) or []
    if len(transcripts) < _MIN_TRANSCRIPT_TURNS:
        return {"created": 0, "reason": "transcript too short"}

    suggestions = extract_suggestions_from_transcript(transcripts)
    if not suggestions:
        return {"created": 0, "reason": "no concrete signals extracted"}

    account_id = _voice_account_id(user_id)
    if not account_id or account_id == "default":
        return {"created": 0, "reason": "no journal account for suggestions"}

    created = 0
    for text in suggestions:
        try:
            create_suggestion(
                user_id=user_id,
                account_id=account_id,
                source_type="voice_session",
                source_id=str(session_id),
                suggestion=text,
            )
            created += 1
        except Exception as e:
            _log.warning("trader_profile_auto suggestion insert failed: %s", e)
            continue

    return {"created": created, "session_id": session_id}
