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

⭐ THE DAY'S COUNTERS ARE DURABLE (wave 7 whole-branch fix round, ruling
D-H5b). The shared dollar cap, Ask's per-member count and writing help's
per-member count live in auth.db (`api/services/daily_counters.py`), keyed by
(scope, subject, ET day). ⚰️ They were module dicts, so every web deploy --
several a day -- reset them and each "daily" cap was really a cap per uptime.
Ask's live accounting changes only in that a deploy no longer resets it. A
counter read/write error FAILS OPEN with one log line (the counter module's
rule). The concurrent-stream slots (`_inflight`) stay per-process on purpose:
they bound what is open NOW, which a restart really does end.
"""

from __future__ import annotations

import os
import threading
from typing import Optional

from api.services import daily_counters

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
_APPROX_COST = 0.02  # Ask's per-call USD estimate, used ONLY for the cost gate
# (writing help is charged its own per-action estimate, ruling D-H5:
# `writing_help.estimate_cost`)

# The durable counters' scopes (`daily_counters`). ⛔ Renaming one orphans the
# day's rows under the old name -- a free day's allowance at the deploy.
SCOPE_SPEND = "notebook_llm_spend_usd"        # subject daily_counters.GLOBAL
SCOPE_ASK = "notebook_ask"                    # subject: the member's id
SCOPE_WRITING_HELP = "notebook_writing_help"  # subject: the member's id

# Concurrent streams per member. The daily cap bounds SPEND over a day; this
# bounds what one member can hold open at an INSTANT, which is a different
# resource: every open Ask stream pins a slot on the single shared event loop
# for as long as the model is generating.
#
# PER-PROCESS, like every other guard in this pod (sync._locks,
# recent_orders._last_poll, the notification dedups). Correct today because
# the web pod is ONE uvicorn process; the first thing to revisit if it ever
# goes multi-instance, where a second replica silently doubles this.
_MAX_CONCURRENT = int(os.environ.get("NOTE_ASK_MAX_CONCURRENT", "2"))

# Wave 7 lane H (H2, ruling D-H2): editor writing help has its OWN per-member
# daily counter, beside Ask's -- a member who drafts all day must not spend
# their Ask questions doing it, and the reverse. It SHARES the global dollar cap
# above and the concurrent stream slots below.
_WRITING_HELP_DEFAULT_CAP = 60


def writing_help_peruser_cap() -> int:
    """Writing help's per-member daily cap, read PER CALL (whole-branch tests
    shard cross 2): a change to NOTEBOOK_WRITING_HELP_PERUSER_CAP reaches the
    next request with no restart. Unparseable or negative falls back to 60;
    `0` means no drafts (a closed door, never an unlimited one)."""
    raw = os.environ.get("NOTEBOOK_WRITING_HELP_PERUSER_CAP", "60")
    try:
        cap = int(str(raw).strip())
    except (TypeError, ValueError):
        return _WRITING_HELP_DEFAULT_CAP
    return cap if cap >= 0 else _WRITING_HELP_DEFAULT_CAP


_synth_lock = threading.Lock()
_inflight: dict = {}


def _et_day():
    # Lazy import — avoids a module-load cycle with api.routers.ai_search,
    # mirroring ai_search_personal.py's own _et_day().
    from api.routers.ai_search import _et_day as d
    return d()


def _charges(scope: str, user_id, cap, cost: float) -> list:
    """The two counters one reservation moves: the SHARED dollar cap and the
    member's own count for `scope`. ONE list, so a reservation and its refund
    can never move different things."""
    return [
        daily_counters.Charge(SCOPE_SPEND, daily_counters.GLOBAL, float(cost), _SYNTH_GLOBAL_HARD),
        daily_counters.Charge(scope, str(user_id), 1, cap),
    ]


def _reserve(scope: str, user_id, cap, cost: float) -> bool:
    """Atomic check-AND-increment of both counters in ONE durable transaction
    (`daily_counters.take`). False => a cap refused => nothing was counted."""
    return daily_counters.take(_et_day(), _charges(scope, user_id, cap, cost)) is None


def _refund(scope: str, user_id, cost: float, day: Optional[str]) -> None:
    daily_counters.give_back(day or _et_day(), _charges(scope, user_id, None, cost))


def reserve_ask(user_id) -> bool:
    """Atomic check-AND-increment (mirrors ai_search_personal.reserve_synth,
    durable since D-H5b). False => over cap => caller refuses the ask with a
    429, same shape as the AI Search widget's own limit."""
    return _reserve(SCOPE_ASK, user_id, _SYNTH_PERUSER_CAP, _APPROX_COST)


def refund_ask(user_id, *, day: Optional[str] = None) -> None:
    """Inverse of reserve_ask — give back a reservation when synthesis fails
    or produces nothing after a successful reserve, so a failed question
    doesn't permanently consume the member's daily budget. `day` is the day
    the reservation was made (a stream that crosses midnight refunds the day
    it was charged to); never below zero."""
    _refund(SCOPE_ASK, user_id, _APPROX_COST, day)


def reserve_writing_help(user_id, *, cost: Optional[float] = None) -> bool:
    """Writing help's reservation (wave 7 H2, ruling D-H2): its OWN per-member
    daily count (`writing_help_peruser_cap()`, default 60, read per call)
    against the SHARED global dollar cap, charged `cost` -- the route passes
    ruling D-H5's per-action estimate (`writing_help.estimate_cost`); None
    charges the flat `_APPROX_COST`. Atomic, like `reserve_ask`. False => the
    caller refuses with a 429 and the sentence the editor shows."""
    return _reserve(SCOPE_WRITING_HELP, user_id, writing_help_peruser_cap(),
                    _APPROX_COST if cost is None else cost)


