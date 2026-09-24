"""Wave 6 (lane E, item 4) — the member's daily note.

"Today" (and Ctrl/Cmd+Alt+D) opens the member's note for today, creating it the
first time: titled `YYYY-MM-DD · Weekday`, in a root `Daily` folder made on
first use. The day is the member's ET day, computed by the CLIENT (`todayET`,
lib/calendar.js) and sent here; this module only checks it is a real day.

⛔⛔ EXACTLY ONE PER MEMBER PER DAY, ENFORCED SERVER-SIDE — by the unique index
`idx_j2_notes_daily (user_id, daily_date)`, not by the "is there one yet?" read:
two tabs pressing Today at once can BOTH read "no note yet". The first write of
this transaction (the trashed-holder release) takes SQLite's write lock, so the
second tab waits there, then finds the first's Daily folder, and its insert is
refused by the index — and a refused insert is answered with the note that won,
so the member sees one note either way. (An explicit `BEGIN IMMEDIATE` was
tried and removed: no rail could tell it apart from this, so it was a second
guard nobody could prove.)

The member's daily template (a client preference, sent as `templateId`) seeds
the body and property values at CREATION only; opening the day's note again
never re-applies it over the member's words. A template deleted since makes a
plain daily note and says so (`templateMissing`) — Today must always work.

⛔ Nothing here writes `j2_notes` directly: the insert is `notes.create_note`
(with its day and properties, in one write — no later revision to land) and the
trashed-holder release is `notes.release_trashed_daily_date`. The note-write
rails (doorEnumeration) read notes.py, and this keeps every write where they look.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import date
from typing import Any

from api.services.auth_db import get_connection

DAILY_FOLDER_NAME = "Daily"
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class DailyNoteError(ValueError):
    pass


def parse_day(raw: Any) -> date:
    """A strict `YYYY-MM-DD` that names a real day, or DailyNoteError."""
    if not isinstance(raw, str) or not _DATE_RE.match(raw):
        raise DailyNoteError("date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise DailyNoteError("date is not a real day") from None


def daily_title(day: date) -> str:
    """`2026-09-24 · Thursday` — English weekday names, never the server locale's."""
    return f"{day.isoformat()} · {_WEEKDAYS[day.weekday()]}"


def _daily_folder_id(user_id: str, conn: sqlite3.Connection) -> str:
    """The member's root `Daily` folder (any casing they gave it), made on first
    use. Inside the caller's transaction: no commit here."""
    from api.services.journal_two import notes as notes_service

    row = conn.execute(
        "SELECT id FROM j2_note_folders WHERE user_id = ?"
        " AND (parent_id IS NULL OR parent_id = '') AND name = ? COLLATE NOCASE"
        " ORDER BY created_at, id LIMIT 1",
        (user_id, DAILY_FOLDER_NAME),
    ).fetchone()
    if row:
        return row["id"]
    return notes_service.create_folder(user_id, DAILY_FOLDER_NAME, conn=conn)["id"]


def _answer(user_id: str, note_id: str, conn: sqlite3.Connection, *, created: bool, missing: bool) -> dict[str, Any]:
    from api.services.journal_two import notes as notes_service

    return {"note": notes_service.get_note(user_id, note_id, conn=conn),
            "created": created, "templateMissing": missing}


def open_daily_note(user_id: str, raw_date: Any, template_id: Any = None) -> dict[str, Any]:
    from api.services.journal_two import notes as notes_service
    from api.services.journal_two import note_templates

    day = parse_day(raw_date)
    iso = day.isoformat()
    conn = get_connection()
    try:
        existing = notes_service.find_daily_note_id(user_id, iso, conn)
        if existing:
            conn.rollback()  # nothing was written
            return _answer(user_id, existing, conn, created=False, missing=False)
        notes_service.release_trashed_daily_date(user_id, iso, conn)
        folder_id = _daily_folder_id(user_id, conn)
        payload: dict[str, Any] = {"title": daily_title(day), "folderId": folder_id}
        properties = None
        missing = False
        if isinstance(template_id, str) and template_id:
            tpl = note_templates.get_template(user_id, template_id, conn=conn)
            if tpl is None:
                missing = True
            else:
                payload["bodyJson"] = tpl["bodyJson"]
                properties = tpl["properties"] or None
        try:
            note = notes_service.create_note(user_id, payload, conn=conn,
                                             daily_date=iso, properties=properties)
        except sqlite3.IntegrityError:
            # ⛔ The index refused a second note for this day: another request
            # won. Answer with ITS note — the member sees exactly one.
            conn.rollback()
            winner = notes_service.find_daily_note_id(user_id, iso, conn)
            if winner is None:
                raise
            return _answer(user_id, winner, conn, created=False, missing=False)
        return {"note": note, "created": True, "templateMissing": missing}
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()
