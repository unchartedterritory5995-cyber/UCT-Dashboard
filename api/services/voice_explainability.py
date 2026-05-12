"""
Explainability — Batch 13e.

For a specific assistant turn or session, produce a structured
"why did you say that" explanation. Pulls from:

  - Tool calls in the same session (what data was looked up)
  - Variant in use (which prompt style was running)
  - User facts + corrections that were injected at mint time (snapshot
    via voice_session_summaries doesn't capture this, so we approximate
    by re-listing the current facts — close enough)
  - Regime + temporal context at session start (approximate — we cache
    these per session in the future; for now, pull them at explain time
    with a 'note: as of explain time, not session time' caveat)

The output is structured + narratable, so the model can quote it
back to the user when asked "why did you say that".
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)


def explain_turn(
    *,
    user_id: str,
    session_id: int,
    turn_text: str | None = None,
) -> dict[str, Any]:
    """
    Build an explanation for a specific session (optionally filtered to
    a particular turn text). Returns a structured dict the assistant or
    UI can render.
    """
    # Load the trace
    from api.services.voice_trace_service import get_trace
    trace = get_trace(session_id, user_id)
    if not trace:
        return {"ok": False, "narration": "Session not found.",
                "session_id": session_id}

    session = trace["session"]
    variant = trace["variant"]
    tool_calls = trace["tool_calls"] or []
    transcripts = trace["transcripts"] or []

    # Find the matching assistant turn if turn_text given
    target_turn = None
    target_ts = None
    if turn_text:
        needle = (turn_text or "").strip().lower()
        for t in transcripts:
            if (t.get("role") == "assistant"
                    and needle in (t.get("text") or "").lower()):
                target_turn = t
                target_ts = t.get("timestamp")
                break

    # Restrict tool calls to those that happened BEFORE the target turn
    # (the assistant's response is informed by tool calls that completed
    # before it spoke). If no target, include all.
    relevant_calls = tool_calls
    if target_ts:
        relevant_calls = [
            c for c in tool_calls
            if (c.get("created_at") or "") <= target_ts
        ]

    # Summarize what data was pulled
    data_sources: list[dict] = []
    for c in relevant_calls[-10:]:  # last 10 are the most relevant
        data_sources.append({
            "tool": c.get("tool_name"),
            "args": c.get("args"),
            "ok": c.get("ok"),
            "when": c.get("created_at"),
        })

    # Pull user facts (current — not necessarily what was injected at session
    # mint, but a reasonable approximation. We note this in the response.)
    try:
        from api.services.voice_memory_service import list_facts
        facts_in_play = list_facts(user_id, limit=20)
    except Exception:
        facts_in_play = []

    try:
        from api.services.voice_feedback_service import list_corrections
        corrections = list_corrections(user_id, limit=10)
    except Exception:
        corrections = []

    # Compose narration the assistant can quote back
    narration_parts = []
    if variant:
        narration_parts.append(
            f"Session ran with prompt variant {variant.get('variant_id')!r}"
        )
    if relevant_calls:
        tools_used = sorted(set(c.get("tool") for c in data_sources if c.get("tool")))
        narration_parts.append(f"called {len(relevant_calls)} tools: "
                                 f"{', '.join(tools_used[:5])}")
    if facts_in_play:
        narration_parts.append(f"{len(facts_in_play)} user facts in play")
    if corrections:
        narration_parts.append(f"{len(corrections)} active corrections")
    narration = ("Explanation — " + "; ".join(narration_parts) + "."
                 if narration_parts else
                 "No structured context found for this session.")

    return {
        "ok": True,
        "narration": narration,
        "session": {
            "id": session.get("id"),
            "page_context": session.get("page_context"),
            "started_at": session.get("started_at"),
            "duration_seconds": session.get("duration_seconds"),
        },
        "variant": variant,
        "target_turn": target_turn,
        "data_sources": data_sources,
        "facts_in_play_count": len(facts_in_play),
        "facts_in_play": [
            {"category": f.get("category"), "text": f.get("text")}
            for f in facts_in_play[:10]
        ],
        "corrections_count": len(corrections),
        "corrections": [
            {"text": c.get("correction_text")}
            for c in corrections[:5]
        ],
        "note": (
            "Facts and corrections shown are current state; the exact "
            "values injected at session-start may differ if you've "
            "edited memory since."
        ),
    }
