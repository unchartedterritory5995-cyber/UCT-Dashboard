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
from typing import Any, Callable

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


def _text_of(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return str(node.get("text") or "")
    return "".join(_text_of(c) for c in node.get("content") or [])


def merge_seed(seed: list[dict], content: list[dict]) -> list[dict]:
    """The seed's blocks above the template's body -- unless the seed starts with a heading the template ALSO has
    (the "Daily prep" shape: its own "Today's plan"). Then the seed's checklist items join the template's first
    checklist under that heading (or a new one right after it), and no second heading is written (Tier 3b M9)."""
    if not seed or seed[0].get("type") != "heading":
        return [*seed, *content]
    title = _text_of(seed[0]).strip().lower()
    at = next((i for i, n in enumerate(content) if isinstance(n, dict) and n.get("type") == "heading"
               and _text_of(n).strip().lower() == title), None)
    if at is None:
        return [*seed, *content]
    items = [it for b in seed[1:] if b.get("type") == "taskList" for it in b.get("content") or []]
    others = [b for b in seed[1:] if b.get("type") != "taskList"]
    out = list(content)
    nxt = out[at + 1] if at + 1 < len(out) else None
    if items and isinstance(nxt, dict) and nxt.get("type") == "taskList":
        out[at + 1] = {**nxt, "content": [*items, *(nxt.get("content") or [])]}
    elif items:
        out.insert(at + 1, {"type": "taskList", "content": items})
    return [*others, *out] if others else out


def _seed_list(seed_blocks: Any) -> list[dict]:
    try:
        got = seed_blocks() if callable(seed_blocks) else seed_blocks
    except Exception:  # noqa: BLE001 -- the seed is a convenience; the day's note is not
        return []
    return [b for b in (got or []) if isinstance(b, dict)]


def open_daily_note(user_id: str, raw_date: Any, template_id: Any = None, *,
                    seed_blocks: Callable[[], list[dict]] | list[dict] | None = None) -> dict[str, Any]:
    """`seed_blocks` (the Today home, audit 2026-11-05 S18): blocks that START a note this call MAKES, above the
    template's body -- a list, or a function called only when the note is made (so an open of an existing note
    computes nothing). Never applied to a note that already exists, like the template itself. A seed that cannot
    be built is left out; the note is still made."""
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
                # W11-R77: a template that is also a style's outline holds `{{block:...}}` lines; a daily note
                # composes no block, so it gets none of them (never raw placeholder text in a member's note).
                from api.services.journal_two import journal_styles as _js
                # W11-R79 (4a): and it ends on the paragraph TipTap's TrailingNode would add as it opens, so opening
                # it is not an edit (the one authority, journal_styles.with_trailing_paragraph).
                payload["bodyJson"] = _js.with_trailing_paragraph(_js.without_placeholder_lines(tpl["bodyJson"]))
                properties = tpl["properties"] or None
        seed = _seed_list(seed_blocks)
        if seed:
            from api.services.journal_two import journal_styles as _js
            body = payload.get("bodyJson") if isinstance(payload.get("bodyJson"), dict) else None
            rest = list(body.get("content") or []) if body else []
            payload["bodyJson"] = _js.with_trailing_paragraph({"type": "doc", "content": merge_seed(seed, rest)})
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
