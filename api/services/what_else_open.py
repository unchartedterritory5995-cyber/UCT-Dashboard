"""TERM-093 — the "what else was open, named" capture (item 14 WF-C13 / WF-C09).

WHAT THIS IS
────────────
An INSTRUMENT, not a feature. Workflow-library §5.1 calls one question "the
programme's own highest-value cheap observation": when the desk inspects a
chart after a drill (WF-C13), does it ALSO open finviz.com or TradingView by
hand? CARD 24 proved no code read can answer it, CP-06 records the owner
declining to itemise it, and CARD 22 specified the instrument: *what else was
open, NAMED* — the subject names the tab; we never detect it.

THE SUBJECT (decided 2026-10-02 under the owner's delegation; basis in
docs/terminal-research/12-decisions/2026-10-02-term-004-term-093.md): the
owner-desk, operationalised as the admin role. The tool fact is owner-stated
(2026-09-26, "assume I personally use every other site mentioned"); the STEP is
what is unmeasured, so the subject is the person whose step it is. Members are
never asked — the population is 13 accounts and the ~750 are another product's.

THE OCCASION: opening the breadth drill (`BreadthDrillModal`) — a click a
PERSON made on a cell (`lesson_a_change_callback_is_not_proof_of_user_intent`).
Eligibility is a property of the occasion, never of our output (item 27): an
open whose chart renders blank is still an eligible occasion.

THE THREE STATES, which this module exists to keep apart
───────────────────────────────────────────────────────
  absent      — no row. We were never asked; nothing is known.
  unanswered  — a row with answered_at NULL. The occasion happened and the
                subject did not say. ⛔ NOT the same as "nothing else open".
  answered    — a row with a named list. `[]` is not allowed as an answer;
                "nothing else" is the explicit token `none`.
A layer that could not be read is not a layer that is empty.

⛔ NO PROBE. This module stores names a person typed or clicked. It reads no
other tab, no referrer, no history; the rail in tests/test_what_else_open.py
asserts it over the frontend source too.

⛔ NEVER A DELETE. Stopping the capture is unsetting the flag. Nothing here
deletes or rewrites what a person already told us (item 37 :590): an answer is
written once, guarded by `answered_at IS NULL`.

DARK behind WHAT_ELSE_OPEN_CAPTURE_ENABLED, read per call, unset = OFF.
Behavioural data about third-party tools: the firm's internal record; no route
here returns it to anyone but an admin.
"""
from __future__ import annotations

import os
import re
import threading
from datetime import datetime, timezone

from api.services import auth_db

FLAG = "WHAT_ELSE_OPEN_CAPTURE_ENABLED"

#: The declared occasions. A closed set: a new moment is a decision, not a string.
OCCASIONS = ("wf_c13_breadth_drill",)

#: The named tools, from the owner-stated break-out set (workflow-library §5.1),
#: plus the two explicit non-tool answers. `none` is "I had nothing else open";
#: it is an ANSWER, and it is the thing an unanswered row must never be read as.
TOOLS = ("finviz", "tradingview", "thinkorswim", "other", "none")

_OCC_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")
_OTHER_MAX = 80

_init_done = False
_init_lock = threading.Lock()


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def _ensure_init() -> None:
    global _init_done
    if _init_done:
        return
    with _init_lock:
        if _init_done:
            return
        conn = auth_db.get_connection()
        try:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS what_else_open_occasions (
                    occasion_id  TEXT PRIMARY KEY,
                    user_id      TEXT NOT NULL,
                    occasion     TEXT NOT NULL,
                    context      TEXT,
                    opened_at    TEXT NOT NULL,
                    answered_at  TEXT,
                    tools        TEXT,
                    other_text   TEXT
                )"""
            )
            conn.commit()
        finally:
            conn.close()
        _init_done = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class CaptureError(ValueError):
    """A request the instrument refuses (bad occasion, id, or answer)."""


def record_occasion(user_id: str, occasion_id: str, occasion: str, context: str | None = None) -> bool:
    """Record that an eligible occasion HAPPENED, before any answer. Idempotent on
    `occasion_id` (a remount of the same open must not count twice). Returns True
    when a new row was written."""
    if occasion not in OCCASIONS:
        raise CaptureError(f"unknown occasion {occasion!r}")
    if not _OCC_ID_RE.match(occasion_id or ""):
        raise CaptureError("bad occasion_id")
    ctx = (context or "").strip().upper()[:12] or None
    if ctx is not None and not _SYM_RE.match(ctx):
        ctx = None
    _ensure_init()
    conn = auth_db.get_connection()
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO what_else_open_occasions "
            "(occasion_id, user_id, occasion, context, opened_at) VALUES (?, ?, ?, ?, ?)",
            (occasion_id, user_id, occasion, ctx, _now()),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def record_answer(user_id: str, occasion_id: str, tools: list[str], other_text: str | None = None) -> bool:
    """Write the subject's named answer ONCE. Returns False when the occasion is
    not theirs, does not exist, or was already answered (never overwritten)."""
    named = sorted({t for t in (tools or []) if isinstance(t, str)})
    if not named:
        raise CaptureError("an answer names at least one tool, or 'none'")
    bad = [t for t in named if t not in TOOLS]
    if bad:
        raise CaptureError(f"unknown tool(s) {bad}")
    if "none" in named and len(named) > 1:
        raise CaptureError("'none' cannot be combined with a named tool")
    other = (other_text or "").strip()[:_OTHER_MAX] or None
    if other and "other" not in named:
        raise CaptureError("other_text needs 'other'")
    _ensure_init()
    conn = auth_db.get_connection()
    try:
        cur = conn.execute(
            "UPDATE what_else_open_occasions SET answered_at = ?, tools = ?, other_text = ? "
            "WHERE occasion_id = ? AND user_id = ? AND answered_at IS NULL",
            (_now(), ",".join(named), other, occasion_id, user_id),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def summary() -> dict:
    """The admin read-back: recorded / eligible with the denominator PUBLISHED,
    `n` subjects as a count (it may be 1), and per-tool counts over ANSWERED
    occasions only. Unanswered is its own number, never folded into `none`."""
    _ensure_init()
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT user_id, occasion, answered_at, tools FROM what_else_open_occasions"
        ).fetchall()
    finally:
        conn.close()
    eligible = len(rows)
    answered = [r for r in rows if r["answered_at"] is not None]
    by_tool = {t: 0 for t in TOOLS}
    for r in answered:
        for t in (r["tools"] or "").split(","):
            if t in by_tool:
                by_tool[t] += 1
    by_occasion = {o: {"eligible": 0, "answered": 0} for o in OCCASIONS}
    for r in rows:
        slot = by_occasion.setdefault(r["occasion"], {"eligible": 0, "answered": 0})
        slot["eligible"] += 1
        if r["answered_at"] is not None:
            slot["answered"] += 1
    return {
        "enabled": is_enabled(),
        "eligible": eligible,
        "answered": len(answered),
        "unanswered": eligible - len(answered),
        "recorded_over_eligible": f"{len(answered)}/{eligible}",
        "n_subjects": len({r["user_id"] for r in rows}),
        "by_tool_over_answered": by_tool,
        "by_occasion": by_occasion,
        "note": ("unanswered is NOT 'none': an occasion with no response is recorded "
                 "as unanswered. n is reported as n; the population is the admin desk."),
    }