def refund_writing_help(user_id, *, cost: Optional[float] = None,
                        day: Optional[str] = None) -> None:
    """Inverse of `reserve_writing_help`, with the SAME `cost` it charged: a
    draft that failed or produced nothing never costs the member one of their
    60, nor the shared cap a cent."""
    _refund(SCOPE_WRITING_HELP, user_id, _APPROX_COST if cost is None else cost, day)


def ask_used(user_id, *, day: Optional[str] = None) -> int:
    """Ask questions this member has been charged for on `day` (today)."""
    return int(daily_counters.value(day or _et_day(), SCOPE_ASK, str(user_id)))


def writing_help_used(user_id, *, day: Optional[str] = None) -> int:
    """Writing-help drafts this member has been charged for on `day` (today)."""
    return int(daily_counters.value(day or _et_day(), SCOPE_WRITING_HELP, str(user_id)))


def spend_today(*, day: Optional[str] = None) -> float:
    """The shared dollar cap's running total for `day` (today): Ask + writing help."""
    return daily_counters.value(day or _et_day(), SCOPE_SPEND, daily_counters.GLOBAL)


def _async_client():
    import anthropic
    from api.services import llm_timeouts
    return anthropic.AsyncAnthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        timeout=llm_timeouts.seconds("NOTE_ASK_LLM_TIMEOUT_SECS",
                                     llm_timeouts.REQUEST_PATH_LONG),
    )


def begin_stream(user_id) -> bool:
    """Claim one concurrent slot. False means the member already has enough
    open, which is a 429 -- not an error, and not a reason to charge them."""
    with _synth_lock:
        n = _inflight.get(user_id, 0)
        if n >= _MAX_CONCURRENT:
            return False
        _inflight[user_id] = n + 1
        return True


def end_stream(user_id) -> None:
    """Release the slot.

    MUST be called from a `finally` -- a stream that ends by disconnect,
    exception or cancellation still has to give the slot back, or a member
    locks themselves out until the process restarts.
    """
    with _synth_lock:
        n = _inflight.get(user_id, 0)
        if n <= 1:
            _inflight.pop(user_id, None)
        else:
            _inflight[user_id] = n - 1


def inflight(user_id) -> int:
    with _synth_lock:
        return _inflight.get(user_id, 0)


def shared_cap_reached(*, cost: Optional[float] = None) -> bool:
    """True when the SHARED dollar cap (Ask + writing help) has no room for one
    more call costing `cost` (the flat `_APPROX_COST` when None). Read-only.
    Lets a refused reservation say WHICH limit refused it: a member who used
    none of their own allowance must not read that they did (wave 7 fix round
    1, review M-2). Pass the cost the reservation was refused at."""
    return spend_today() + (_APPROX_COST if cost is None else cost) > _SYNTH_GLOBAL_HARD


# ── Charging a stream (wave 7 lane H, fix round 1: review I-3) ─────────────────

def refund_due(*, sent: bool, failed: bool) -> bool:
    """THE ONE RULE for when a streamed Ask answer or writing-help draft gives
    its reservation back. Both routes ask this; neither restates it.

    A stream is CHARGED FROM ITS FIRST DELTA OF VISIBLE TEXT (the routes set
    `sent` only for a delta with non-whitespace content: a whitespace-only
    draft is refunded, as it always was). After that the member has text in
    hand and the provider has billed the tokens, so an ABORT (Stop, closing the
    panel, a dropped connection -- all of which land in the stream's `finally`
    with no server error) keeps the charge. ⚰️ The rule this replaces was
    "refund unless the stream SETTLED", which refunded every abort: clicking
    Stop just before `final` was an unlimited supply of free drafts that never
    reached the 60/day count or the shared dollar cap.

    It refunds in exactly two cases:
      * `failed` -- a SERVER-side failure (the provider raised). The member got
        an error sentence, not an answer; that is our failure, not their spend.
      * not `sent` -- no delta ever reached the member (an abort before the
        first word, an empty answer, a stream that never started).
    """
    return bool(failed) or not bool(sent)


class StreamCharge:
    """One stream's reservation + concurrency slot, released EXACTLY ONCE.

    The route sets `sent` just before it yields the first delta and `failed` in
    its `except Exception`; `close()` releases the slot and applies
    `refund_due`. It is called from the stream's `finally` AND from the
    response's background task, because Starlette can cancel a response before
    its body generator ever starts -- a generator that never ran has no
    `finally`, and the slot and the reservation would both leak until the
    process restarts. Idempotent: whichever runs first does the work.

    `refund` is called as `refund(user_id, day=<the ET day at construction>)`:
    the day the reservation was charged to, so a stream that crosses midnight
    gives back to the right day (the counters are keyed by day since ruling
    D-H5b)."""

    def __init__(self, user_id, refund):
        self.user_id = user_id
        self._refund = refund
        self.day = _et_day()
        self.sent = False
        self.failed = False
        self._closed = False
        self._lock = threading.Lock()

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        end_stream(self.user_id)
        if refund_due(sent=self.sent, failed=self.failed):
            self._refund(self.user_id, day=self.day)
