"""
Summarize a voice session's transcripts into a short recap + key topics.
Used as a background task after /api/voice/session/end.
"""

import json
import logging
from api.services.voice_openai import _get_client

_log = logging.getLogger(__name__)

_SUMMARY_MODEL = "gpt-4o-mini"

_SYSTEM_PROMPT = """You write short, useful summaries of voice conversations
between a trader and their AI assistant. The summary will be re-injected into
the assistant's context for future conversations, so write it as background
context that helps the assistant pick up where it left off.

Respond with a single JSON object:
{
  "summary": "2-3 sentence recap including: what the user asked about, key
              tickers/themes mentioned, any preferences expressed, and any
              decisions made.",
  "key_topics": ["NVDA", "earnings", ...]   // up to 8 short tags
}

The summary should be useful, not generic. Skip greetings and filler.
"""


def summarize_transcripts(transcripts: list[dict]) -> dict:
    """Transcripts: list of {role, text}. Returns {summary, key_topics}."""
    if not transcripts:
        return {"summary": "", "key_topics": []}

    lines = []
    for t in transcripts:
        role = t.get("role") or "user"
        text = (t.get("text") or "").strip()
        if not text:
            continue
        prefix = "USER" if role == "user" else "ASSISTANT" if role == "assistant" else "TOOL"
        lines.append(f"{prefix}: {text}")
    if not lines:
        return {"summary": "", "key_topics": []}

    dialog = "\n".join(lines)[:6000]

    try:
        client = _get_client()
        completion = client.chat.completions.create(
            model=_SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Conversation:\n{dialog}\n\nRespond with JSON."},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        raw = completion.choices[0].message.content
    except Exception as e:  # noqa: BLE001
        _log.warning("summarize_transcripts: OpenAI call failed: %s", e)
        return {"summary": "", "key_topics": []}

    try:
        data = json.loads(raw)
        return {
            "summary": (data.get("summary") or "").strip()[:2000],
            "key_topics": [t for t in (data.get("key_topics") or []) if isinstance(t, str)][:8],
        }
    except json.JSONDecodeError:
        return {"summary": (raw or "").strip()[:2000], "key_topics": []}
