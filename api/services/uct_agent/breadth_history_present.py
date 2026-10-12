"""The member-facing VIEW of a historical breadth search (breadth.history; present.js contract).

Built ONLY from Market Intelligence's `breadth_events.answer()` — its lead sentence, caveats and table.
MI's own wording and formatting carry the dates and values; nothing is recomputed or reformatted here.
⛔ MEMBER CHANNEL ONLY: this view goes to the browser and the member's saved transcript, never a model.
"""
from __future__ import annotations

from typing import Any, Optional


def view_of(result: Any, answer: dict) -> Optional[dict]:
    """A concise view of one search answer, or None (the browser then derives one from text + table)."""
    if not isinstance(answer, dict):
        return None
    status = answer.get("status")
    lead = str(answer.get("lead") or "").strip()
    caveats = [str(c).strip() for c in (answer.get("caveats") or []) if str(c or "").strip()]
    if status not in ("ok", "partial", "none"):
        text = lead or str(answer.get("text") or "That breadth search isn't available.")
        return {"kind": "error", "text": text}
    if not lead:
        return None
    view = {"kind": "text", "text": lead}
    if caveats:
        view["source"] = " ".join(caveats)[:300]
    return view
