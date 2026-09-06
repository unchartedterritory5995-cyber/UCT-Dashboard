"""Ask Current Note (Wave 2, P0-5) — bounded-context Q&A over ONE already-
authorized note.

POST /api/j2/notes/{note_id}/ask/stream (see api/routers/journal_two.py)

Copies `ai_search_personal.py`'s `assemble() -> SYNTH_SYSTEM() -> synthesize()`
shape verbatim (per architecture spec §8.1) — same reserve/refund cost-cap
idiom, same streaming-synthesis idiom. Two deliberate differences:

  - NO Freshness Firewall. `ai_search_personal.py`'s system prompt says "the
    LIVE DESK figures are authoritative — never override a live number with a
    stale personal one." Notebook needs the OPPOSITE contract: a note's stated
    fact is a historical claim (what the member believed/wrote at the time),
    and the model must never silently "correct" it against anything newer.
  - Context is the single note's own `bodyPlain` — nothing else. No live
    desk data, no web draft, no other note. Tenant isolation is therefore
    structural: `get_note(user_id, note_id)` is the only gate needed, because
    there is no cross-row retrieval to leak (architecture spec §8.1).

Own reserve/refund counters — deliberately NOT shared with
`ai_search_personal`'s budget (a different feature, a different spend to cap).
"""
from __future__ import annotations

import os
import threading
from typing import Optional

# Longest note content handed to the model. Generous for a single note (this
# is the ONLY context, not a supplement to a web draft) while still bounding
# token cost against a pathological giant note.
_NOTE_BODY_CAP = 20000

_SYNTH_MODEL = os.environ.get("NOTE_ASK_SYNTH_MODEL", "claude-sonnet-5")
_SYNTH_MAX_TOKENS = int(os.environ.get("NOTE_ASK_SYNTH_MAX_TOKENS", "700"))
_SYNTH_TIMEOUT = float(os.environ.get("NOTE_ASK_SYNTH_TIMEOUT", "45"))
_SYNTH_PERUSER_CAP = int(os.environ.get("NOTE_ASK_SYNTH_PERUSER_CAP", "40"))
_SYNTH_GLOBAL_HARD = float(os.environ.get("NOTE_ASK_SYNTH_COST_HARD", "25"))
_APPROX_COST = 0.02  # rough per-call USD estimate, used ONLY for the cost gate

_synth_lock = threading.Lock()
_synth_day = ""
_synth_by_user: dict = {}
_synth_spend = 0.0


def _et_day():
    # Lazy import — avoids a module-load cycle with api.routers.ai_search,
    # mirroring ai_search_personal.py's own _et_day().
    from api.routers.ai_search import _et_day as d
    return d()


def reserve_ask(user_id) -> bool:
    """Atomic check-AND-increment under one lock hold (mirrors
    ai_search_personal.reserve_synth). False => over cap => caller refuses
    the ask with a 429, same shape as the AI Search widget's own limit."""
    global _synth_day, _synth_spend
    with _synth_lock:
        d = _et_day()
        if d != _synth_day:
            _synth_day = d
            _synth_by_user.clear()
            _synth_spend = 0.0
        if _synth_spend + _APPROX_COST > _SYNTH_GLOBAL_HARD:
            return False
        if _synth_by_user.get(user_id, 0) + 1 > _SYNTH_PERUSER_CAP:
            return False
        _synth_by_user[user_id] = _synth_by_user.get(user_id, 0) + 1
        _synth_spend += _APPROX_COST
        return True


def refund_ask(user_id) -> None:
    """Inverse of reserve_ask — give back a reservation when synthesis fails
    or produces nothing after a successful reserve, so a failed question
    doesn't permanently consume the member's daily budget."""
    global _synth_spend
    with _synth_lock:
        if _synth_by_user.get(user_id):
            _synth_by_user[user_id] = max(0, _synth_by_user[user_id] - 1)
        _synth_spend = max(0.0, _synth_spend - _APPROX_COST)


def assemble_note_block(body_plain: Optional[str]) -> str:
    """The note's own plain-text content, capped. This IS the context —
    unlike ai_search_personal's supplementary personal block, there is
    nothing else in this prompt."""
    text = (body_plain or "").strip()
    return text[:_NOTE_BODY_CAP]


def _async_client():
    import anthropic
    from api.services import llm_timeouts
    return anthropic.AsyncAnthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        timeout=llm_timeouts.seconds("NOTE_ASK_LLM_TIMEOUT_SECS",
                                     llm_timeouts.REQUEST_PATH_LONG),
    )


def SYNTH_SYSTEM(note_title: str, note_block: str) -> str:
    from api.routers.ai_search import _SAFETY_BLOCKS
    return (
        "You are answering a question about ONE specific private note a UCT "
        "member wrote in their own Notebook.\n\n" + _SAFETY_BLOCKS + "\n\n"
        "GROUNDING — the only rule that matters here: answer using ONLY the "
        "NOTE CONTENT below. If the note does not address the question, say so "
        "plainly (e.g. \"this note doesn't mention that\") rather than guessing "
        "or filling the gap from general knowledge. Never invent a fact, price, "
        "date, or figure that is not written in the note.\n\n"
        "HISTORICAL-CLAIM CONTRACT (the opposite of a live-data assistant): the "
        "note's content is a historical claim — what the member believed or "
        "observed at the time they wrote it. Do NOT silently \"correct\" a "
        "stated fact against anything you know happened since, and do not "
        "append live/current data the note itself doesn't contain. If useful, "
        "you may note that something may be dated, but never override it.\n\n"
        "CITATION FORMAT: when you state something the note says, quote the "
        "exact short phrase from the note in \"double quotes\" so the member "
        "can see it came from their own writing. Keep quotes short (a phrase, "
        "not a paragraph) and verbatim — do not paraphrase inside quote marks.\n\n"
        f"=== NOTE TITLE ===\n{note_title or '(untitled)'}\n\n"
        f"=== NOTE CONTENT (private; this member's own writing) ===\n{note_block}"
    )


async def synthesize(query: str, note_title: str, note_block: str, history):
    """Streams token deltas from a note-scoped Anthropic call. LOCKED config:
    no `temperature` kwarg (Sonnet tier 400s on it), thinking disabled,
    explicit timeout — mirrors ai_search_personal.synthesize."""
    system = SYNTH_SYSTEM(note_title, note_block)
    msgs = []
    for h in (history or [])[-3:]:
        if isinstance(h, dict) and h.get("q") and h.get("a"):
            msgs.append({"role": "user", "content": str(h["q"])[:300]})
            msgs.append({"role": "assistant", "content": str(h["a"])[:1200]})
    msgs.append({"role": "user", "content": query})
    client = _async_client()
    async with client.messages.stream(
        model=_SYNTH_MODEL, max_tokens=_SYNTH_MAX_TOKENS, system=system,
        messages=msgs, thinking={"type": "disabled"},
        timeout=_SYNTH_TIMEOUT,     # NO temperature (Sonnet tier 400s)
    ) as stream:
        async for delta in stream.text_stream:
            yield delta
