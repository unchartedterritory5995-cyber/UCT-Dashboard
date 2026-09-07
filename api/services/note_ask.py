"""Ask Current Note — the RESERVATION LEDGER for the Ask surface.

Cost caps and daily per-member limits for every Ask scope, plus the provider
client. Nothing here builds a prompt.

⛔ SLICE 6 REMOVED THIS MODULE'S PROMPT BUILDER, AND THAT WAS THE POINT.
It used to copy `ai_search_personal.py`'s `assemble() -> SYNTH_SYSTEM() ->
synthesize()` shape, which meant `SYNTH_SYSTEM(note_title, note_block)`
interpolated the member's note title and up to 20,000 characters of note body
straight into `system=`. Member content sat in the instruction layer, so a
sentence inside a PDF a member had pasted into a note was read as a peer of
the rules it addressed -- the defect measured in
tests/test_note_ask_prompt_boundary.py. Every Ask scope now builds prompts
through api/services/journal_two/ask_prompt.py, whose system-prompt builder
takes no arguments at all, and the note reaches the model as ranked, citable
blocks inside the evidence fence.

The two contracts that were RIGHT are preserved upstream, not deleted:
  - NO Freshness Firewall. A note's stated fact is a historical claim; the
    model must never silently "correct" it against anything newer. This now
    lives in ask_prompt's HISTORICAL CLAIMS rule, where it covers every scope.
  - Tenant isolation is structural -- ownership is checked before retrieval,
    and every retrieval query carries `user_id`.

Own reserve/refund counters, deliberately NOT shared with
`ai_search_personal`'s budget (a different feature, a different spend to cap).
Env names are unchanged (NOTE_ASK_SYNTH_*) so migrating the prompt path could
not quietly move a deployed knob.
"""

from __future__ import annotations

import os
import threading
from typing import Optional

# The note-context ceiling moved to ask_retrieval.NOTE_SCOPE_MAX_CHARS when
# Slice 6 replaced the 20k system-message blob with ranked, citable blocks.
# Same number, so the model still sees as much of a note as it ever did --
# what changed is that the LEAST relevant blocks are what a long note loses,
# instead of everything past character 20,000.

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


def _async_client():
    import anthropic
    from api.services import llm_timeouts
    return anthropic.AsyncAnthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        timeout=llm_timeouts.seconds("NOTE_ASK_LLM_TIMEOUT_SECS",
                                     llm_timeouts.REQUEST_PATH_LONG),
    )
