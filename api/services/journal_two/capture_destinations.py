"""The minimum destination projection an external capture door needs (§18).

⛔ WHY THIS EXISTS INSTEAD OF REUSING `/api/j2/notes/recents`. That endpoint
serves the in-app picker and returns `_row_to_note_summary`, which carries
**`bodyPlain` — the note's actual research text** — plus subtitle, tags,
properties, hero image and folder. Handing the extension the recents endpoint
would therefore have handed it a rolling window of the member's own writing to
satisfy a dropdown that renders a title. That is precisely the casual widening
the ruling names, and it would have been invisible: the picker would have
looked identical.

DERIVED FROM THE ACTUAL CONSUMER, not invented. `CaptureDialog.jsx`'s picker
reads exactly two fields off each option — `r.id` for the value and `r.title`
for the label — and the destination row renders `contextLabel`, which for a
research context is the ticker. So: id, label, ticker. Nothing else has a
consumer, so nothing else is returned.

A NOTE'S TITLE IS NOT ITS CONTENT, but it is not nothing either — it is the
smallest thing that can answer "where am I saving this?", and there is no
version of a destination picker that can work without it. That is the honest
trade, stated rather than buried.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection

DEFAULT_LIMIT = 8
MAX_LIMIT = 25

# The whole projection. A rail asserts these are the only keys that ever leave
# this module, so a future "just add the subtitle" cannot happen quietly.
PROJECTION_KEYS = ("id", "label", "ticker")


def list_destinations(
    user_id: str,
    limit: int = DEFAULT_LIMIT,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """The member's own recent notes, as destinations and nothing more.

    Tenant-scoped in the WHERE clause on both joined tables, matching
    `notes.list_recents` — the recency signal is the member's own opened-note
    ledger, so this introduces no second destination store.
    """
    try:
        limit = max(1, min(int(limit), MAX_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT n.id AS id, n.title AS title, n.ticker AS ticker "
            "FROM j2_note_recents r "
            "JOIN j2_notes n ON n.id = r.note_id AND n.user_id = r.user_id "
            "WHERE r.user_id = ? AND n.deleted_at IS NULL "
            "ORDER BY r.opened_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "label": (r["title"] or "").strip() or "Untitled",
                "ticker": r["ticker"],
            }
            for r in rows
        ]
    finally:
        if owned:
            conn.close()
