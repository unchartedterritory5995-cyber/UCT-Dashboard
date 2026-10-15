# api/services/journal_two/reminder_block.py
"""Tier 2 part B, item 12 (R-T2B-13): the Reminder block a journal style can place.

⛔ NO NEW NODE TYPE, NO NEW READER. The block is an ordinary unticked taskItem whose OWN paragraph
holds a dateMention -- exactly what note_tasks._own_text_and_due reads as a due date -- so the
reminder rides the existing daily task bell and the Tasks view.
⛔ NOT A WIDGET. Every other block id is a widget id; this one builds a taskList. It has no
searchText (the task's own words are its text).
⛔ CREATE-ONLY. "N trading days after creation" means something only when the note is made, and
journal_styles._present cannot see a task, so Update layout never offers it (_plan skips it).
Trading days are session_calendar's: the ONE session authority, holidays included.
⛔ ONE DOOR ON THE SERVER. The reminder is placed by compose, the server's create, and nowhere else on the
server: there is no second server write path that adds a task to a note. (The member's own editor can also
type a task and a date by hand; that is the member's ordinary task, not this block.)
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from api.services import session_calendar
from api.services.journal_two.timeutil import ET

BLOCK_ID = "reminder"
CALENDAR_RANGE_REASON = "calendar-range"
#: ONE FACT IN TWO FILES with journal_styles.BLOCK_KINDS and lib/journalBlocks.js (pinned by
#: tests/test_journal_styles_store.py through Node).
DAYS_OPTIONS = ("1", "2", "3", "5", "10")
DEFAULT_DAYS = "5"
LEAD_TEXT = "Follow up by "
CREATE_ONLY_REASON = "create-only"


class CalendarRangeError(ValueError):
    """The walk would leave the dates session_calendar's dataset covers. `is_trading_day` answers from weekdays
    alone past its horizon (it knows no holiday there), so a date found beyond it could be a holiday: refused."""


def add_trading_days(start: date, n: int) -> date:
    """The n-th trading day AFTER `start` (n >= 1). Bounded: a broken calendar cannot loop forever.

    ⛔ Never a wrong date. `start` and every day stepped through must lie inside session_calendar's covered range
    (`covers`); past it this RAISES CalendarRangeError (a ValueError) instead of guessing from weekdays. Callers:
    build_reminder turns it into a skipped block, followup_prefill treats it as "no session to name", and the
    follow-up job's run ledgers it as a failed run (the calendar dataset then needs its yearly refresh)."""
    left = max(1, int(n))
    d = start
    if not session_calendar.covers(d):
        raise CalendarRangeError(f"{d.isoformat()} is outside the trading calendar's range")
    for _ in range(left * 7 + 21):
        d += timedelta(days=1)
        if not session_calendar.covers(d):
            raise CalendarRangeError(f"{d.isoformat()} is outside the trading calendar's range")
        if session_calendar.is_trading_day(d):
            left -= 1
            if left == 0:
                return d
    raise CalendarRangeError(f"no trading day found within {left} of {n} steps after {start.isoformat()}")


def _days(block: Any) -> int:
    settings = (block or {}).get("settings") if isinstance(block, dict) else None
    raw = str((settings or {}).get("days") or DEFAULT_DAYS)
    return int(raw if raw in DAYS_OPTIONS else DEFAULT_DAYS)


def reminder_node(due: date) -> dict:
    return {"type": "taskList", "content": [{
        "type": "taskItem", "attrs": {"checked": False},
        "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": LEAD_TEXT},
            {"type": "dateMention", "attrs": {"date": due.isoformat()}},
        ]}],
    }]}


def build_reminder(block: dict, ctx: dict):
    """A journal style's builder (journal_styles.BLOCK_BUILDERS). Reads nothing."""
    if ctx.get("mode") != "create":
        return None, CREATE_ONLY_REASON
    now = ctx["now"]
    today = (now if now.tzinfo else now.replace(tzinfo=ET)).astimezone(ET).date()
    try:
        due = add_trading_days(today, _days(block))
    except CalendarRangeError:
        return None, CALENDAR_RANGE_REASON      # no date we can vouch for: the block is skipped, the note is made
    return reminder_node(due), None
